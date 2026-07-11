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

function findEligibleClasses(program: IRNode, state: CompilationState): ClassInfo[] {
    const snapshot = state.analysisSnapshot;
    if (!snapshot) return [];

    const infos: ClassInfo[] = [];

    // Find all ClassDeclarations in the program
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
            continue;
        }

        if (classDecl.props.superClass) {
            continue;
        }

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
                if (n.type === 'ThisExpression') {
                    result.push(n);
                }
                for (const child of n.children) {
                    findThisNodes(child, result);
                }
            };
            const thisNodes: IRNode[] = [];
            findThisNodes(constructorNode, thisNodes);

            for (const thisNode of thisNodes) {
                const parentId = snapshot.parentMap.get(thisNode.irNodeId);
                const parentNode = parentId ? snapshot.nodeMap.get(parentId) : null;
                if (!parentNode || parentNode.type !== 'MemberExpression' || parentNode.props.object.irNodeId !== thisNode.irNodeId) {
                    isThisSafe = false;
                    break;
                }

                const grandParentId = snapshot.parentMap.get(parentNode.irNodeId);
                const grandParentNode = grandParentId ? snapshot.nodeMap.get(grandParentId) : null;
                if (grandParentNode && grandParentNode.type === 'CallExpression' && grandParentNode.props.callee.irNodeId === parentNode.irNodeId) {
                    isThisSafe = false;
                    break;
                }
            }
        }

        if (!isThisSafe) {
            continue;
        }

        let hasInstanceof = false;
        for (const [id, irNode] of snapshot.nodeMap.entries()) {
            if (irNode.type === 'BinaryExpression' && irNode.props.operator === 'instanceof') {
                const rightId = irNode.props.right.irNodeId;
                const rightDeclId = snapshot.refToDeclMap.get(rightId) || rightId;
                if (rightDeclId === classDeclId) {
                    hasInstanceof = true;
                    break;
                }
            }
        }
        if (hasInstanceof) {
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
                if (calleeDeclId === classDeclId) {
                    initNewExprs.push(irNode);
                }
            }
        }

        const queue: IRNode[] = [...initNewExprs];
        const visitedNew = new Set<string>();

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visitedNew.has(current.irNodeId)) continue;
            visitedNew.add(current.irNodeId);

            const parentId = snapshot.parentMap.get(current.irNodeId);
            const parentNode = parentId ? snapshot.nodeMap.get(parentId) : null;

            if (!parentNode) {
                trackSuccess = false;
                break;
            }

            if (parentNode.type === 'VariableDeclarator') {
                const idRef = parentNode.props.id;
                const idNode = idRef ? snapshot.nodeMap.get(idRef.irNodeId) : null;
                if (idNode && idNode.type === 'Identifier') {
                    if (snapshot.escapedVars.has(idNode.irNodeId)) {
                        trackSuccess = false;
                        break;
                    }
                    instDeclIds.add(idNode.irNodeId);
                } else {
                    trackSuccess = false;
                    break;
                }
            }
            else if (parentNode.type === 'AssignmentExpression') {
                const leftRef = parentNode.props.left;
                const leftNode = leftRef ? snapshot.nodeMap.get(leftRef.irNodeId) : null;
                if (leftNode && leftNode.type === 'Identifier') {
                    const leftDeclId = snapshot.refToDeclMap.get(leftNode.irNodeId) || leftNode.irNodeId;
                    if (snapshot.escapedVars.has(leftDeclId)) {
                        trackSuccess = false;
                        break;
                    }
                    instDeclIds.add(leftDeclId);
                } else {
                    trackSuccess = false;
                    break;
                }
            }
            else if (parentNode.type === 'CallExpression') {
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

                        const isSafeArrayMethod = methodName === 'push' || methodName === 'unshift' || methodName === 'concat';
                        if (isSafeArrayMethod && !snapshot.escapedVars.has(objDeclId)) {
                            arrayDeclIds.add(objDeclId);
                            instDeclIds.add(objDeclId);
                        } else {
                            trackSuccess = false;
                            break;
                        }
                    } else {
                        trackSuccess = false;
                        break;
                    }
                } else {
                    trackSuccess = false;
                    break;
                }
            }
            else {
                trackSuccess = false;
                break;
            }
        }

        if (!trackSuccess) {
            continue;
        }

        let added = true;
        while (added) {
            added = false;
            for (const [id, irNode] of snapshot.nodeMap.entries()) {
                
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
                        }
                        else if (initNode.type === 'MemberExpression') {
                            const objRef = initNode.props.object;
                            const objNode = objRef ? snapshot.nodeMap.get(objRef.irNodeId) : null;
                            if (objNode && objNode.type === 'Identifier') {
                                const objDeclId = snapshot.refToDeclMap.get(objNode.irNodeId) || objNode.irNodeId;
                                if (instDeclIds.has(objDeclId)) {
                                    isFromInst = true;
                                    if (arrayDeclIds.has(objDeclId)) {
                                        isArraySource = false; 
                                    } else {
                                        isArraySource = true;
                                    }
                                }
                            }
                        }
                        else if (initNode.type === 'CallExpression') {
                            const calleeRef = initNode.props.callee;
                            const calleeNode = calleeRef ? snapshot.nodeMap.get(calleeRef.irNodeId) : null;
                            if (calleeNode && calleeNode.type === 'MemberExpression') {
                                const objRef = calleeNode.props.object;
                                const objNode = objRef ? snapshot.nodeMap.get(objRef.irNodeId) : null;
                                if (objNode && objNode.type === 'Identifier') {
                                    const objDeclId = snapshot.refToDeclMap.get(objNode.irNodeId) || objNode.irNodeId;
                                    if (instDeclIds.has(objDeclId)) {
                                        isFromInst = true;
                                        if (arrayDeclIds.has(objDeclId)) isArraySource = false;
                                        else isArraySource = true;
                                    }
                                }
                            }
                        }

                        if (isFromInst) {
                            const idRef = irNode.props.id;
                            const idNode = idRef ? snapshot.nodeMap.get(idRef.irNodeId) : null;
                            if (idNode && idNode.type === 'Identifier') {
                                if (!instDeclIds.has(idNode.irNodeId)) {
                                    if (snapshot.escapedVars.has(idNode.irNodeId)) {
                                        trackSuccess = false;
                                        break;
                                    }
                                    instDeclIds.add(idNode.irNodeId);
                                    if (isArraySource) {
                                        arrayDeclIds.add(idNode.irNodeId);
                                    }
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
                        }
                        else if (rightNode.type === 'MemberExpression') {
                            const objRef = rightNode.props.object;
                            const objNode = objRef ? snapshot.nodeMap.get(objRef.irNodeId) : null;
                            if (objNode && objNode.type === 'Identifier') {
                                const objDeclId = snapshot.refToDeclMap.get(objNode.irNodeId) || objNode.irNodeId;
                                if (instDeclIds.has(objDeclId)) {
                                    isFromInst = true;
                                    if (arrayDeclIds.has(objDeclId)) {
                                        isArraySource = false; 
                                    } else {
                                        isArraySource = true;
                                    }
                                }
                            }
                        }

                        if (isFromInst) {
                            const leftRef = irNode.props.left;
                            const leftNode = leftRef ? snapshot.nodeMap.get(leftRef.irNodeId) : null;
                            if (leftNode && leftNode.type === 'Identifier') {
                                const leftDeclId = snapshot.refToDeclMap.get(leftNode.irNodeId) || leftNode.irNodeId;
                                if (!instDeclIds.has(leftDeclId)) {
                                    if (snapshot.escapedVars.has(leftDeclId)) {
                                        trackSuccess = false;
                                        break;
                                    }
                                    instDeclIds.add(leftDeclId);
                                    if (isArraySource) {
                                        arrayDeclIds.add(leftDeclId);
                                    }
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

                            if (methodName === 'push' || methodName === 'unshift' || methodName === 'concat') {
                                const args = irNode.props.arguments || [];
                                let hasInstArg = false;
                                for (const argRef of args) {
                                    if (argRef && argRef.type === 'ref') {
                                        const argNode = snapshot.nodeMap.get(argRef.irNodeId);
                                        if (argNode && argNode.type === 'Identifier') {
                                            const argDeclId = snapshot.refToDeclMap.get(argNode.irNodeId) || argNode.irNodeId;
                                            if (instDeclIds.has(argDeclId) && !arrayDeclIds.has(argDeclId)) {
                                                hasInstArg = true;
                                                break;
                                            }
                                        }
                                    }
                                }

                                if (hasInstArg) {
                                    if (!arrayDeclIds.has(objDeclId)) {
                                        if (snapshot.escapedVars.has(objDeclId)) {
                                            trackSuccess = false;
                                            break;
                                        }
                                        arrayDeclIds.add(objDeclId);
                                        instDeclIds.add(objDeclId);
                                        added = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (!trackSuccess) break;
        }

        if (!trackSuccess) {
            continue;
        }

        let hasDynamicAccess = false;
        for (const [id, irNode] of snapshot.nodeMap.entries()) {
            if (irNode.type === 'MemberExpression' && irNode.props.computed) {
                const objRef = irNode.props.object;
                const objNode = objRef ? snapshot.nodeMap.get(objRef.irNodeId) : null;
                if (objNode && objNode.type === 'Identifier') {
                    const objDeclId = snapshot.refToDeclMap.get(objNode.irNodeId) || objNode.irNodeId;
                    
                    if (instDeclIds.has(objDeclId) && !arrayDeclIds.has(objDeclId)) {
                        hasDynamicAccess = true;
                        break;
                    }
                }
            }
        }

        if (hasDynamicAccess) {
            continue;
        }

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
    description: '完全に隠蔽されたデータ用クラス（DTO）を通常の配列へと変換し、高効率・低フットプリント化します。',
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

            const cloneNode = (n: IRNode): IRNode | null => {
                if (n.type === 'ClassDeclaration' && n.irNodeId === classDeclNode.irNodeId) {
                    return null;
                }

                const newChildren: IRNode[] = [];
                const childIdMap = new Map<string, string>();
                for (const child of n.children) {
                    const clonedChild = cloneNode(child);
                    if (clonedChild) {
                        newChildren.push(clonedChild);
                        if (child.irNodeId !== clonedChild.irNodeId) {
                            childIdMap.set(child.irNodeId, clonedChild.irNodeId);
                        }
                    }
                }

                let newProps = { ...n.props };
                for (const [key, val] of Object.entries(newProps)) {
                    if (Array.isArray(val)) {
                        newProps[key] = val
                            .map(ref => {
                                if (ref && ref.type === 'ref') {
                                    const childNode = snapshot.nodeMap.get(ref.irNodeId);
                                    if (childNode && childNode.type === 'ClassDeclaration' && childNode.irNodeId === classDeclNode.irNodeId) {
                                        return null;
                                    }
                                    if (childIdMap.has(ref.irNodeId)) {
                                        return { type: 'ref', irNodeId: childIdMap.get(ref.irNodeId)! };
                                    }
                                    return ref;
                                }
                                return ref;
                            })
                            .filter(ref => ref !== null);
                    } else if (val && typeof val === 'object' && (val as any).type === 'ref') {
                        const refNodeId = (val as any).irNodeId;
                        const childNode = snapshot.nodeMap.get(refNodeId);
                        if (childNode && childNode.type === 'ClassDeclaration' && childNode.irNodeId === classDeclNode.irNodeId) {
                            newProps[key] = null;
                        } else if (childIdMap.has(refNodeId)) {
                            newProps[key] = { type: 'ref', irNodeId: childIdMap.get(refNodeId)! };
                        }
                    }
                }

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

                        const finalChildren = newChildren.filter(c => c.irNodeId !== calleeId);
                        finalChildren.push(factoryIdNode);

                        newProps.callee = { type: 'ref', irNodeId: factoryIdNode.irNodeId };
                        return {
                            type: 'CallExpression',
                            irNodeId: n.irNodeId,
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
                            // 1. 変数アクセス (例: currentNode.x)
                            const objDeclId = snapshot.refToDeclMap.get(objId) || objId;
                            // 配列変数自身（openList等）へのプロパティアクセス（length等）を誤変換しないよう除外
                            if (instDeclIds.has(objDeclId) && !arrayDeclIds.has(objDeclId)) {
                                isInstance = true;
                            }
                        } else if (objNode.type === 'MemberExpression' && objNode.props.computed) {
                            // 2. 配列インデックスアクセス (例: openList[i].x)
                            const listObjRef = objNode.props.object;
                            const listObjNode = listObjRef ? snapshot.nodeMap.get(listObjRef.irNodeId) : null;
                            if (listObjNode && listObjNode.type === 'Identifier') {
                                const listDeclId = snapshot.refToDeclMap.get(listObjNode.irNodeId) || listObjNode.irNodeId;
                                // その配列自身がインスタンスのコンテナとしてトラッカーに登録されているか
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

                                const finalChildren = newChildren.filter(c => c.irNodeId !== propNode.irNodeId);
                                finalChildren.push(numLiteralNode);

                                return {
                                    type: 'MemberExpression',
                                    irNodeId: n.irNodeId,
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
                    irNodeId: n.irNodeId,
                    props: newProps,
                    children: newChildren
                } as IRNode;
            };

            const newProgBase = cloneNode(currentProg) as ProgramIR;

            const paramIdMap = new Map<string, string>();
            
            // Step 1: 元のパラメータ宣言の declId を特定し、新しい ID を事前に割り当てる
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

            // Step 2: 汎用ディープクローン関数（パラメータや式を安全に再帰コピーする）
            const cloneExpression = (n: IRNode): IRNode => {
                const newChildren: IRNode[] = [];
                for (const child of n.children) {
                    newChildren.push(cloneExpression(child));
                }

                let newProps = { ...n.props };

                if (n.type === 'Identifier') {
                    const declId = snapshot.refToDeclMap.get(n.irNodeId) || n.props._declId || n.irNodeId;
                    const finalDeclId = paramIdMap.has(declId) ? paramIdMap.get(declId)! : declId;
                    
                    // 自分が「宣言」そのものである場合は、先ほど事前生成したIDを付与する
                    const newId = paramIdMap.has(n.irNodeId) ? paramIdMap.get(n.irNodeId)! : genId();

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

                const childIdMap = new Map<string, string>();
                for (let i = 0; i < n.children.length; i++) {
                    childIdMap.set(n.children[i].irNodeId, newChildren[i].irNodeId);
                }

                for (const [key, val] of Object.entries(newProps)) {
                    if (Array.isArray(val)) {
                        newProps[key] = val.map(ref => {
                            if (ref && ref.type === 'ref') {
                                if (childIdMap.has(ref.irNodeId)) {
                                    return { type: 'ref', irNodeId: childIdMap.get(ref.irNodeId)! };
                                }
                            }
                            return ref;
                        });
                    } else if (val && typeof val === 'object' && (val as any).type === 'ref') {
                        const refNodeId = (val as any).irNodeId;
                        if (childIdMap.has(refNodeId)) {
                            newProps[key] = { type: 'ref', irNodeId: childIdMap.get(refNodeId)! };
                        }
                    }
                }

                return {
                    type: n.type,
                    irNodeId: genId(),
                    props: newProps,
                    children: newChildren
                } as IRNode;
            };

            // Step 3: パラメータリスト全体を安全にディープクローン
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
            // =========================================================================================

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
                    const newChildren: IRNode[] = [];
                    for (const child of n.children) {
                        newChildren.push(cloneConstructorBody(child));
                    }

                    let newProps = { ...n.props };

                    if (n.type === 'Identifier') {
                        const declId = snapshot.refToDeclMap.get(n.irNodeId) || n.props._declId || n.irNodeId;
                        const finalDeclId = paramIdMap.has(declId) ? paramIdMap.get(declId)! : declId;
                        return {
                            type: 'Identifier',
                            irNodeId: genId(),
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
                                        irNodeId: genId(),
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

                    const childIdMap = new Map<string, string>();
                    for (let i = 0; i < n.children.length; i++) {
                        childIdMap.set(n.children[i].irNodeId, newChildren[i].irNodeId);
                    }

                    for (const [key, val] of Object.entries(newProps)) {
                        if (Array.isArray(val)) {
                            newProps[key] = val.map(ref => {
                                if (ref && ref.type === 'ref') {
                                    if (childIdMap.has(ref.irNodeId)) {
                                        return { type: 'ref', irNodeId: childIdMap.get(ref.irNodeId)! };
                                    }
                                }
                                return ref;
                            });
                        } else if (val && typeof val === 'object' && (val as any).type === 'ref') {
                            const refNodeId = (val as any).irNodeId;
                            if (childIdMap.has(refNodeId)) {
                                newProps[key] = { type: 'ref', irNodeId: childIdMap.get(refNodeId)! };
                            }
                        }
                    }

                    return {
                        type: n.type,
                        irNodeId: genId(),
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

            currentProg = newProgBase;
        }

        console.debug(`[TransformRule] ${ClassToTupleRule.id} rewritten successfully.`);
        return [currentProg];
    }
};