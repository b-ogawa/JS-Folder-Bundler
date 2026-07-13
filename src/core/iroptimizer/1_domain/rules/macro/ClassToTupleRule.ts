import { IRNode, ProgramIR, IdentifierIR, NumericLiteralIR, VariableDeclaratorIR, VariableDeclarationIR, ReturnStatementIR, ArrowFunctionExpressionIR } from '../../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../../../1_domain/state/CompilationState';
import { TransformRule } from '../../../interface/TransformRule';

interface ClassInfo {
    classDeclNode: IRNode;
    className: string;
    classDeclId: string;
    propToIndex: Map<string, number>;
    constructorNode: IRNode | null;
    instDeclIds: Set<string>;
    arrayDeclIds: Set<string>;
}

// 解析可能な配列メソッドのシグネチャ定義
const SAFE_ARRAY_METHODS: Record<string, {
    callbackIndex: number;          // コールバック関数の引数インデックス
    elementParamIndices: number[];  // コールバック内で配列要素を受け取るパラメータのインデックス
    returnsArray: boolean;          // 返却値が配列かどうか
    returnsInstance: boolean;       // 返却値がインスタンスかどうか
}> = {
    'map': { callbackIndex: 0, elementParamIndices: [0], returnsArray: true, returnsInstance: false },
    'filter': { callbackIndex: 0, elementParamIndices: [0], returnsArray: true, returnsInstance: false },
    'forEach': { callbackIndex: 0, elementParamIndices: [0], returnsArray: false, returnsInstance: false },
    'find': { callbackIndex: 0, elementParamIndices: [0], returnsArray: false, returnsInstance: true },
    'some': { callbackIndex: 0, elementParamIndices: [0], returnsArray: false, returnsInstance: false },
    'every': { callbackIndex: 0, elementParamIndices: [0], returnsArray: false, returnsInstance: false },
    'findIndex': { callbackIndex: 0, elementParamIndices: [0], returnsArray: false, returnsInstance: false }
    // flatMapはデータ構造が平坦化されるため非対応
    // reduce, sortは制御フローの静的解析が困難なため非対応
};

// concatは多次元配列が平坦化される可能性があるため非対応
const PURE_ARRAY_METHODS = ['push', 'unshift', 'slice', 'pop', 'shift', 'at', 'length', 'includes'];

function findEligibleClasses(program: IRNode, state: CompilationState): ClassInfo[] {
    const snapshot = state.analysisSnapshot;
    if (!snapshot) return [];

    const logInfo = (msg: string) => {
        if (state.services.logger) {
            state.services.logger({ type: 'info', msg });
        } else {
            console.log(msg);
        }
    };

    const infos: ClassInfo[] = [];

    const classDecls: IRNode[] = [];
    for (const [id, irNode] of snapshot.nodeMap.entries()) {
        if (irNode.type === 'ClassDeclaration') {
            classDecls.push(irNode);
        }
    }

    for (const classDecl of classDecls) {
        const classIdRef = classDecl.props.id;
        if (!classIdRef) continue;
        const classIdNode = snapshot.nodeMap.get(classIdRef.irNodeId);
        if (!classIdNode || classIdNode.type !== 'Identifier') continue;

        const className = classIdNode.props.name;
        const classDeclId = classIdNode.irNodeId;

        if (snapshot.escapedVars.has(classDeclId)) {
            logInfo(`[ClassToTuple] Rejected "${className}": Class definition is escaped.`);
            continue;
        }
        if (classDecl.props.superClass) {
            logInfo(`[ClassToTuple] Rejected "${className}": Extends another class.`);
            continue;
        }
        logInfo(`[ClassToTuple] Analyzing class "${className}" for tuple optimization...`);

        const classBodyRef = classDecl.props.body;
        if (!classBodyRef) continue;
        const classBodyNode = snapshot.nodeMap.get(classBodyRef.irNodeId);
        if (!classBodyNode || classBodyNode.type !== 'ClassBody') continue;

        let constructorNode: IRNode | null = null;
        let hasOtherMethods = false;

        const bodyRefs = classBodyNode.props.body || [];
        for (const ref of bodyRefs) {
            const methodNode = snapshot.nodeMap.get(ref.irNodeId);
            if (methodNode && methodNode.type === 'ClassMethod') {
                if (methodNode.props.kind === 'constructor') {
                    constructorNode = methodNode;
                } else {
                    hasOtherMethods = true;
                }
            }
        }

        if (hasOtherMethods) {
            logInfo(`[ClassToTuple] Rejected "${className}": Has methods other than constructor.`);
            continue;
        }

        const propToIndex = new Map<string, number>();
        if (constructorNode) {
            const blockRef = constructorNode.props.body;
            const blockNode = blockRef ? snapshot.nodeMap.get(blockRef.irNodeId) : null;
            if (blockNode && blockNode.type === 'BlockStatement') {
                const stmtRefs = blockNode.props.body || [];
                for (const stmtRef of stmtRefs) {
                    const stmtNode = snapshot.nodeMap.get(stmtRef.irNodeId);
                    if (stmtNode && stmtNode.type === 'ExpressionStatement') {
                        const exprRef = stmtNode.props.expression;
                        const exprNode = exprRef ? snapshot.nodeMap.get(exprRef.irNodeId) : null;
                        if (exprNode && exprNode.type === 'AssignmentExpression' && exprNode.props.operator === '=') {
                            const leftRef = exprNode.props.left;
                            const leftNode = leftRef ? snapshot.nodeMap.get(leftRef.irNodeId) : null;
                            if (leftNode && leftNode.type === 'MemberExpression' && !leftNode.props.computed) {
                                const objRef = leftNode.props.object;
                                const objNode = objRef ? snapshot.nodeMap.get(objRef.irNodeId) : null;
                                if (objNode && objNode.type === 'ThisExpression') {
                                    const propRef = leftNode.props.property;
                                    const propNode = propRef ? snapshot.nodeMap.get(propRef.irNodeId) : null;
                                    if (propNode && propNode.type === 'Identifier') {
                                        const propName = propNode.props.name;
                                        if (!propToIndex.has(propName)) {
                                            propToIndex.set(propName, propToIndex.size);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        let isThisSafe = true;
        if (constructorNode) {
            const findThisNodes = (n: IRNode, result: IRNode[]) => {
                if (n.type === 'ThisExpression') result.push(n);
                for (const child of n.children) findThisNodes(child, result);
            };
            const thisNodes: IRNode[] = [];
            findThisNodes(constructorNode, thisNodes);

            for (const thisNode of thisNodes) {
                const parentId = snapshot.parentMap.get(thisNode.irNodeId);
                const parentNode = parentId ? snapshot.nodeMap.get(parentId) : null;
                if (!parentNode || parentNode.type !== 'MemberExpression' || parentNode.props.object.irNodeId !== thisNode.irNodeId) {
                    isThisSafe = false; break;
                }
                const grandParentId = snapshot.parentMap.get(parentNode.irNodeId);
                const grandParentNode = grandParentId ? snapshot.nodeMap.get(grandParentId) : null;
                if (grandParentNode && grandParentNode.type === 'CallExpression' && grandParentNode.props.callee.irNodeId === parentNode.irNodeId) {
                    isThisSafe = false; break;
                }
            }
        }
        if (!isThisSafe) {
            logInfo(`[ClassToTuple] Rejected "${className}": 'this' escapes from constructor.`);
            continue;
        }

        let hasInstanceof = false;
        for (const [id, irNode] of snapshot.nodeMap.entries()) {
            if (irNode.type === 'BinaryExpression' && irNode.props.operator === 'instanceof') {
                const rightId = irNode.props.right.irNodeId;
                const rightDeclId = snapshot.refToDeclMap.get(rightId) || rightId;
                if (rightDeclId === classDeclId) { hasInstanceof = true; break; }
            }
        }
        if (hasInstanceof) {
            logInfo(`[ClassToTuple] Rejected "${className}": Used in 'instanceof' operator.`);
            continue;
        }

        const instDeclIds = new Set<string>();
        const arrayDeclIds = new Set<string>();
        let trackSuccess = true;

        const initNewExprs: IRNode[] = [];
        for (const [id, irNode] of snapshot.nodeMap.entries()) {
            if (irNode.type === 'NewExpression') {
                const calleeId = irNode.props.callee.irNodeId;
                const calleeDeclId = snapshot.refToDeclMap.get(calleeId) || calleeId;
                if (calleeDeclId === classDeclId) initNewExprs.push(irNode);
            }
        }

        const queue: { node: IRNode, isArray: boolean }[] = initNewExprs.map(n => ({ node: n, isArray: false }));
        const visitedNew = new Set<string>();

        while (queue.length > 0) {
            const { node: current, isArray } = queue.shift()!;
            if (visitedNew.has(current.irNodeId)) continue;
            visitedNew.add(current.irNodeId);

            const parentId = snapshot.parentMap.get(current.irNodeId);
            const parentNode = parentId ? snapshot.nodeMap.get(parentId) : null;

            if (!parentNode) { 
                logInfo(`[ClassToTuple] Tracking failed for "${className}". Instance escaped into unhandled parent node type: null`);
                trackSuccess = false; break; 
            }

            if (parentNode.type === 'ArrayExpression') {
                if (current.type === 'ArrayExpression') {
                    logInfo(`[ClassToTuple] Tracking failed for "${className}". Nested array literals are not supported.`);
                    trackSuccess = false; break;
                }
                queue.push({ node: parentNode, isArray: true });
                continue;
            }

            if (parentNode.type === 'VariableDeclarator') {
                const idRef = parentNode.props.id;
                const idNode = idRef ? snapshot.nodeMap.get(idRef.irNodeId) : null;
                if (idNode && idNode.type === 'Identifier') {
                    if (snapshot.escapedVars.has(idNode.irNodeId)) { trackSuccess = false; break; }
                    instDeclIds.add(idNode.irNodeId);
                    if (isArray) arrayDeclIds.add(idNode.irNodeId);
                } else { trackSuccess = false; break; }
            }
            else if (parentNode.type === 'AssignmentExpression') {
                const leftRef = parentNode.props.left;
                const leftNode = leftRef ? snapshot.nodeMap.get(leftRef.irNodeId) : null;
                if (leftNode && leftNode.type === 'Identifier') {
                    const leftDeclId = snapshot.refToDeclMap.get(leftNode.irNodeId) || leftNode.irNodeId;
                    if (snapshot.escapedVars.has(leftDeclId)) { trackSuccess = false; break; }
                    instDeclIds.add(leftDeclId);
                    if (isArray) arrayDeclIds.add(leftDeclId);
                } else { trackSuccess = false; break; }
            }
            else if (parentNode.type === 'CallExpression') {
                if (isArray) {
                     logInfo(`[ClassToTuple] Tracking failed for "${className}". Array passed to function call directly.`);
                     trackSuccess = false; break;
                }
                const calleeRef = parentNode.props.callee;
                const calleeNode = calleeRef ? snapshot.nodeMap.get(calleeRef.irNodeId) : null;
                if (calleeNode && calleeNode.type === 'MemberExpression' && !calleeNode.props.computed) {
                    const objRef = calleeNode.props.object;
                    const objNode = objRef ? snapshot.nodeMap.get(objRef.irNodeId) : null;
                    const propRef = calleeNode.props.property;
                    const propNode = propRef ? snapshot.nodeMap.get(propRef.irNodeId) : null;

                    if (objNode && objNode.type === 'Identifier' && propNode && propNode.type === 'Identifier') {
                        const objDeclId = snapshot.refToDeclMap.get(objNode.irNodeId) || objNode.irNodeId;
                        const methodName = propNode.props.name;
                        if (['push', 'unshift'].includes(methodName) && !snapshot.escapedVars.has(objDeclId)) {
                            arrayDeclIds.add(objDeclId);
                            instDeclIds.add(objDeclId);
                        } else { 
                            logInfo(`[ClassToTuple] Tracking failed for "${className}". Unsafe method call: ${methodName}`);
                            trackSuccess = false; break; 
                        }
                    } else { 
                        logInfo(`[ClassToTuple] Tracking failed for "${className}". CallExpression callee object is not Identifier.`);
                        trackSuccess = false; break; 
                    }
                } else { 
                    logInfo(`[ClassToTuple] Tracking failed for "${className}". CallExpression callee is not MemberExpression.`);
                    trackSuccess = false; break; 
                }
            }
            else { 
                logInfo(`[ClassToTuple] Tracking failed for "${className}". Instance escaped into unhandled parent node type: ${parentNode.type}`);
                trackSuccess = false; 
                break; 
            }
        }

        if (!trackSuccess) continue;

        let added = true;
        while (added) {
            added = false;
            for (const [id, irNode] of snapshot.nodeMap.entries()) {
                
                if (irNode.type === 'ForOfStatement') {
                    const rightRef = irNode.props.right;
                    const rightNode = rightRef ? snapshot.nodeMap.get(rightRef.irNodeId) : null;
                    if (rightNode && rightNode.type === 'Identifier') {
                        const rightDeclId = snapshot.refToDeclMap.get(rightNode.irNodeId) || rightNode.irNodeId;
                        if (arrayDeclIds.has(rightDeclId)) {
                            const leftRef = irNode.props.left;
                            const leftNode = leftRef ? snapshot.nodeMap.get(leftRef.irNodeId) : null;
                            let successfullyTracked = false;
                            if (leftNode && leftNode.type === 'VariableDeclaration') {
                                const decls = leftNode.props.declarations || [];
                                if (decls.length > 0) {
                                    const decltorRef = decls[0];
                                    if (decltorRef && decltorRef.type === 'ref') {
                                        const decltorNode = snapshot.nodeMap.get(decltorRef.irNodeId);
                                        if (decltorNode && decltorNode.type === 'VariableDeclarator') {
                                            const idRef = decltorNode.props.id;
                                            const idNode = idRef ? snapshot.nodeMap.get(idRef.irNodeId) : null;
                                            if (idNode && idNode.type === 'Identifier') {
                                                const paramDeclId = idNode.irNodeId;
                                                if (!instDeclIds.has(paramDeclId)) {
                                                    if (snapshot.escapedVars.has(paramDeclId)) { trackSuccess = false; break; }
                                                    instDeclIds.add(paramDeclId);
                                                    added = true;
                                                }
                                                successfullyTracked = true;
                                            }
                                        }
                                    }
                                }
                            }
                            if (!successfullyTracked) { trackSuccess = false; break; }
                        }
                    }
                }

                if (irNode.type === 'VariableDeclarator') {
                    const initRef = irNode.props.init;
                    const initNode = initRef ? snapshot.nodeMap.get(initRef.irNodeId) : null;
                    if (initNode) {
                        let isFromInst = false;
                        let isArraySource = false;
                        if (initNode.type === 'Identifier') {
                            const initDeclId = snapshot.refToDeclMap.get(initNode.irNodeId) || initNode.irNodeId;
                            if (instDeclIds.has(initDeclId)) {
                                isFromInst = true;
                                if (arrayDeclIds.has(initDeclId)) isArraySource = true;
                            }
                        } else if (initNode.type === 'MemberExpression') {
                            const objRef = initNode.props.object;
                            const objNode = objRef ? snapshot.nodeMap.get(objRef.irNodeId) : null;
                            if (objNode && objNode.type === 'Identifier') {
                                const objDeclId = snapshot.refToDeclMap.get(objNode.irNodeId) || objNode.irNodeId;
                                if (instDeclIds.has(objDeclId)) {
                                    isFromInst = true;
                                    isArraySource = !arrayDeclIds.has(objDeclId);
                                }
                            }
                        } else if (initNode.type === 'CallExpression') {
                            const calleeRef = initNode.props.callee;
                            const calleeNode = calleeRef ? snapshot.nodeMap.get(calleeRef.irNodeId) : null;
                            if (calleeNode && calleeNode.type === 'MemberExpression') {
                                const objRef = calleeNode.props.object;
                                const objNode = objRef ? snapshot.nodeMap.get(objRef.irNodeId) : null;
                                if (objNode && objNode.type === 'Identifier') {
                                    const objDeclId = snapshot.refToDeclMap.get(objNode.irNodeId) || objNode.irNodeId;
                                    if (instDeclIds.has(objDeclId)) {
                                        isFromInst = true;
                                        isArraySource = !arrayDeclIds.has(objDeclId);
                                    }
                                }
                            }
                        }

                        if (isFromInst) {
                            const idRef = irNode.props.id;
                            const idNode = idRef ? snapshot.nodeMap.get(idRef.irNodeId) : null;
                            if (idNode && idNode.type === 'Identifier') {
                                if (!instDeclIds.has(idNode.irNodeId)) {
                                    if (snapshot.escapedVars.has(idNode.irNodeId)) { trackSuccess = false; break; }
                                    instDeclIds.add(idNode.irNodeId);
                                    if (isArraySource) arrayDeclIds.add(idNode.irNodeId);
                                    added = true;
                                }
                            }
                        }
                    }
                }

                if (irNode.type === 'AssignmentExpression') {
                    const rightRef = irNode.props.right;
                    const rightNode = rightRef ? snapshot.nodeMap.get(rightRef.irNodeId) : null;
                    if (rightNode) {
                        let isFromInst = false;
                        let isArraySource = false;
                        if (rightNode.type === 'Identifier') {
                            const rightDeclId = snapshot.refToDeclMap.get(rightNode.irNodeId) || rightNode.irNodeId;
                            if (instDeclIds.has(rightDeclId)) {
                                isFromInst = true;
                                if (arrayDeclIds.has(rightDeclId)) isArraySource = true;
                            }
                        } else if (rightNode.type === 'MemberExpression') {
                            const objRef = rightNode.props.object;
                            const objNode = objRef ? snapshot.nodeMap.get(objRef.irNodeId) : null;
                            if (objNode && objNode.type === 'Identifier') {
                                const objDeclId = snapshot.refToDeclMap.get(objNode.irNodeId) || objNode.irNodeId;
                                if (instDeclIds.has(objDeclId)) {
                                    isFromInst = true;
                                    isArraySource = !arrayDeclIds.has(objDeclId);
                                }
                            }
                        }
                        if (isFromInst) {
                            const leftRef = irNode.props.left;
                            const leftNode = leftRef ? snapshot.nodeMap.get(leftRef.irNodeId) : null;
                            if (leftNode && leftNode.type === 'Identifier') {
                                const leftDeclId = snapshot.refToDeclMap.get(leftNode.irNodeId) || leftNode.irNodeId;
                                if (!instDeclIds.has(leftDeclId)) {
                                    if (snapshot.escapedVars.has(leftDeclId)) { trackSuccess = false; break; }
                                    instDeclIds.add(leftDeclId);
                                    if (isArraySource) arrayDeclIds.add(leftDeclId);
                                    added = true;
                                }
                            }
                        }
                    }
                }

                if (irNode.type === 'CallExpression') {
                    const calleeRef = irNode.props.callee;
                    const calleeNode = calleeRef ? snapshot.nodeMap.get(calleeRef.irNodeId) : null;
                    if (calleeNode && calleeNode.type === 'MemberExpression' && !calleeNode.props.computed) {
                        const objRef = calleeNode.props.object;
                        const objNode = objRef ? snapshot.nodeMap.get(objRef.irNodeId) : null;
                        const propRef = calleeNode.props.property;
                        const propNode = propRef ? snapshot.nodeMap.get(propRef.irNodeId) : null;

                        if (objNode && objNode.type === 'Identifier' && propNode && propNode.type === 'Identifier') {
                            const objDeclId = snapshot.refToDeclMap.get(objNode.irNodeId) || objNode.irNodeId;
                            const methodName = propNode.props.name;

                            // concatは平坦化によりデータ構造が変化する可能性があるため非対応
                            if (['push', 'unshift'].includes(methodName)) {
                                const args = irNode.props.arguments || [];
                                let hasInstArg = false;
                                for (const argRef of args) {
                                    if (argRef && argRef.type === 'ref') {
                                        const argNode = snapshot.nodeMap.get(argRef.irNodeId);
                                        if (argNode && argNode.type === 'Identifier') {
                                            const argDeclId = snapshot.refToDeclMap.get(argNode.irNodeId) || argNode.irNodeId;
                                            if (instDeclIds.has(argDeclId) && !arrayDeclIds.has(argDeclId)) {
                                                hasInstArg = true; break;
                                            }
                                        }
                                    }
                                }
                                if (hasInstArg) {
                                    if (!arrayDeclIds.has(objDeclId)) {
                                        if (snapshot.escapedVars.has(objDeclId)) { trackSuccess = false; break; }
                                        arrayDeclIds.add(objDeclId);
                                        instDeclIds.add(objDeclId);
                                        added = true;
                                    }
                                }
                            }

                            if (arrayDeclIds.has(objDeclId)) {
                                const sig = SAFE_ARRAY_METHODS[methodName];
                                
                                if (sig) {
                                    const args = irNode.props.arguments || [];
                                    if (args.length > sig.callbackIndex) {
                                        const cbRef = args[sig.callbackIndex];
                                        if (cbRef && cbRef.type === 'ref') {
                                            const cbNode = snapshot.nodeMap.get(cbRef.irNodeId);
                                            // インライン関数式に限定して解析対象とする
                                            if (cbNode && (cbNode.type === 'ArrowFunctionExpression' || cbNode.type === 'FunctionExpression')) {
                                                const params = cbNode.props.params || [];
                                                for (const paramIdx of sig.elementParamIndices) {
                                                    if (params.length > paramIdx) {
                                                        const targetParamRef = params[paramIdx];
                                                        if (targetParamRef && targetParamRef.type === 'ref') {
                                                            const targetParamNode = snapshot.nodeMap.get(targetParamRef.irNodeId);
                                                            if (targetParamNode && targetParamNode.type === 'Identifier') {
                                                                const pDeclId = targetParamNode.irNodeId;
                                                                if (!instDeclIds.has(pDeclId)) {
                                                                    if (snapshot.escapedVars.has(pDeclId)) { trackSuccess = false; break; }
                                                                    instDeclIds.add(pDeclId);
                                                                    added = true;
                                                                }
                                                            } else {
                                                                trackSuccess = false; break; // 分割代入などの複雑なパターンは非対応
                                                            }
                                                        }
                                                    }
                                                }
                                            } else {
                                                trackSuccess = false; break; // 外部定義のコールバック関数は追跡不可のため非対応
                                            }
                                        }
                                    }

                                    if (trackSuccess && (sig.returnsArray || sig.returnsInstance)) {
                                        const parentId = snapshot.parentMap.get(irNode.irNodeId);
                                        let handled = false;
                                        if (parentId) {
                                            const parentNode = snapshot.nodeMap.get(parentId);
                                            if (parentNode && parentNode.type === 'VariableDeclarator') {
                                                const idRef = parentNode.props.id;
                                                const idNode = idRef ? snapshot.nodeMap.get(idRef.irNodeId) : null;
                                                if (idNode && idNode.type === 'Identifier') {
                                                    const idDeclId = idNode.irNodeId;
                                                    if (snapshot.escapedVars.has(idDeclId)) { trackSuccess = false; break; }
                                                    if (!instDeclIds.has(idDeclId) || (sig.returnsArray && !arrayDeclIds.has(idDeclId))) {
                                                        instDeclIds.add(idDeclId);
                                                        if (sig.returnsArray) arrayDeclIds.add(idDeclId);
                                                        added = true;
                                                    }
                                                    handled = true;
                                                }
                                            } else if (parentNode && parentNode.type === 'AssignmentExpression') {
                                                const leftRef = parentNode.props.left;
                                                const leftNode = leftRef ? snapshot.nodeMap.get(leftRef.irNodeId) : null;
                                                if (leftNode && leftNode.type === 'Identifier') {
                                                    const leftDeclId = snapshot.refToDeclMap.get(leftNode.irNodeId) || leftNode.irNodeId;
                                                    if (snapshot.escapedVars.has(leftDeclId)) { trackSuccess = false; break; }
                                                    if (!instDeclIds.has(leftDeclId) || (sig.returnsArray && !arrayDeclIds.has(leftDeclId))) {
                                                        instDeclIds.add(leftDeclId);
                                                        if (sig.returnsArray) arrayDeclIds.add(leftDeclId);
                                                        added = true;
                                                    }
                                                    handled = true;
                                                }
                                            }
                                        }
                                        if (!handled) { trackSuccess = false; break; }
                                    }
                                } else if (!PURE_ARRAY_METHODS.includes(methodName)) {
                                    // 未知のメソッド呼び出しは安全性が保証されないため解析処理を終了
                                    trackSuccess = false; break;
                                }
                            }
                        }
                    }
                }
            }
            if (!trackSuccess) break;
        }

        if (!trackSuccess) continue;

        let isSafeUsage = true;
        for (const [id, irNode] of snapshot.nodeMap.entries()) {
            if (irNode.type === 'Identifier') {
                const declId = snapshot.refToDeclMap.get(irNode.irNodeId) || irNode.irNodeId;
                if (instDeclIds.has(declId)) {
                    const parentId = snapshot.parentMap.get(irNode.irNodeId);
                    const parentNode = parentId ? snapshot.nodeMap.get(parentId) : null;
                    if (!parentNode) { isSafeUsage = false; break; }

                    if (parentNode.type === 'VariableDeclarator' || parentNode.type === 'AssignmentExpression') {
                        let isLeft = false;
                        if (parentNode.type === 'VariableDeclarator') {
                            isLeft = (parentNode.props.id && parentNode.props.id.irNodeId === irNode.irNodeId);
                        } else {
                            isLeft = (parentNode.props.left && parentNode.props.left.irNodeId === irNode.irNodeId);
                        }
                        if (!isLeft) {
                            const leftRef = parentNode.type === 'VariableDeclarator' ? parentNode.props.id : parentNode.props.left;
                            const leftNode = leftRef ? snapshot.nodeMap.get(leftRef.irNodeId) : null;
                            if (!leftNode || leftNode.type !== 'Identifier') { isSafeUsage = false; break; }
                        }
                        continue;
                    }
                    else if (parentNode.type === 'MemberExpression') {
                        if (parentNode.props.object && parentNode.props.object.irNodeId === irNode.irNodeId) {
                            if (parentNode.props.computed) {
                                if (!arrayDeclIds.has(declId)) { isSafeUsage = false; break; }
                            } else {
                                const propRef = parentNode.props.property;
                                const propNode = propRef ? snapshot.nodeMap.get(propRef.irNodeId) : null;
                                if (propNode && propNode.type === 'Identifier') {
                                    const propName = propNode.props.name;
                                    if (arrayDeclIds.has(declId)) {
                                        if (!SAFE_ARRAY_METHODS[propName] && !PURE_ARRAY_METHODS.includes(propName)) {
                                            isSafeUsage = false; break;
                                        }

                                        const sig = SAFE_ARRAY_METHODS[propName];
                                        if (sig && (sig.returnsArray || sig.returnsInstance)) {
                                            const callId = snapshot.parentMap.get(parentNode.irNodeId);
                                            const callNode = callId ? snapshot.nodeMap.get(callId) : null;

                                            if (callNode && callNode.type === 'CallExpression') {
                                                const grandParentId = snapshot.parentMap.get(callNode.irNodeId);
                                                const grandParentNode = grandParentId ? snapshot.nodeMap.get(grandParentId) : null;
                                                if (!grandParentNode) { isSafeUsage = false; break; }

                                                // 戻り値が代入されるか、またはfor-ofの右辺で参照されている場合のみ許可
                                                const isAssigned = 
                                                    grandParentNode.type === 'VariableDeclarator' || 
                                                    grandParentNode.type === 'AssignmentExpression' ||
                                                    grandParentNode.type === 'ForOfStatement';

                                                if (!isAssigned) { 
                                                    isSafeUsage = false; 
                                                    break; 
                                                }
                                            }
                                        }

                                    } else {
                                        if (!propToIndex.has(propName)) { isSafeUsage = false; break; }
                                    }
                                } else { isSafeUsage = false; break; }
                            }
                        }
                        continue;
                    }
                    else if (parentNode.type === 'CallExpression') {
                        let isSafeArg = false;
                        const calleeRef = parentNode.props.callee;
                        const calleeNode = calleeRef ? snapshot.nodeMap.get(calleeRef.irNodeId) : null;
                        if (calleeNode && calleeNode.type === 'MemberExpression' && !calleeNode.props.computed) {
                            const propRef = calleeNode.props.property;
                            const propNode = propRef ? snapshot.nodeMap.get(propRef.irNodeId) : null;
                            if (propNode && propNode.type === 'Identifier') {
                                const propName = propNode.props.name;
                                 // concatは平坦化によりデータ構造が変化する可能性があるため非対応
                                if (['push', 'unshift'].includes(propName)) isSafeArg = true;
                            }
                        }
                        if (!isSafeArg) { isSafeUsage = false; break; }
                    }
                    else if (parentNode.type === 'ForOfStatement') {
                        if (parentNode.props.right && parentNode.props.right.irNodeId === irNode.irNodeId) {
                            if (!arrayDeclIds.has(declId)) { isSafeUsage = false; break; }
                        }
                        continue;
                    }
                    else if (parentNode.type === 'ArrowFunctionExpression' || parentNode.type === 'FunctionExpression' || parentNode.type === 'FunctionDeclaration') {
                        let isParam = false;
                        const params = parentNode.props.params || [];
                        for (const p of params) {
                            if (p && p.irNodeId === irNode.irNodeId) isParam = true;
                        }
                        if (!isParam) { isSafeUsage = false; break; }
                        continue;
                    }
                    else if (parentNode.type === 'IfStatement' || parentNode.type === 'LogicalExpression' || parentNode.type === 'BinaryExpression' || parentNode.type === 'ConditionalExpression') {
                        continue;
                    }
                    else {
                        logInfo(`[ClassToTuple] Safety check failed for "${className}". Variable used in unsafe parent node type: ${parentNode.type}`);
                        isSafeUsage = false; 
                        break;
                    }
                }
            }
        }

        if (!isSafeUsage) continue;

        infos.push({
            classDeclNode: classDecl,
            className,
            classDeclId,
            propToIndex,
            constructorNode,
            instDeclIds,
            arrayDeclIds
        });
    }

    return infos;
}

export const ClassToTupleRule: TransformRule = {
    id: 'macro:class-to-tuple',
    type: 'macro',
    name: 'クラスの配列（タプル）化',
    description: 'プライベートプロパティのみを持つデータ用クラス（DTO）を通常の配列へと変換し、メモリ使用量と実行時のオーバーヘッドを削減します。',
    defaultEnabled: true,
    match: (node: IRNode, state: CompilationState): node is ProgramIR => {
        if (node.type !== 'Program') return false;
        
        const infos = findEligibleClasses(node, state);
        return infos.length > 0;
    },
    candidates: (node: IRNode, state: CompilationState) => {
        const genId = () => state.services.generateId!('ir_tuple');
        const prog = node as ProgramIR;
        const snapshot = state.analysisSnapshot!;

        const infos = findEligibleClasses(prog, state);
        if (infos.length === 0) return [];

        let currentProg = prog;

        for (const info of infos) {
            const classDeclNode = info.classDeclNode;
            const className = info.className;
            const classDeclId = info.classDeclId;
            const propToIndex = info.propToIndex;
            const constructorNode = info.constructorNode;
            const instDeclIds = info.instDeclIds;
            const arrayDeclIds = info.arrayDeclIds;

            const factoryFuncName = `_create_${className}`;
            const factoryFuncDeclId = genId();

            const oldToNewId = new Map<string, string>();
            oldToNewId.set(classDeclNode.irNodeId, '__DELETED__');

            const cloneNode = (n: IRNode): IRNode | null => {
                if (n.type === 'ClassDeclaration' && n.irNodeId === classDeclNode.irNodeId) {
                    return null;
                }

                let newNodeId = genId();
                oldToNewId.set(n.irNodeId, newNodeId);

                const newChildren: IRNode[] = [];
                for (const child of n.children) {
                    const clonedChild = cloneNode(child);
                    if (clonedChild) {
                        newChildren.push(clonedChild);
                    }
                }

                let newProps = { ...n.props };

                if (n.type === 'NewExpression') {
                    const calleeId = n.props.callee.irNodeId;
                    const calleeDeclId = snapshot.refToDeclMap.get(calleeId) || calleeId;
                    if (calleeDeclId === classDeclId) {
                        const factoryIdNode: IdentifierIR = {
                            type: 'Identifier',
                            irNodeId: genId(),
                            props: { name: factoryFuncName, _declId: factoryFuncDeclId },
                            children: []
                        };

                        const newCalleeId = oldToNewId.get(calleeId);
                        const finalChildren = newChildren.filter(c => c.irNodeId !== newCalleeId);
                        finalChildren.push(factoryIdNode);

                        newProps.callee = { type: 'ref', irNodeId: factoryIdNode.irNodeId };
                        return {
                            type: 'CallExpression',
                            irNodeId: newNodeId,
                            props: newProps,
                            children: finalChildren
                        } as any;
                    }
                }

                if (n.type === 'MemberExpression' && !n.props.computed) {
                    const objId = n.props.object.irNodeId;
                    const objNode = snapshot.nodeMap.get(objId);
                    
                    let isInstance = false;
                    if (objNode) {
                        if (objNode.type === 'Identifier') {
                            const objDeclId = snapshot.refToDeclMap.get(objId) || objId;
                            if (instDeclIds.has(objDeclId) && !arrayDeclIds.has(objDeclId)) {
                                isInstance = true;
                            }
                        } else if (objNode.type === 'MemberExpression' && objNode.props.computed) {
                            const listObjRef = objNode.props.object;
                            const listObjNode = listObjRef ? snapshot.nodeMap.get(listObjRef.irNodeId) : null;
                            if (listObjNode && listObjNode.type === 'Identifier') {
                                const listDeclId = snapshot.refToDeclMap.get(listObjNode.irNodeId) || listObjNode.irNodeId;
                                if (arrayDeclIds.has(listDeclId)) {
                                    isInstance = true;
                                }
                            }
                        }
                    }

                    if (isInstance) {
                        const propRef = n.props.property;
                        const propNode = propRef ? snapshot.nodeMap.get(propRef.irNodeId) : null;
                        if (propNode && propNode.type === 'Identifier') {
                            const propName = propNode.props.name;
                            if (propToIndex.has(propName)) {
                                const idx = propToIndex.get(propName)!;

                                const numLiteralNode: NumericLiteralIR = {
                                    type: 'NumericLiteral',
                                    irNodeId: genId(),
                                    props: { value: idx },
                                    children: []
                                };

                                const newPropId = oldToNewId.get(propNode.irNodeId);
                                const finalChildren = newChildren.filter(c => c.irNodeId !== newPropId);
                                finalChildren.push(numLiteralNode);

                                return {
                                    type: 'MemberExpression',
                                    irNodeId: newNodeId,
                                    props: {
                                        ...newProps,
                                        object: newProps.object,
                                        property: { type: 'ref', irNodeId: numLiteralNode.irNodeId },
                                        computed: true
                                    },
                                    children: finalChildren
                                } as any;
                            }
                        }
                    }
                }

                return {
                    type: n.type,
                    irNodeId: newNodeId,
                    props: newProps,
                    children: newChildren
                } as IRNode;
            };

            const newProgBase = cloneNode(currentProg) as ProgramIR;

            const paramIdMap = new Map<string, string>();
            
            if (constructorNode && constructorNode.props.params) {
                for (const paramRef of constructorNode.props.params) {
                    const paramNode = snapshot.nodeMap.get(paramRef.irNodeId);
                    if (paramNode) {
                        if (paramNode.type === 'Identifier') {
                            paramIdMap.set(paramNode.irNodeId, genId());
                        } else if (paramNode.type === 'AssignmentPattern') {
                            const leftRef = paramNode.props.left;
                            if (leftRef && leftRef.type === 'ref') {
                                paramIdMap.set(leftRef.irNodeId, genId());
                            }
                        }
                    }
                }
            }

            const cloneExpression = (n: IRNode): IRNode => {
                let newNodeId = genId();
                oldToNewId.set(n.irNodeId, newNodeId);

                const newChildren: IRNode[] = [];
                for (const child of n.children) {
                    newChildren.push(cloneExpression(child));
                }

                let newProps = { ...n.props };

                if (n.type === 'Identifier') {
                    const declId = snapshot.refToDeclMap.get(n.irNodeId) || n.props._declId || n.irNodeId;
                    const finalDeclId = paramIdMap.has(declId) ? paramIdMap.get(declId)! : declId;
                    
                    const newId = paramIdMap.has(n.irNodeId) ? paramIdMap.get(n.irNodeId)! : newNodeId;
                    oldToNewId.set(n.irNodeId, newId);

                    return {
                        type: 'Identifier',
                        irNodeId: newId,
                        props: {
                            ...n.props,
                            _declId: finalDeclId
                        },
                        children: []
                    } as any;
                }

                return {
                    type: n.type,
                    irNodeId: newNodeId,
                    props: newProps,
                    children: newChildren
                } as IRNode;
            };

            const paramsRefs: any[] = [];
            const factoryParamsChildren: IRNode[] = [];
            if (constructorNode && constructorNode.props.params) {
                for (const paramRef of constructorNode.props.params) {
                    const paramNode = snapshot.nodeMap.get(paramRef.irNodeId);
                    if (paramNode) {
                        const paramClone = cloneExpression(paramNode);
                        factoryParamsChildren.push(paramClone);
                        paramsRefs.push({ type: 'ref', irNodeId: paramClone.irNodeId });
                    }
                }
            }

            const isSimpleDTO = (): boolean => {
                if (!constructorNode) return true;
                const blockRef = constructorNode.props.body;
                if (!blockRef) return true;
                const blockNode = snapshot.nodeMap.get(blockRef.irNodeId);
                if (!blockNode || blockNode.type !== 'BlockStatement') return false;

                const stmtRefs = blockNode.props.body || [];
                for (const stmtRef of stmtRefs) {
                    const stmtNode = snapshot.nodeMap.get(stmtRef.irNodeId);
                    if (!stmtNode) return false;
                    if (stmtNode.type !== 'ExpressionStatement') return false;

                    const exprRef = stmtNode.props.expression;
                    const exprNode = exprRef ? snapshot.nodeMap.get(exprRef.irNodeId) : null;
                    if (!exprNode || exprNode.type !== 'AssignmentExpression' || exprNode.props.operator !== '=') return false;

                    const leftRef = exprNode.props.left;
                    const leftNode = leftRef ? snapshot.nodeMap.get(leftRef.irNodeId) : null;
                    if (!leftNode || leftNode.type !== 'MemberExpression' || leftNode.props.computed) return false;

                    const objRef = leftNode.props.object;
                    const objNode = objRef ? snapshot.nodeMap.get(objRef.irNodeId) : null;
                    if (!objNode || objNode.type !== 'ThisExpression') return false;

                    const propRef = leftNode.props.property;
                    const propNode = propRef ? snapshot.nodeMap.get(propRef.irNodeId) : null;
                    if (!propNode || propNode.type !== 'Identifier') return false;
                }
                return true;
            };

            let factoryFuncNode: IRNode;

            if (isSimpleDTO()) {
                const elementsRefs: any[] = [];
                const arrayChildren: IRNode[] = [];

                const numProps = propToIndex.size;
                const exprForIndex = new Array<IRNode | null>(numProps).fill(null);

                if (constructorNode) {
                    const blockRef = constructorNode.props.body;
                    const blockNode = blockRef ? snapshot.nodeMap.get(blockRef.irNodeId) : null;
                    if (blockNode && blockNode.type === 'BlockStatement') {
                        const stmtRefs = blockNode.props.body || [];
                        for (const stmtRef of stmtRefs) {
                            const stmtNode = snapshot.nodeMap.get(stmtRef.irNodeId);
                            if (stmtNode && stmtNode.type === 'ExpressionStatement') {
                                const exprRef = stmtNode.props.expression;
                                const exprNode = exprRef ? snapshot.nodeMap.get(exprRef.irNodeId) : null;
                                if (exprNode && exprNode.type === 'AssignmentExpression') {
                                    const leftRef = exprNode.props.left;
                                    const leftNode = leftRef ? snapshot.nodeMap.get(leftRef.irNodeId) : null;
                                    if (leftNode && leftNode.type === 'MemberExpression') {
                                        const propRef = leftNode.props.property;
                                        const propNode = propRef ? snapshot.nodeMap.get(propRef.irNodeId) : null;
                                        if (propNode && propNode.type === 'Identifier') {
                                            const propName = propNode.props.name;
                                            const idx = propToIndex.get(propName);
                                            if (idx !== undefined) {
                                                const rightRef = exprNode.props.right;
                                                const rightNode = rightRef ? snapshot.nodeMap.get(rightRef.irNodeId) : null;
                                                if (rightNode) {
                                                    exprForIndex[idx] = rightNode;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                for (let i = 0; i < numProps; i++) {
                    const origExpr = exprForIndex[i];
                    if (origExpr) {
                        const clonedExpr = cloneExpression(origExpr);
                        arrayChildren.push(clonedExpr);
                        elementsRefs.push({ type: 'ref', irNodeId: clonedExpr.irNodeId });
                    } else {
                        const undefNode: IdentifierIR = {
                            type: 'Identifier',
                            irNodeId: genId(),
                            props: { name: 'undefined' },
                            children: []
                        };
                        arrayChildren.push(undefNode);
                        elementsRefs.push({ type: 'ref', irNodeId: undefNode.irNodeId });
                    }
                }

                const arrayNode: IRNode = {
                    type: 'ArrayExpression',
                    irNodeId: genId(),
                    props: { elements: elementsRefs },
                    children: arrayChildren
                };

                const arrowFuncNode: ArrowFunctionExpressionIR = {
                    type: 'ArrowFunctionExpression',
                    irNodeId: genId(),
                    props: {
                        params: paramsRefs,
                        body: { type: 'ref', irNodeId: arrayNode.irNodeId },
                        async: false,
                        generator: false
                    },
                    children: [
                        ...factoryParamsChildren,
                        arrayNode
                    ]
                };

                const factoryIdNode: IdentifierIR = {
                    type: 'Identifier',
                    irNodeId: factoryFuncDeclId,
                    props: { name: factoryFuncName, _declId: factoryFuncDeclId },
                    children: []
                };

                const declaratorNode: VariableDeclaratorIR = {
                    type: 'VariableDeclarator',
                    irNodeId: genId(),
                    props: {
                        id: { type: 'ref', irNodeId: factoryIdNode.irNodeId },
                        init: { type: 'ref', irNodeId: arrowFuncNode.irNodeId }
                    },
                    children: [
                        factoryIdNode,
                        arrowFuncNode
                    ]
                };

                factoryFuncNode = {
                    type: 'VariableDeclaration',
                    irNodeId: genId(),
                    props: {
                        kind: 'const',
                        declarations: [{ type: 'ref', irNodeId: declaratorNode.irNodeId }]
                    },
                    children: [
                        declaratorNode
                    ]
                };
            } else {
                const arrayIdNode: IdentifierIR = {
                    type: 'Identifier',
                    irNodeId: genId(),
                    props: { name: '_t' },
                    children: []
                };
                const initArrayNode: IRNode = {
                    type: 'ArrayExpression',
                    irNodeId: genId(),
                    props: { elements: [] },
                    children: []
                };
                const arrayDeclaratorNode: VariableDeclaratorIR = {
                    type: 'VariableDeclarator',
                    irNodeId: genId(),
                    props: {
                        id: { type: 'ref', irNodeId: arrayIdNode.irNodeId },
                        init: { type: 'ref', irNodeId: initArrayNode.irNodeId }
                    },
                    children: [arrayIdNode, initArrayNode]
                };
                const arrayDeclNode: VariableDeclarationIR = {
                    type: 'VariableDeclaration',
                    irNodeId: genId(),
                    props: {
                        kind: 'const',
                        declarations: [{ type: 'ref', irNodeId: arrayDeclaratorNode.irNodeId }]
                    },
                    children: [arrayDeclaratorNode]
                };

                const cloneConstructorBody = (n: IRNode): IRNode => {
                    let newNodeId = genId();
                    oldToNewId.set(n.irNodeId, newNodeId);

                    const newChildren: IRNode[] = [];
                    for (const child of n.children) {
                        const clonedChild = cloneConstructorBody(child);
                        newChildren.push(clonedChild);
                    }

                    let newProps = { ...n.props };

                    if (n.type === 'Identifier') {
                        const declId = snapshot.refToDeclMap.get(n.irNodeId) || n.props._declId || n.irNodeId;
                        const finalDeclId = paramIdMap.has(declId) ? paramIdMap.get(declId)! : declId;
                        
                        const newId = paramIdMap.has(n.irNodeId) ? paramIdMap.get(n.irNodeId)! : newNodeId;
                        oldToNewId.set(n.irNodeId, newId);

                        return {
                            type: 'Identifier',
                            irNodeId: newId,
                            props: {
                                ...n.props,
                                _declId: finalDeclId
                            },
                            children: []
                        } as any;
                    }

                    if (n.type === 'MemberExpression' && !n.props.computed) {
                        const objRef = n.props.object;
                        const objNode = objRef ? snapshot.nodeMap.get(objRef.irNodeId) : null;
                        if (objNode && objNode.type === 'ThisExpression') {
                            const propRef = n.props.property;
                            const propNode = propRef ? snapshot.nodeMap.get(propRef.irNodeId) : null;
                            if (propNode && propNode.type === 'Identifier') {
                                const propName = propNode.props.name;
                                if (propToIndex.has(propName)) {
                                    const idx = propToIndex.get(propName)!;

                                    const tIdNode: IdentifierIR = {
                                        type: 'Identifier',
                                        irNodeId: genId(),
                                        props: { name: '_t' },
                                        children: []
                                    };
                                    const numLiteralNode: NumericLiteralIR = {
                                        type: 'NumericLiteral',
                                        irNodeId: genId(),
                                        props: { value: idx },
                                        children: []
                                    };

                                    return {
                                        type: 'MemberExpression',
                                        irNodeId: newNodeId,
                                        props: {
                                            ...newProps,
                                            object: { type: 'ref', irNodeId: tIdNode.irNodeId },
                                            property: { type: 'ref', irNodeId: numLiteralNode.irNodeId },
                                            computed: true
                                        },
                                        children: [tIdNode, numLiteralNode]
                                    } as any;
                                }
                            }
                        }
                    }

                    return {
                        type: n.type,
                        irNodeId: newNodeId,
                        props: newProps,
                        children: newChildren
                    } as IRNode;
                };

                let factoryBodyNode: IRNode;
                if (constructorNode && constructorNode.props.body) {
                    const constrBodyNode = snapshot.nodeMap.get(constructorNode.props.body.irNodeId)!;
                    factoryBodyNode = cloneConstructorBody(constrBodyNode);
                } else {
                    factoryBodyNode = {
                        type: 'BlockStatement',
                        irNodeId: genId(),
                        props: { body: [] },
                        children: []
                    };
                }

                const tReturnIdNode: IdentifierIR = {
                    type: 'Identifier',
                    irNodeId: genId(),
                    props: { name: '_t' },
                    children: []
                };
                const returnNode: ReturnStatementIR = {
                    type: 'ReturnStatement',
                    irNodeId: genId(),
                    props: {
                        argument: { type: 'ref', irNodeId: tReturnIdNode.irNodeId }
                    },
                    children: [tReturnIdNode]
                };

                const bodyRefs: any[] = [
                    { type: 'ref', irNodeId: arrayDeclNode.irNodeId }
                ];
                factoryBodyNode.children.push(arrayDeclNode);

                const origBodyRefs = factoryBodyNode.props.body || [];
                for (const ref of origBodyRefs) {
                    bodyRefs.push(ref);
                }

                bodyRefs.push({ type: 'ref', irNodeId: returnNode.irNodeId });
                factoryBodyNode.children.push(returnNode);

                factoryBodyNode.props.body = bodyRefs;

                const factoryFuncNameNode: IdentifierIR = {
                    type: 'Identifier',
                    irNodeId: factoryFuncDeclId,
                    props: { name: factoryFuncName, _declId: factoryFuncDeclId },
                    children: []
                };

                factoryFuncNode = {
                    type: 'FunctionDeclaration',
                    irNodeId: genId(),
                    props: {
                        id: { type: 'ref', irNodeId: factoryFuncNameNode.irNodeId },
                        params: paramsRefs,
                        body: { type: 'ref', irNodeId: factoryBodyNode.irNodeId }
                    },
                    children: [
                        factoryFuncNameNode,
                        ...factoryParamsChildren,
                        factoryBodyNode
                    ]
                };
            }

            newProgBase.children.unshift(factoryFuncNode);
            newProgBase.props.body.unshift({ type: 'ref', irNodeId: factoryFuncNode.irNodeId });

            const updateRefs = (n: IRNode) => {
                for (const [key, val] of Object.entries(n.props)) {
                    if (Array.isArray(val)) {
                        n.props[key] = val.map(ref => {
                            if (ref && ref.type === 'ref') {
                                const newId = oldToNewId.get(ref.irNodeId);
                                if (newId === '__DELETED__') return null;
                                if (newId) return { type: 'ref', irNodeId: newId };
                            }
                            return ref;
                        }).filter(ref => ref !== null);
                    } else if (val && typeof val === 'object' && (val as any).type === 'ref') {
                        const refNodeId = (val as any).irNodeId;
                        const newId = oldToNewId.get(refNodeId);
                        if (newId === '__DELETED__') {
                            n.props[key] = null;
                        } else if (newId) {
                            n.props[key] = { type: 'ref', irNodeId: newId };
                        }
                    }
                }
                
                if (n.type === 'Identifier' && n.props._declId) {
                    const newDeclId = oldToNewId.get(n.props._declId as string);
                    if (newDeclId && newDeclId !== '__DELETED__') {
                        n.props._declId = newDeclId;
                    }
                }

                if (n.children) {
                    for (const child of n.children) updateRefs(child);
                }
            };
            
            updateRefs(newProgBase);

            currentProg = newProgBase;
        }

        if (state.services.logger) {
            state.services.logger({ type: 'info', msg: `[ClassToTuple] AST rewriting completed successfully. Submitting candidates to ASTTransformer...` });
        } else {
            console.log(`[ClassToTuple] AST rewriting completed successfully. Submitting candidates to ASTTransformer...`);
        }
        return [currentProg];
    }
};

