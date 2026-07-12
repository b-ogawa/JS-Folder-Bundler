import { IRNode } from '../../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { CFGBlock } from '../../../1_domain/analysis/models/CFGBlock';
import { LivenessData, ReachingDefData } from '../../../1_domain/analysis/models/NodeDataFlowSets';

function getChild(node: IRNode, propName: string): IRNode | null {
    const ref = node.props[propName];
    if (ref && ref.type === 'ref') {
        return node.children.find(c => c.irNodeId === ref.irNodeId) || null;
    }
    return null;
}

function extractIdentifiersFromPattern(n: IRNode, defines: Set<string>, nodeMap: Map<string, IRNode>) {
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

function getDefinedVars(node: IRNode, refToDeclMap: Map<string, string>, nodeMap: Map<string, IRNode>): string[] {
    const vars: string[] = [];
    if (node.type === 'VariableDeclarator') {
        const idNode = getChild(node, 'id');
        if (idNode) {
            const rawIds = new Set<string>();
            extractIdentifiersFromPattern(idNode, rawIds, nodeMap);
            for (const rawId of rawIds) {
                const declId = refToDeclMap.get(rawId) || rawId;
                vars.push(declId);
            }
        }
    } else if (node.type === 'AssignmentExpression') {
        const leftNode = getChild(node, 'left');
        if (leftNode) {
            const rawIds = new Set<string>();
            extractIdentifiersFromPattern(leftNode, rawIds, nodeMap);
            for (const rawId of rawIds) {
                const declId = refToDeclMap.get(rawId) || rawId;
                vars.push(declId);
            }
        }
    } else if (node.type === 'UpdateExpression') {
        const argNode = getChild(node, 'argument');
        if (argNode && argNode.type === 'Identifier') {
            const declId = refToDeclMap.get(argNode.irNodeId) || argNode.irNodeId;
            vars.push(declId);
        }
    }
    return vars;
}

function isLVal(node: IRNode, parentMap: Map<string, string>, nodeMap: Map<string, IRNode>): boolean {
    const parentId = parentMap.get(node.irNodeId);
    if (!parentId) return false;
    const parent = nodeMap.get(parentId);
    if (!parent) return false;

    if (parent.type === 'VariableDeclarator' && getChild(parent, 'id')?.irNodeId === node.irNodeId) return true;
    if (parent.type === 'AssignmentExpression' && getChild(parent, 'left')?.irNodeId === node.irNodeId) return true;
    if (parent.type === 'UpdateExpression' && getChild(parent, 'argument')?.irNodeId === node.irNodeId) return true;
    
    let curr: IRNode | undefined = parent;
    let childId = node.irNodeId;
    while (curr) {
        if (curr.type === 'Property' || curr.type === 'ObjectProperty') {
            if (getChild(curr, 'value')?.irNodeId === childId) {
                // value側ならLValの可能性継続
            } else if (curr.props.shorthand) {
                // shorthandなら継続
            } else {
                return false;
            }
        }
        if (curr.type === 'ObjectPattern' || curr.type === 'ArrayPattern' || curr.type === 'AssignmentPattern' || curr.type === 'RestElement') {
            return true;
        }
        childId = curr.irNodeId;
        const nextParentId = parentMap.get(curr.irNodeId);
        curr = nextParentId ? nodeMap.get(nextParentId) : undefined;
    }

    return false;
}

export class IRDataFlowExtractor {
    public static extractLivenessData(
        blocks: Map<string, CFGBlock>,
        refToDeclMap: Map<string, string>,
        parentMap: Map<string, string>,
        nodeMap: Map<string, IRNode>
    ): Map<string, LivenessData> {
        const dataMap = new Map<string, LivenessData>();
        
        for (const block of blocks.values()) {
            for (const node of block.nodes) {
                const def = new Set<string>();
                const use = new Set<string>();
                
                const definedVars = getDefinedVars(node, refToDeclMap, nodeMap);
                for (const varName of definedVars) {
                    def.add(varName);
                }

                if (node.type === 'Identifier' && !isLVal(node, parentMap, nodeMap)) {
                    const declId = refToDeclMap.get(node.irNodeId);
                    if (declId) use.add(declId);
                }
                if (node.type === 'UpdateExpression') {
                    const arg = getChild(node, 'argument');
                    if (arg && arg.type === 'Identifier') {
                        const declId = refToDeclMap.get(arg.irNodeId);
                        if (declId) use.add(declId);
                    }
                }
                if (node.type === 'AssignmentExpression') {
                    const op = node.props.operator;
                    if (op && op !== '=') {
                        const leftNode = getChild(node, 'left');
                        if (leftNode) {
                            const rawIds = new Set<string>();
                            extractIdentifiersFromPattern(leftNode, rawIds, nodeMap);
                            for (const rawId of rawIds) {
                                const declId = refToDeclMap.get(rawId);
                                if (declId) use.add(declId);
                            }
                        }
                    }
                }
                
                dataMap.set(node.irNodeId, { def, use });
            }
        }
        
        return dataMap;
    }

    public static extractReachingDefData(
        blocks: Map<string, CFGBlock>,
        refToDeclMap: Map<string, string>,
        nodeMap: Map<string, IRNode>
    ): { dataMap: Map<string, ReachingDefData>, defsByVar: Map<string, Set<string>>, defToVar: Map<string, string[]> } {
        const dataMap = new Map<string, ReachingDefData>();
        const defsByVar = new Map<string, Set<string>>();
        const defToVar = new Map<string, string[]>(); 
        
        // First pass: Collect all definitions
        for (const block of blocks.values()) {
            for (const node of block.nodes) {
                const definedVars = getDefinedVars(node, refToDeclMap, nodeMap);
                if (definedVars.length > 0) {
                    defToVar.set(node.irNodeId, definedVars); // 上書きではなく定義された全変数のリストをセットする
                    for (const declId of definedVars) {
                        if (!defsByVar.has(declId)) {
                            defsByVar.set(declId, new Set<string>());
                        }
                        defsByVar.get(declId)!.add(node.irNodeId);
                    }
                }
            }
        }
        
        // Second pass: Compute gen and kill sets
        for (const block of blocks.values()) {
            for (const node of block.nodes) {
                const gen = new Set<string>();
                const kill = new Set<string>();
                
                const definedVars = getDefinedVars(node, refToDeclMap, nodeMap);
                if (definedVars.length > 0) {
                    for (const declId of definedVars) {
                        const allDefsForVar = defsByVar.get(declId);
                        if (allDefsForVar) {
                            for (const defId of allDefsForVar) {
                                kill.add(defId);
                            }
                        }
                    }
                    gen.add(node.irNodeId);
                }
                
                dataMap.set(node.irNodeId, { gen, kill });
            }
        }
        
        return { dataMap, defsByVar, defToVar };
    }
}