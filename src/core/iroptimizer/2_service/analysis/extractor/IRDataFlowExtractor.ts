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

function getDefinedVars(node: IRNode, refToDeclMap: Map<string, string>): string[] {
    const vars: string[] = [];
    if (node.type === 'VariableDeclarator') {
        const idNode = getChild(node, 'id');
        if (idNode && idNode.type === 'Identifier') {
            const declId = refToDeclMap.get(idNode.irNodeId) || idNode.irNodeId;
            vars.push(declId);
        }
    } else if (node.type === 'AssignmentExpression') {
        const leftNode = getChild(node, 'left');
        if (leftNode && leftNode.type === 'Identifier') {
            const declId = refToDeclMap.get(leftNode.irNodeId);
            if (declId) vars.push(declId);
        }
    } else if (node.type === 'UpdateExpression') {
        const argNode = getChild(node, 'argument');
        if (argNode && argNode.type === 'Identifier') {
            const declId = refToDeclMap.get(argNode.irNodeId);
            if (declId) vars.push(declId);
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
    if (parent.type === 'AssignmentExpression' && getChild(parent, 'left')?.irNodeId === node.irNodeId) {
        // Compound assignments (e.g., +=) require reading the variable before writing to it.
        // Thus, we treat it as an LVal for DEF purposes, but we will explicitly register its USE in extractLivenessData.
        return true;
    }
    if (parent.type === 'UpdateExpression' && getChild(parent, 'argument')?.irNodeId === node.irNodeId) return true;
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
                
                const definedVars = getDefinedVars(node, refToDeclMap);
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
                        if (leftNode && leftNode.type === 'Identifier') {
                            const declId = refToDeclMap.get(leftNode.irNodeId);
                            if (declId) use.add(declId);
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
        refToDeclMap: Map<string, string>
    ): { dataMap: Map<string, ReachingDefData>, defsByVar: Map<string, Set<string>>, defToVar: Map<string, string> } {
        const dataMap = new Map<string, ReachingDefData>();
        const defsByVar = new Map<string, Set<string>>();
        const defToVar = new Map<string, string>();
        
        // First pass: Collect all definitions
        for (const block of blocks.values()) {
            for (const node of block.nodes) {
                const definedVars = getDefinedVars(node, refToDeclMap);
                for (const declId of definedVars) {
                    if (!defsByVar.has(declId)) {
                        defsByVar.set(declId, new Set<string>());
                    }
                    defsByVar.get(declId)!.add(node.irNodeId);
                    defToVar.set(node.irNodeId, declId);
                }
            }
        }
        
        // Second pass: Compute gen and kill sets
        for (const block of blocks.values()) {
            for (const node of block.nodes) {
                const gen = new Set<string>();
                const kill = new Set<string>();
                
                const definedVars = getDefinedVars(node, refToDeclMap);
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
