import { IRNode, BlockStatementIR, VariableDeclarationIR, GenericIRNode } from '../../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../../../1_domain/state/CompilationState';
import { TransformRule } from '../../../interface/TransformRule';

// 参照先がターゲットノードの内部に完全に収まっているかを判定する
function isDescendant(childId: string, ancestorId: string, parentMap: ReadonlyMap<string, string>): boolean {
    let curr: string | undefined = childId;
    while (curr) {
        if (curr === ancestorId) return true;
        curr = parentMap.get(curr);
    }
    return false;
}

// 分割代入パターンから変数を再帰的に抽出するヘルパー
function extractIdentifiersFromPattern(n: IRNode, defines: Set<string>, nodeMap: ReadonlyMap<string, IRNode>) {
    if (!n) return;
    if (n.type === 'Identifier') {
        defines.add(n.irNodeId);
        return;
    }
    if (n.type === 'ObjectPattern') {
        const properties = n.props.properties || [];
        for (const propRef of properties) {
            if (propRef && propRef.type === 'ref') {
                const propNode = nodeMap.get(propRef.irNodeId);
                if (propNode) {
                    if (propNode.type === 'Property' || propNode.type === 'ObjectProperty') {
                        const valRef = propNode.props.value;
                        if (valRef && valRef.type === 'ref') {
                            const valNode = nodeMap.get(valRef.irNodeId);
                            if (valNode) extractIdentifiersFromPattern(valNode, defines, nodeMap);
                        }
                    } else if (propNode.type === 'RestElement') {
                        const argRef = propNode.props.argument;
                        if (argRef && argRef.type === 'ref') {
                            const argNode = nodeMap.get(argRef.irNodeId);
                            if (argNode) extractIdentifiersFromPattern(argNode, defines, nodeMap);
                        }
                    }
                }
            }
        }
    } else if (n.type === 'ArrayPattern') {
        const elements = n.props.elements || [];
        for (const elRef of elements) {
            if (elRef && elRef.type === 'ref') {
                const elNode = nodeMap.get(elRef.irNodeId);
                if (elNode) extractIdentifiersFromPattern(elNode, defines, nodeMap);
            }
        }
    } else if (n.type === 'AssignmentPattern') {
        const leftRef = n.props.left;
        if (leftRef && leftRef.type === 'ref') {
            const leftNode = nodeMap.get(leftRef.irNodeId);
            if (leftNode) extractIdentifiersFromPattern(leftNode, defines, nodeMap);
        }
    } else if (n.type === 'RestElement') {
        const argRef = n.props.argument;
        if (argRef && argRef.type === 'ref') {
            const argNode = nodeMap.get(argRef.irNodeId);
            if (argNode) extractIdentifiersFromPattern(argNode, defines, nodeMap);
        }
    }
}

export const ForInitMergeRule: TransformRule = {
    id: 'micro:for-init-merge',
    type: 'micro',
    name: 'Forループ初期化子のマージ',
    description: 'for文の直前にある変数宣言を、for文以降で参照されないことが静的解析で証明された場合に限り、初期化子内に安全に押し込みます。',
    defaultEnabled: true,
    match: (node: IRNode, state: CompilationState): node is BlockStatementIR => {
        if (node.type !== 'BlockStatement' && node.type !== 'Program') return false;
        
        const bodyRefs = node.props['body'];
        if (!Array.isArray(bodyRefs) || bodyRefs.length < 2) return false;

        const snapshot = state.analysisSnapshot;
        if (!snapshot) return false;

        for (let i = 0; i < bodyRefs.length - 1; i++) {
            const currentRef = bodyRefs[i];
            const nextRef = bodyRefs[i + 1];
            if (!currentRef || currentRef.type !== 'ref' || !nextRef || nextRef.type !== 'ref') continue;

            const currentChild = node.children.find(c => c.irNodeId === currentRef.irNodeId);
            const nextChild = node.children.find(c => c.irNodeId === nextRef.irNodeId);

            if (currentChild && nextChild && currentChild.type === 'VariableDeclaration' && nextChild.type === 'ForStatement') {
                const kind = currentChild.props['kind'];
                const forInitRef = nextChild.props['init'];
                
                // 宣言種別の互換性検証
                let isInitCompatible = false;
                if (!forInitRef) {
                    isInitCompatible = true;
                } else if (forInitRef.type === 'ref') {
                    const forInitNode = nextChild.children.find(c => c.irNodeId === forInitRef.irNodeId);
                    if (forInitNode && forInitNode.type === 'VariableDeclaration' && forInitNode.props['kind'] === kind) {
                        isInitCompatible = true;
                    }
                }
                
                if (!isInitCompatible) continue;

                // スコープの生存期間解析
                let isSafeToMerge = true;
                if (kind === 'let' || kind === 'const') {
                    const declaredIds = new Set<string>();
                    for (const dRef of currentChild.props['declarations'] || []) {
                        if (dRef && dRef.type === 'ref') {
                            const dNode = currentChild.children.find(c => c.irNodeId === dRef.irNodeId);
                            if (dNode && dNode.type === 'VariableDeclarator') {
                                const idRef = dNode.props['id'];
                                if (idRef && idRef.type === 'ref') {
                                    const idNode = dNode.children.find(c => c.irNodeId === idRef.irNodeId);
                                    if (idNode) {
                                        // 単なる Identifier だけでなく分割代入なども再帰的に抽出
                                        const rawIds = new Set<string>();
                                        extractIdentifiersFromPattern(idNode, rawIds, snapshot.nodeMap);
                                        for (const rawId of rawIds) {
                                            declaredIds.add(snapshot.refToDeclMap.get(rawId) || rawId);
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // すべての参照ノードがfor文の子孫ノードに収まっているかを判定する
                    for (const [refId, declId] of snapshot.refToDeclMap.entries()) {
                        if (declaredIds.has(declId) && refId !== declId) {
                            if (!isDescendant(refId, nextChild.irNodeId, snapshot.parentMap)) {
                                isSafeToMerge = false;
                                break;
                            }
                        }
                    }
                }

                if (isSafeToMerge) return true;
            }
        }
        return false;
    },
    candidates: (node: IRNode, state: CompilationState) => {
        const genId = () => state.services.generateId!('ir_for_merge');
        const blockNode = node as BlockStatementIR;
        const bodyRefs = blockNode.props['body'] as any[];
        const snapshot = state.analysisSnapshot!;
        
        const newBodyRefs: any[] = [];
        const newChildren: IRNode[] = [];
        let skipNext = false;

        for (let i = 0; i < bodyRefs.length; i++) {
            if (skipNext) {
                skipNext = false;
                continue;
            }

            const currentRef = bodyRefs[i];
            const nextRef = i < bodyRefs.length - 1 ? bodyRefs[i + 1] : null;
            let merged = false;

            if (currentRef && currentRef.type === 'ref' && nextRef && nextRef.type === 'ref') {
                const currentChild = blockNode.children.find(c => c.irNodeId === currentRef.irNodeId);
                const nextChild = blockNode.children.find(c => c.irNodeId === nextRef.irNodeId);

                if (currentChild && nextChild && currentChild.type === 'VariableDeclaration' && nextChild.type === 'ForStatement') {
                    const kind = currentChild.props['kind'];
                    const forInitRef = nextChild.props['init'];
                    
                    let canMerge = false;
                    let existingForDecls: any[] = [];
                    let existingForDeclChildren: IRNode[] = [];

                    if (!forInitRef) {
                        canMerge = true;
                    } else if (forInitRef.type === 'ref') {
                        const forInitNode = nextChild.children.find(c => c.irNodeId === forInitRef.irNodeId);
                        if (forInitNode && forInitNode.type === 'VariableDeclaration' && forInitNode.props['kind'] === kind) {
                            canMerge = true;
                            existingForDecls = forInitNode.props['declarations'] || [];
                            for (const dRef of existingForDecls) {
                                const dNode = forInitNode.children.find(c => c.irNodeId === dRef.irNodeId);
                                if (dNode) existingForDeclChildren.push(dNode);
                            }
                        }
                    }

                    // 候補生成時におけるスコープの安全性検証
                    if (canMerge && (kind === 'let' || kind === 'const')) {
                        const declaredIds = new Set<string>();
                        for (const dRef of currentChild.props['declarations'] || []) {
                            const dNode = currentChild.children.find(c => c.irNodeId === dRef.irNodeId);
                            if (dNode && dNode.type === 'VariableDeclarator') {
                                const idNode = dNode.children.find(c => c.irNodeId === dNode.props['id']?.irNodeId);
                                if (idNode) {
                                    const rawIds = new Set<string>();
                                    extractIdentifiersFromPattern(idNode, rawIds, snapshot.nodeMap);
                                    for (const rawId of rawIds) {
                                        declaredIds.add(snapshot.refToDeclMap.get(rawId) || rawId);
                                    }
                                }
                            }
                        }
                        for (const [refId, declId] of snapshot.refToDeclMap.entries()) {
                            if (declaredIds.has(declId) && refId !== declId) {
                                if (!isDescendant(refId, nextChild.irNodeId, snapshot.parentMap)) {
                                    canMerge = false;
                                    break;
                                }
                            }
                        }
                    }

                    if (canMerge) {
                        const mergedDeclarations = [...(currentChild.props['declarations'] || []), ...existingForDecls];
                        const currentDeclChildren = (currentChild.props['declarations'] || []).map((dRef: any) => currentChild.children.find(c => c.irNodeId === dRef.irNodeId)).filter(Boolean);

                        const mergedVarDeclNode: VariableDeclarationIR = {
                            type: 'VariableDeclaration',
                            irNodeId: genId(),
                            props: { kind, declarations: mergedDeclarations },
                            children: [...currentDeclChildren, ...existingForDeclChildren]
                        };

                        const newForChildren = nextChild.children.filter(c => !forInitRef || c.irNodeId !== forInitRef.irNodeId);
                        newForChildren.push(mergedVarDeclNode);

                        const newForNode: GenericIRNode = {
                            ...nextChild,
                            irNodeId: genId(),
                            props: { ...nextChild.props, init: { type: 'ref', irNodeId: mergedVarDeclNode.irNodeId } },
                            children: newForChildren
                        };

                        newBodyRefs.push({ type: 'ref', irNodeId: newForNode.irNodeId });
                        newChildren.push(newForNode);
                        skipNext = true;
                        merged = true;
                    }
                }
            }

            if (!merged) {
                const currentChild = blockNode.children.find(c => c.irNodeId === currentRef.irNodeId);
                if (currentChild) {
                    newBodyRefs.push(currentRef);
                    newChildren.push(currentChild);
                }
            }
        }

        const newNode: IRNode = {
            ...blockNode,
            irNodeId: genId(),
            props: { ...blockNode.props, body: newBodyRefs },
            children: newChildren
        };

        return [newNode];
    }
};