import { IRNode, IRRoot } from '../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { CFGBlock } from '../../1_domain/analysis/models/CFGBlock';

const CFG_BRANCH_RULES: Record<string, any> = {
    // --- 条件分岐 ---
    'IfStatement': { type: 'branch', cond: 'test', trueBranch: 'consequent', falseBranch: 'alternate' },
    'ConditionalExpression': { type: 'branch', cond: 'test', trueBranch: 'consequent', falseBranch: 'alternate' },
    
    // --- ショートサーキット評価 ---
    'LogicalExpression': { type: 'short-circuit', left: 'left', right: 'right' },
    'OptionalCallExpression': { type: 'short-circuit', left: 'callee', right: 'arguments' }, // obj?.()
    'OptionalMemberExpression': { type: 'short-circuit', left: 'object', right: 'property' }, // obj?.prop
    'AssignmentPattern': { type: 'short-circuit', left: 'left', right: 'right' }, // デフォルト代入（値がない時だけ右辺を実行）

    // --- ループ ---
    'WhileStatement': { type: 'loop-while', cond: 'test', body: 'body' },
    'ForStatement': { type: 'loop-for', init: 'init', cond: 'test', update: 'update', body: 'body' },
    'ForInStatement': { type: 'loop-for-in-of', left: 'left', right: 'right', body: 'body' },
    'ForOfStatement': { type: 'loop-for-in-of', left: 'left', right: 'right', body: 'body' },
    'DoWhileStatement': { type: 'loop-do-while', cond: 'test', body: 'body' },
    
    // --- 例外・ジャンプ ---
    'TryStatement': { type: 'try-catch', block: 'block', handler: 'handler', finalizer: 'finalizer' },
    'SwitchStatement': { type: 'switch', discriminant: 'discriminant', cases: 'cases' },
    
    // --- 関数・メソッド・独立ブロック（スコープ分離） ---
    'FunctionDeclaration': { type: 'function', body: 'body' },
    'FunctionExpression': { type: 'function', body: 'body' },
    'ArrowFunctionExpression': { type: 'function', body: 'body' },
    'ClassMethod': { type: 'function', body: 'body' },
    'ClassPrivateMethod': { type: 'function', body: 'body' },
    'ObjectMethod': { type: 'function', body: 'body' },
    'StaticBlock': { type: 'function', body: 'body' } // クラス静的ブロック（独立したフローとして分離）
};

interface CFGContext {
    exitBlock: CFGBlock | null;
    catchBlock: CFGBlock | null;
}

interface LoopTarget {
    label?: string;
    continueTarget?: CFGBlock;
    breakTarget: CFGBlock;
}

export class CFGBuilder {
    public static build(irRoot: IRRoot): {
        blocks: Map<string, CFGBlock>,
        nodeToBlock: Map<string, string>,
        parentMap: Map<string, string>
    } {
        const blocks = new Map<string, CFGBlock>();
        const nodeToBlock = new Map<string, string>();
        const parentMap = new Map<string, string>();
        let blockCounter = 0;

        const createBlock = (): CFGBlock => {
            const id = `block_${blockCounter++}`;
            const block: CFGBlock = { id, nodes: [], predecessors: [], successors: [] };
            blocks.set(id, block);
            return block;
        };

        const link = (from: CFGBlock | null, to: CFGBlock | null) => {
            if (!from || !to) return;
            if (!from.successors.includes(to.id)) from.successors.push(to.id);
            if (!to.predecessors.includes(from.id)) to.predecessors.push(from.id);
        };

        const getChild = (node: IRNode, propName: string): IRNode | null => {
            const ref = node.props[propName];
            if (ref && ref.type === 'ref') {
                return node.children.find(c => c.irNodeId === ref.irNodeId) || null;
            }
            return null;
        };

        const entryBlock = createBlock();
        let currentBlock: CFGBlock | null = entryBlock;
        
        const loopStack: LoopTarget[] = [];
        const finallyStack: CFGBlock[] = [];
        const contextStack: CFGContext[] = [{ exitBlock: null, catchBlock: null }];
        
        let pendingLabel: string | null = null; // LabeledStatement 用の保留ラベル

        const walk = (node: IRNode | null, parentId: string | null = null) => {
            if (!node) return;
            if (parentId) parentMap.set(node.irNodeId, parentId);

            // ラベルのキャプチャ
            if (node.type === 'LabeledStatement') {
                const labelRef = node.props['label'];
                if (labelRef && labelRef.type === 'ref') {
                    const labelNode = node.children.find(c => c.irNodeId === labelRef.irNodeId);
                    if (labelNode && labelNode.type === 'Identifier') {
                        pendingLabel = labelNode.props['name'] as string;
                    }
                }
                const body = getChild(node, 'body');
                walk(body, node.irNodeId);
                return; // LabeledStatement自体はイベントノードではないのでここでリターン
            }

            const rule = CFG_BRANCH_RULES[node.type];

            if (!currentBlock) {
                currentBlock = createBlock();
            }

            // 論理代入演算子 (&&=, ||=, ??=) のショートサーキット展開
            if (node.type === 'AssignmentExpression') {
                const op = node.props['operator'];
                if (op === '&&=' || op === '||=' || op === '??=') {
                    walk(getChild(node, 'left'), node.irNodeId);
                    const preRightBlock = currentBlock;

                    const rightBlock = createBlock();
                    link(preRightBlock, rightBlock);
                    currentBlock = rightBlock;
                    walk(getChild(node, 'right'), node.irNodeId);
                    const postRightBlock = currentBlock;

                    const mergeBlock = createBlock();
                    link(preRightBlock, mergeBlock);
                    link(postRightBlock, mergeBlock);
                    currentBlock = mergeBlock;
                    
                    if (currentBlock) {
                        currentBlock.nodes.push(node);
                        nodeToBlock.set(node.irNodeId, currentBlock.id);
                    }
                    return;
                }
            }

            if (rule) {
                if (rule.type === 'function') {
                    const savedBlock = currentBlock;
                    
                    const funcEntry = createBlock();
                    const funcExit = createBlock();
                    
                    contextStack.push({ exitBlock: funcExit, catchBlock: null });
                    currentBlock = funcEntry;

                    const savedLoopStack = [...loopStack];
                    loopStack.length = 0;
                    const savedFinallyStack = [...finallyStack];
                    finallyStack.length = 0;
                    
                    if (node.props.params && Array.isArray(node.props.params)) {
                        for (const param of node.props.params) {
                            if (param && param.type === 'ref') {
                                const pNode = node.children.find(c => c.irNodeId === param.irNodeId);
                                if (pNode) walk(pNode, node.irNodeId);
                            }
                        }
                    }
                    
                    const body = getChild(node, rule.body);
                    walk(body, node.irNodeId);
                    
                    if (currentBlock) {
                        link(currentBlock, funcExit);
                    }
                    
                    contextStack.pop();
                    loopStack.push(...savedLoopStack);
                    finallyStack.push(...savedFinallyStack);
                    currentBlock = savedBlock;
                    
                    if (currentBlock) {
                        currentBlock.nodes.push(node);
                        nodeToBlock.set(node.irNodeId, currentBlock.id);
                    }
                    return;
                } else if (rule.type === 'try-catch') {
                    const block = getChild(node, rule.block);
                    const handler = getChild(node, rule.handler);
                    const finalizer = getChild(node, rule.finalizer);
                    
                    const catchEntryBlock = createBlock();
                    const finallyEntryBlock = finalizer ? createBlock() : null;
                    const endBlock = createBlock();
                    
                    const currentContext = contextStack[contextStack.length - 1];
                    const prevCatch = currentContext.catchBlock;
                    currentContext.catchBlock = catchEntryBlock;
                    
                    if (finallyEntryBlock) {
                        finallyStack.push(finallyEntryBlock);
                    }
                    
                    walk(block, node.irNodeId);
                    
                    if (currentBlock) {
                        link(currentBlock, finallyEntryBlock || endBlock);
                    }
                    
                    currentContext.catchBlock = prevCatch;
                    
                    if (handler) {
                        currentBlock = catchEntryBlock;
                        walk(handler, node.irNodeId);
                        if (currentBlock) {
                            link(currentBlock, finallyEntryBlock || endBlock);
                        }
                    } else {
                        link(catchEntryBlock, finallyEntryBlock || endBlock);
                    }
                    
                    if (finallyEntryBlock) {
                        finallyStack.pop();
                    }
                    
                    if (finallyEntryBlock) {
                        currentBlock = finallyEntryBlock;
                        walk(finalizer, node.irNodeId);
                        if (currentBlock) {
                            link(currentBlock, endBlock);
                        }
                    }
                    
                    currentBlock = endBlock;
                    return;
                } else if (rule.type === 'switch') {
                    walk(getChild(node, rule.discriminant), node.irNodeId);
                    
                    const exitBlock = createBlock();
                    
                    // ラベルの適用
                    const currentLabel = pendingLabel;
                    pendingLabel = null;
                    loopStack.push({ label: currentLabel || undefined, breakTarget: exitBlock });

                    const preSwitchBlock = currentBlock;

                    const casesRefs = node.props.cases || [];
                    const caseNodes: IRNode[] = [];
                    for (const ref of casesRefs) {
                        if (ref && ref.type === 'ref') {
                            const cNode = node.children.find(c => c.irNodeId === ref.irNodeId);
                            if (cNode) caseNodes.push(cNode);
                        }
                    }

                    let prevCaseEndBlock: CFGBlock | null = null;
                    const caseBlocks: CFGBlock[] = [];

                    for (let i = 0; i < caseNodes.length; i++) {
                        caseBlocks.push(createBlock());
                    }

                    let hasDefault = false;
                    for (const caseNode of caseNodes) {
                        if (!caseNode.props.test) hasDefault = true;
                    }
                    
                    for (const cb of caseBlocks) link(preSwitchBlock, cb);
                    if (!hasDefault) link(preSwitchBlock, exitBlock);

                    for (let i = 0; i < caseNodes.length; i++) {
                        const caseNode = caseNodes[i];
                        const cb = caseBlocks[i];

                        if (prevCaseEndBlock) link(prevCaseEndBlock, cb);
                        currentBlock = cb;

                        const testNode = getChild(caseNode, 'test');
                        if (testNode) walk(testNode, caseNode.irNodeId);

                        const consequentRefs = caseNode.props.consequent || [];
                        for (const stmtRef of consequentRefs) {
                            if (stmtRef && stmtRef.type === 'ref') {
                                const stmtNode = caseNode.children.find(c => c.irNodeId === stmtRef.irNodeId);
                                if (stmtNode) walk(stmtNode, caseNode.irNodeId);
                            }
                        }
                        prevCaseEndBlock = currentBlock;
                    }

                    if (prevCaseEndBlock) link(prevCaseEndBlock, exitBlock);

                    loopStack.pop();
                    currentBlock = exitBlock;
                    return;
                } else if (rule.type === 'branch') {
                    walk(getChild(node, rule.cond), node.irNodeId);
                    const preBranchBlock = currentBlock;

                    const trueBlock = createBlock();
                    link(preBranchBlock, trueBlock);
                    currentBlock = trueBlock;
                    walk(getChild(node, rule.trueBranch), node.irNodeId);
                    const postTrueBlock = currentBlock;

                    const falseBlock = createBlock();
                    link(preBranchBlock, falseBlock);
                    currentBlock = falseBlock;
                    walk(getChild(node, rule.falseBranch), node.irNodeId);
                    const postFalseBlock = currentBlock;

                    const mergeBlock = createBlock();
                    link(postTrueBlock, mergeBlock);
                    link(postFalseBlock, mergeBlock);
                    currentBlock = mergeBlock;
                    return;
                } else if (rule.type === 'short-circuit') {
                    walk(getChild(node, rule.left), node.irNodeId);
                    const preRightBlock = currentBlock;

                    const rightBlock = createBlock();
                    link(preRightBlock, rightBlock);
                    currentBlock = rightBlock;
                    
                    if (node.type === 'OptionalCallExpression') {
                        // arguments is an array
                        const args = node.props['arguments'];
                        if (Array.isArray(args)) {
                            for (const arg of args) {
                                if (arg && arg.type === 'ref') {
                                    const aNode = node.children.find(c => c.irNodeId === arg.irNodeId);
                                    if (aNode) walk(aNode, node.irNodeId);
                                }
                            }
                        }
                    } else {
                        walk(getChild(node, rule.right), node.irNodeId);
                    }
                    
                    const postRightBlock = currentBlock;

                    const mergeBlock = createBlock();
                    link(preRightBlock, mergeBlock); // Short-circuit path
                    link(postRightBlock, mergeBlock); // Evaluated path
                    currentBlock = mergeBlock;
                    
                    if (currentBlock) {
                        currentBlock.nodes.push(node);
                        nodeToBlock.set(node.irNodeId, currentBlock.id);
                    }
                    return;
                } else if (rule.type === 'loop-while') {
                    const headerBlock = createBlock();
                    const bodyBlock = createBlock();
                    const exitBlock = createBlock();

                    const currentLabel = pendingLabel;
                    pendingLabel = null;

                    link(currentBlock, headerBlock);
                    currentBlock = headerBlock;
                    walk(getChild(node, rule.cond), node.irNodeId);
                    link(currentBlock, bodyBlock);
                    link(currentBlock, exitBlock);

                    currentBlock = bodyBlock;
                    loopStack.push({ label: currentLabel || undefined, continueTarget: headerBlock, breakTarget: exitBlock });
                    walk(getChild(node, rule.body), node.irNodeId);
                    loopStack.pop();

                    link(currentBlock, headerBlock);
                    currentBlock = exitBlock;
                    return;
                } else if (rule.type === 'loop-for') {
                    walk(getChild(node, rule.init), node.irNodeId);
                    
                    const headerBlock = createBlock();
                    const bodyBlock = createBlock();
                    const updateBlock = createBlock();
                    const exitBlock = createBlock();

                    const currentLabel = pendingLabel;
                    pendingLabel = null;

                    link(currentBlock, headerBlock);
                    currentBlock = headerBlock;
                    walk(getChild(node, rule.cond), node.irNodeId);
                    link(currentBlock, bodyBlock);
                    link(currentBlock, exitBlock);

                    currentBlock = bodyBlock;
                    loopStack.push({ label: currentLabel || undefined, continueTarget: updateBlock, breakTarget: exitBlock });
                    walk(getChild(node, rule.body), node.irNodeId);
                    loopStack.pop();

                    link(currentBlock, updateBlock);
                    currentBlock = updateBlock;
                    walk(getChild(node, rule.update), node.irNodeId);

                    link(currentBlock, headerBlock);
                    currentBlock = exitBlock;
                    return;
                } else if (rule.type === 'loop-for-in-of') {
                    walk(getChild(node, rule.right), node.irNodeId); 
                    
                    const headerBlock = createBlock();
                    const bodyBlock = createBlock();
                    const exitBlock = createBlock();

                    const currentLabel = pendingLabel;
                    pendingLabel = null;

                    link(currentBlock, headerBlock);
                    currentBlock = headerBlock;
                    
                    walk(getChild(node, rule.left), node.irNodeId); 
                    
                    link(currentBlock, bodyBlock);
                    link(currentBlock, exitBlock);

                    currentBlock = bodyBlock;
                    loopStack.push({ label: currentLabel || undefined, continueTarget: headerBlock, breakTarget: exitBlock });
                    walk(getChild(node, rule.body), node.irNodeId);
                    loopStack.pop();

                    link(currentBlock, headerBlock);
                    currentBlock = exitBlock;
                    return;
                } else if (rule.type === 'loop-do-while') {
                    const bodyBlock = createBlock();
                    const testBlock = createBlock();
                    const exitBlock = createBlock();

                    const currentLabel = pendingLabel;
                    pendingLabel = null;

                    link(currentBlock, bodyBlock);
                    
                    currentBlock = bodyBlock;
                    loopStack.push({ label: currentLabel || undefined, continueTarget: testBlock, breakTarget: exitBlock });
                    walk(getChild(node, rule.body), node.irNodeId);
                    loopStack.pop();

                    link(currentBlock, testBlock);
                    currentBlock = testBlock;
                    walk(getChild(node, rule.cond), node.irNodeId);
                    
                    link(currentBlock, bodyBlock); 
                    link(currentBlock, exitBlock); 
                    
                    currentBlock = exitBlock;
                    return;
                }
            }

            // ラベルの消費忘れ防止
            pendingLabel = null;

            if (node.type === 'BreakStatement') {
                const labelRef = node.props['label'];
                let targetLabel: string | null = null;
                if (labelRef && labelRef.type === 'ref') {
                    const labelNode = node.children.find(c => c.irNodeId === labelRef.irNodeId);
                    if (labelNode && labelNode.type === 'Identifier') targetLabel = labelNode.props['name'] as string;
                }

                if (loopStack.length > 0) {
                    let targetBlock = loopStack[loopStack.length - 1].breakTarget;
                    if (targetLabel) {
                        // 指定されたラベル名を持つスタックを探す
                        for (let i = loopStack.length - 1; i >= 0; i--) {
                            if (loopStack[i].label === targetLabel) {
                                targetBlock = loopStack[i].breakTarget;
                                break;
                            }
                        }
                    }
                    link(currentBlock, targetBlock);
                }
                currentBlock = null;
                return;
            }

            if (node.type === 'ContinueStatement') {
                const labelRef = node.props['label'];
                let targetLabel: string | null = null;
                if (labelRef && labelRef.type === 'ref') {
                    const labelNode = node.children.find(c => c.irNodeId === labelRef.irNodeId);
                    if (labelNode && labelNode.type === 'Identifier') targetLabel = labelNode.props['name'] as string;
                }

                if (loopStack.length > 0) {
                    let targetBlock: CFGBlock | null = null;
                    if (targetLabel) {
                        for (let i = loopStack.length - 1; i >= 0; i--) {
                            if (loopStack[i].label === targetLabel && loopStack[i].continueTarget) {
                                targetBlock = loopStack[i].continueTarget!;
                                break;
                            }
                        }
                    } else {
                        for (let i = loopStack.length - 1; i >= 0; i--) {
                            if (loopStack[i].continueTarget) {
                                targetBlock = loopStack[i].continueTarget!;
                                break;
                            }
                        }
                    }
                    if (targetBlock) link(currentBlock, targetBlock);
                }
                currentBlock = null;
                return;
            }

            if (node.type === 'ReturnStatement') {
                walk(getChild(node, 'argument'), node.irNodeId);
                if (finallyStack.length > 0) {
                    link(currentBlock, finallyStack[finallyStack.length - 1]);
                } else {
                    const currentContext = contextStack[contextStack.length - 1];
                    if (currentContext.exitBlock) {
                        link(currentBlock, currentContext.exitBlock);
                    }
                }
                currentBlock = null;
                return;
            }

            if (node.type === 'ThrowStatement') {
                walk(getChild(node, 'argument'), node.irNodeId);
                if (finallyStack.length > 0) {
                    link(currentBlock, finallyStack[finallyStack.length - 1]);
                } else {
                    const currentContext = contextStack[contextStack.length - 1];
                    if (currentContext.catchBlock) {
                        link(currentBlock, currentContext.catchBlock);
                    } else if (currentContext.exitBlock) {
                        link(currentBlock, currentContext.exitBlock);
                    }
                }
                currentBlock = null;
                return;
            }

            const isEvent = [
                'Identifier', 'AssignmentExpression', 'VariableDeclarator', 
                'CallExpression', 'NewExpression', 'UpdateExpression', 
                'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 
                'ClassMethod', 'ObjectMethod', 'ClassPrivateMethod',
                'AwaitExpression', 'YieldExpression'
            ].includes(node.type);

            for (const child of node.children || []) {
                walk(child, node.irNodeId);
            }

            if (isEvent && currentBlock) {
                currentBlock.nodes.push(node);
                nodeToBlock.set(node.irNodeId, currentBlock.id);
            }
        };

        walk(irRoot);

        return { blocks, nodeToBlock, parentMap };
    }
}
