import { IRNode, BlockStatementIR, IfStatementIR } from '../../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../../../1_domain/state/CompilationState';
import { TransformRule } from '../../../interface/TransformRule';

function deepCopyIR(node: IRNode, refToDeclMap: ReadonlyMap<string, string>, genId: () => string): IRNode {
    const newIrId = genId();
    const clonedChildren: IRNode[] = [];
    const props: Record<string, any> = {};

    for (const key of Object.keys(node.props)) {
        const val = (node.props as Record<string, any>)[key];
        if (Array.isArray(val)) {
            props[key] = val.map(item => {
                if (item && typeof item === 'object' && item.type === 'ref') {
                    const childNode = node.children.find(c => c.irNodeId === item.irNodeId);
                    if (childNode) {
                        const clonedChild = deepCopyIR(childNode, refToDeclMap, genId);
                        clonedChildren.push(clonedChild);
                        return { type: 'ref', irNodeId: clonedChild.irNodeId };
                    }
                }
                return item;
            });
        } else if (val && typeof val === 'object' && val.type === 'ref') {
            const childNode = node.children.find(c => c.irNodeId === val.irNodeId);
            if (childNode) {
                const clonedChild = deepCopyIR(childNode, refToDeclMap, genId);
                clonedChildren.push(clonedChild);
                props[key] = { type: 'ref', irNodeId: clonedChild.irNodeId };
            } else {
                props[key] = val;
            }
        } else {
            props[key] = val;
        }
    }

    if (node.type === 'Identifier') {
        const originalDeclId = refToDeclMap.get(node.irNodeId);
        if (originalDeclId) {
            props['_declId'] = originalDeclId;
        }
    }

    return {
        type: node.type,
        irNodeId: newIrId,
        props,
        children: clonedChildren
    } as IRNode;
}

function wrapInBlock(node: IRNode, genId: () => string): BlockStatementIR {
    const newIrId = genId();
    if (node.type === 'BlockStatement') {
        const blockNode = node as BlockStatementIR;
        // 配列（props.body と children）を浅いコピー（Shallow Copy）して新しいブロックを作る
        return {
            type: 'BlockStatement',
            irNodeId: newIrId,
            props: { ...blockNode.props, body: [...blockNode.props.body] },
            children: [...blockNode.children]
        };
    }
    return {
        type: 'BlockStatement',
        irNodeId: newIrId,
        props: { body: [{ type: 'ref', irNodeId: node.irNodeId }] },
        children: [node]
    };
}

export interface ReplaceResult {
    readonly newNodes: IRNode[];
    readonly replaced: boolean;
}

function hasLabeledBreak(nodes: IRNode[]): boolean {
    for (const node of nodes) {
        if (node.type === 'BreakStatement') {
            if (node.props.label !== null && node.props.label !== undefined) {
                return true;
            }
        }
        
        const isPruningNode = 
            node.type === 'WhileStatement' ||
            node.type === 'ForStatement' ||
            node.type === 'DoWhileStatement' ||
            node.type === 'ForInStatement' ||
            node.type === 'ForOfStatement' ||
            node.type === 'SwitchStatement' ||
            node.type === 'FunctionDeclaration' ||
            node.type === 'FunctionExpression' ||
            node.type === 'ArrowFunctionExpression';
            
        if (isPruningNode) {
            continue;
        }

        if (node.type === 'IfStatement' || node.type === 'BlockStatement' || node.type === 'TryStatement' || node.type === 'CatchClause') {
            if (hasLabeledBreak(node.children)) {
                return true;
            }
        }
    }
    return false;
}

function findAndReplaceTargetBreaks(
    nodes: IRNode[],
    tailNodesCloner: () => IRNode[],
    refToDeclMap: ReadonlyMap<string, string>,
    genId: () => string
): ReplaceResult {
    let replacedAny = false;
    const newNodesList: IRNode[] = [];

    for (const node of nodes) {
        if (node.type === 'BreakStatement') {
            const hasLabel = node.props.label !== null && node.props.label !== undefined;
            if (!hasLabel) {
                const clonedTails = tailNodesCloner();
                newNodesList.push(...clonedTails);
                newNodesList.push(node);
                replacedAny = true;
                continue;
            }
        }

        const isPruningNode = 
            node.type === 'WhileStatement' ||
            node.type === 'ForStatement' ||
            node.type === 'DoWhileStatement' ||
            node.type === 'ForInStatement' ||
            node.type === 'ForOfStatement' ||
            node.type === 'SwitchStatement' ||
            node.type === 'FunctionDeclaration' ||
            node.type === 'FunctionExpression' ||
            node.type === 'ArrowFunctionExpression';

        if (isPruningNode) {
            newNodesList.push(node);
            continue;
        }

        if (node.type === 'BlockStatement') {
            const blockNode = node as BlockStatementIR;
            const res = findAndReplaceTargetBreaks(node.children, tailNodesCloner, refToDeclMap, genId);
            if (res.replaced) {
                const newIrId = genId();
                const newBlock: BlockStatementIR = {
                    type: 'BlockStatement',
                    irNodeId: newIrId,
                    props: {
                        ...blockNode.props,
                        body: res.newNodes.map(child => ({ type: 'ref', irNodeId: child.irNodeId }))
                    },
                    children: res.newNodes
                };
                newNodesList.push(newBlock);
                replacedAny = true;
            } else {
                newNodesList.push(node);
            }
        } else if (node.type === 'IfStatement') {
            const ifNode = node as IfStatementIR;
            
            const testNode = ifNode.children.find(c => c.irNodeId === ifNode.props.test.irNodeId);
            const consequentNode = ifNode.children.find(c => c.irNodeId === ifNode.props.consequent.irNodeId);
            const alternateNode = ifNode.props.alternate ? ifNode.children.find(c => c.irNodeId === ifNode.props.alternate!.irNodeId) : null;

            let consequentRes: ReplaceResult = { newNodes: [], replaced: false };
            let alternateRes: ReplaceResult = { newNodes: [], replaced: false };

            if (consequentNode) {
                const consequentBlock = wrapInBlock(consequentNode, genId);
                consequentRes = findAndReplaceTargetBreaks([consequentBlock], tailNodesCloner, refToDeclMap, genId);
            }
            if (alternateNode) {
                const alternateBlock = wrapInBlock(alternateNode, genId);
                alternateRes = findAndReplaceTargetBreaks([alternateBlock], tailNodesCloner, refToDeclMap, genId);
            }

            if (consequentRes.replaced || alternateRes.replaced) {
                const newIrId = genId();
                const newChildren: IRNode[] = [];
                if (testNode) newChildren.push(testNode);
                
                const newConsequent = consequentRes.replaced ? consequentRes.newNodes[0] : consequentNode!;
                newChildren.push(newConsequent);

                let newAlternateRef: any = null;
                if (alternateNode) {
                    const newAlternate = alternateRes.replaced ? alternateRes.newNodes[0] : alternateNode;
                    newChildren.push(newAlternate);
                    newAlternateRef = { type: 'ref', irNodeId: newAlternate.irNodeId };
                }

                const newIfNode: IfStatementIR = {
                    type: 'IfStatement',
                    irNodeId: newIrId,
                    props: {
                        test: { type: 'ref', irNodeId: testNode!.irNodeId },
                        consequent: { type: 'ref', irNodeId: newConsequent.irNodeId },
                        alternate: newAlternateRef
                    },
                    children: newChildren
                };
                newNodesList.push(newIfNode);
                replacedAny = true;
            } else {
                newNodesList.push(node);
            }
        } else if (node.type === 'TryStatement' || node.type === 'CatchClause') {
            const res = findAndReplaceTargetBreaks(node.children, tailNodesCloner, refToDeclMap, genId);
            if (res.replaced) {
                const newIrId = genId();
                const newProps = { ...node.props };
                
                for (const key of Object.keys(newProps)) {
                    const val = newProps[key];
                    if (val && typeof val === 'object' && val.type === 'ref') {
                        const oldIndex = node.children.findIndex(c => c.irNodeId === val.irNodeId);
                        if (oldIndex !== -1 && res.newNodes[oldIndex]) {
                            newProps[key] = { type: 'ref', irNodeId: res.newNodes[oldIndex].irNodeId };
                        }
                    } else if (Array.isArray(val)) {
                        newProps[key] = val.map(item => {
                            if (item && typeof item === 'object' && item.type === 'ref') {
                                const oldIndex = node.children.findIndex(c => c.irNodeId === item.irNodeId);
                                if (oldIndex !== -1 && res.newNodes[oldIndex]) {
                                    return { type: 'ref', irNodeId: res.newNodes[oldIndex].irNodeId };
                                }
                            }
                            return item;
                        });
                    }
                }

                const newNode: IRNode = {
                    type: node.type,
                    irNodeId: newIrId,
                    props: newProps,
                    children: res.newNodes
                };
                newNodesList.push(newNode);
                replacedAny = true;
            } else {
                newNodesList.push(node);
            }
        } else {
            newNodesList.push(node);
        }
    }

    return {
        newNodes: newNodesList,
        replaced: replacedAny
    };
}

export const TailDuplicationRule: TransformRule = {
    id: 'macro:tail-duplication',
    type: 'macro',
    name: '末尾展開 (Tail Duplication)',
    description: 'if文やswitch文の直後の合流点を複製して分解し、状態マージによる情報の喪失を防ぎます。',
    defaultEnabled: true,
    match: (node: IRNode, state: CompilationState): boolean => {
        if (node.type !== 'BlockStatement') return false;
        
        const blockNode = node as BlockStatementIR;
        const bodyRefs = blockNode.props.body;
        if (!Array.isArray(bodyRefs) || bodyRefs.length < 2) return false;

        const snapshot = state.analysisSnapshot;
        if (!snapshot) return false;

        for (let i = 0; i < bodyRefs.length - 1; i++) {
            const stmtRef = bodyRefs[i];
            const stmtNode = blockNode.children.find(c => c.irNodeId === stmtRef.irNodeId);
            if (!stmtNode) continue;

            if (stmtNode.type === 'IfStatement' || stmtNode.type === 'SwitchStatement') {
                const nextStmtRef = bodyRefs[i + 1];
                const nextStmtNode = blockNode.children.find(c => c.irNodeId === nextStmtRef.irNodeId);
                if (nextStmtNode) {
                    if (snapshot.hasDivergingStates(nextStmtNode.irNodeId)) {
                        return true;
                    }
                }
            }
        }

        return false;
    },
    candidates: (node: IRNode, state: CompilationState): IRNode[] => {
        const genId = () => state.services.generateId!('ir_td');
        const blockNode = node as BlockStatementIR;
        const bodyRefs = blockNode.props.body;
        const snapshot = state.analysisSnapshot!;

        let targetIndex = -1;
        let targetType: 'IfStatement' | 'SwitchStatement' | null = null;
        for (let i = 0; i < bodyRefs.length - 1; i++) {
            const stmtRef = bodyRefs[i];
            const stmtNode = blockNode.children.find(c => c.irNodeId === stmtRef.irNodeId);
            if (!stmtNode) continue;

            if (stmtNode.type === 'IfStatement' || stmtNode.type === 'SwitchStatement') {
                const nextStmtRef = bodyRefs[i + 1];
                const nextStmtNode = blockNode.children.find(c => c.irNodeId === nextStmtRef.irNodeId);
                if (nextStmtNode && snapshot.hasDivergingStates(nextStmtNode.irNodeId)) {
                    targetIndex = i;
                    targetType = stmtNode.type as any;
                    break;
                }
            }
        }

        if (targetIndex === -1) return [];

        if (targetType === 'IfStatement') {
            const originalIfStmt = blockNode.children.find(c => c.irNodeId === bodyRefs[targetIndex].irNodeId)! as IfStatementIR;
            
            const tailNodesToDuplicate = [];
            for (let i = targetIndex + 1; i < bodyRefs.length; i++) {
                tailNodesToDuplicate.push(blockNode.children.find(c => c.irNodeId === bodyRefs[i].irNodeId)!);
            }

            const newIfStmtId = genId();
            
            const consequentNode = originalIfStmt.children.find(c => c.irNodeId === originalIfStmt.props.consequent.irNodeId);
            const alternateNode = originalIfStmt.props.alternate ? originalIfStmt.children.find(c => c.irNodeId === originalIfStmt.props.alternate!.irNodeId) : null;

            const consequentBlock = consequentNode ? wrapInBlock(consequentNode, genId) : wrapInBlock({ type: 'EmptyStatement', irNodeId: genId(), props: {}, children: [] }, genId);
            const alternateBlock = alternateNode ? wrapInBlock(alternateNode, genId) : wrapInBlock({ type: 'EmptyStatement', irNodeId: genId(), props: {}, children: [] }, genId);

            for (const tailNode of tailNodesToDuplicate) {
                const copiedForConsequent = deepCopyIR(tailNode, snapshot.refToDeclMap, genId);
                const copiedForAlternate = deepCopyIR(tailNode, snapshot.refToDeclMap, genId);
                
                consequentBlock.props.body.push({ type: 'ref', irNodeId: copiedForConsequent.irNodeId });
                consequentBlock.children.push(copiedForConsequent);

                alternateBlock.props.body.push({ type: 'ref', irNodeId: copiedForAlternate.irNodeId });
                alternateBlock.children.push(copiedForAlternate);
            }

            const testNode = originalIfStmt.children.find(c => c.irNodeId === originalIfStmt.props.test.irNodeId)!;

            const newIfStmt: IfStatementIR = {
                type: 'IfStatement',
                irNodeId: newIfStmtId,
                props: {
                    test: { type: 'ref', irNodeId: testNode.irNodeId },
                    consequent: { type: 'ref', irNodeId: consequentBlock.irNodeId },
                    alternate: { type: 'ref', irNodeId: alternateBlock.irNodeId }
                },
                children: [
                    testNode,
                    consequentBlock,
                    alternateBlock
                ]
            };

            const finalBlockChildren: IRNode[] = [];
            const finalBlockBodyRefs: any[] = [];
            for (let i = 0; i < targetIndex; i++) {
                const originalNode = blockNode.children.find(c => c.irNodeId === bodyRefs[i].irNodeId)!;
                finalBlockChildren.push(originalNode);
                finalBlockBodyRefs.push({ type: 'ref', irNodeId: originalNode.irNodeId });
            }

            finalBlockChildren.push(newIfStmt);
            finalBlockBodyRefs.push({ type: 'ref', irNodeId: newIfStmt.irNodeId });

            const transformedBlock: BlockStatementIR = {
                type: 'BlockStatement',
                irNodeId: genId(),
                props: { body: finalBlockBodyRefs },
                children: finalBlockChildren
            };

            console.debug(`[TransformRule] ${TailDuplicationRule.id} matched on BlockStatement with IfStatement. Tail duplicated.`);
            return [transformedBlock];
        } else {
            // SwitchStatement
            const originalSwitchStmt = blockNode.children.find(c => c.irNodeId === bodyRefs[targetIndex].irNodeId)!;

            const tailNodesToDuplicate: IRNode[] = [];
            for (let i = targetIndex + 1; i < bodyRefs.length; i++) {
                tailNodesToDuplicate.push(blockNode.children.find(c => c.irNodeId === bodyRefs[i].irNodeId)!);
            }

            const tailNodesCloner = () => {
                return tailNodesToDuplicate.map(node => deepCopyIR(node, snapshot.refToDeclMap, genId));
            };

            const casesRefs = originalSwitchStmt.props.cases || [];
            const caseNodes: IRNode[] = [];
            for (const ref of casesRefs) {
                if (ref && ref.type === 'ref') {
                    const cNode = originalSwitchStmt.children.find(c => c.irNodeId === ref.irNodeId);
                    if (cNode) caseNodes.push(cNode);
                }
            }

            for (const caseNode of caseNodes) {
                const consequentRefs = caseNode.props.consequent || [];
                const consequentNodes: IRNode[] = [];
                for (const ref of consequentRefs) {
                    if (ref && ref.type === 'ref') {
                        const childNode = caseNode.children.find(c => c.irNodeId === ref.irNodeId);
                        if (childNode) consequentNodes.push(childNode);
                    }
                }

                if (hasLabeledBreak(consequentNodes)) {
                    return [];
                }
            }

            let hasDefault = false;
            for (const caseNode of caseNodes) {
                if (!caseNode.props.test) {
                    hasDefault = true;
                    break;
                }
            }

            const clonedCaseNodes: IRNode[] = caseNodes.map(node => {
                return deepCopyIR(node, snapshot.refToDeclMap, genId);
            });

            if (!hasDefault) {
                const newDefaultId = genId();
                const newDefaultCase: IRNode = {
                    type: 'SwitchCase',
                    irNodeId: newDefaultId,
                    props: {
                        test: null,
                        consequent: []
                    },
                    children: []
                };
                clonedCaseNodes.push(newDefaultCase);
            }

            const rebuiltCaseNodes: IRNode[] = [];
            for (let idx = 0; idx < clonedCaseNodes.length; idx++) {
                const caseNode = clonedCaseNodes[idx];
                
                const testNode = caseNode.props.test 
                    ? caseNode.children.find(c => c.irNodeId === caseNode.props.test.irNodeId)
                    : null;
                    
                const consequentRefs = caseNode.props.consequent || [];
                const consequentNodes: IRNode[] = [];
                for (const ref of consequentRefs) {
                    if (ref && ref.type === 'ref') {
                        const child = caseNode.children.find(c => c.irNodeId === ref.irNodeId);
                        if (child) consequentNodes.push(child);
                    }
                }

                const replaceRes = findAndReplaceTargetBreaks(consequentNodes, tailNodesCloner, snapshot.refToDeclMap, genId);
                let finalConsequent = replaceRes.newNodes;

                const isLastCase = idx === clonedCaseNodes.length - 1;
                if (isLastCase) {
                    const lastNode = finalConsequent[finalConsequent.length - 1];
                    const isAbrupt = lastNode && (
                        lastNode.type === 'BreakStatement' ||
                        lastNode.type === 'ReturnStatement' ||
                        lastNode.type === 'ThrowStatement' ||
                        lastNode.type === 'ContinueStatement'
                    );
                    
                    if (!isAbrupt) {
                        const clonedTails = tailNodesCloner();
                        finalConsequent = [...finalConsequent, ...clonedTails];
                    }
                }

                const newCaseId = genId();
                const newChildren: IRNode[] = [];
                if (testNode) {
                    newChildren.push(testNode);
                }
                newChildren.push(...finalConsequent);

                const newCaseNode: IRNode = {
                    type: 'SwitchCase',
                    irNodeId: newCaseId,
                    props: {
                        test: testNode ? { type: 'ref', irNodeId: testNode.irNodeId } : null,
                        consequent: finalConsequent.map(child => ({ type: 'ref', irNodeId: child.irNodeId }))
                    },
                    children: newChildren
                };
                rebuiltCaseNodes.push(newCaseNode);
            }

            const discriminantNode = originalSwitchStmt.children.find(c => c.irNodeId === originalSwitchStmt.props.discriminant.irNodeId)!;
            
            const newSwitchId = genId();
            const newSwitchStmt: IRNode = {
                type: 'SwitchStatement',
                irNodeId: newSwitchId,
                props: {
                    discriminant: { type: 'ref', irNodeId: discriminantNode.irNodeId },
                    cases: rebuiltCaseNodes.map(caseNode => ({ type: 'ref', irNodeId: caseNode.irNodeId }))
                },
                children: [
                    discriminantNode,
                    ...rebuiltCaseNodes
                ]
            };

            const finalBlockChildren: IRNode[] = [];
            const finalBlockBodyRefs: any[] = [];
            
            for (let i = 0; i < targetIndex; i++) {
                const originalNode = blockNode.children.find(c => c.irNodeId === bodyRefs[i].irNodeId)!;
                finalBlockChildren.push(originalNode);
                finalBlockBodyRefs.push({ type: 'ref', irNodeId: originalNode.irNodeId });
            }

            finalBlockChildren.push(newSwitchStmt);
            finalBlockBodyRefs.push({ type: 'ref', irNodeId: newSwitchStmt.irNodeId });

            const transformedBlock: BlockStatementIR = {
                type: 'BlockStatement',
                irNodeId: genId(),
                props: { body: finalBlockBodyRefs },
                children: finalBlockChildren
            };

            console.debug(`[TransformRule] ${TailDuplicationRule.id} matched on BlockStatement with SwitchStatement. Tail duplicated.`);
            return [transformedBlock];
        }
    }
};
