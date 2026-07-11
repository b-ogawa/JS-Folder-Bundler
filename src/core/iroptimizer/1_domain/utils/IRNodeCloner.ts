import { IRNode } from '../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../state/CompilationState';

export class IRNodeCloner {
    public static clone(
        rootNode: IRNode, 
        state: CompilationState, 
        substituteMap?: Map<string, IRNode>
    ): IRNode {
        const snapshot = state.analysisSnapshot!;
        const genId = () => state.services.generateId!('ir_clone');
        const genVarName = (originalName: string) => `${originalName}_${state.services.generateId!('v')}`;

        const localDecls = new Set<string>();
        
        const collectDecls = (node: IRNode) => {
            if (node.type === 'VariableDeclarator' || node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') {
                const idRef = (node.props as any).id;
                if (idRef && idRef.type === 'ref') localDecls.add(idRef.irNodeId);
            }
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
                if (Array.isArray((node.props as any).params)) {
                    for (const param of (node.props as any).params) {
                        if (param && param.type === 'ref') localDecls.add(param.irNodeId);
                    }
                }
            }
            for (const child of node.children) collectDecls(child);
        };
        collectDecls(rootNode);

        const declToNewName = new Map<string, string>();
        for (const declId of localDecls) {
            const declNode = snapshot.nodeMap.get(declId);
            if (declNode && declNode.props.name) {
                declToNewName.set(declId, genVarName(declNode.props.name as string));
            }
        }

        const oldToNewId = new Map<string, string>();

        const cloneNode = (node: IRNode): IRNode => {
            if (substituteMap && node.type === 'Identifier') {
                const declId = snapshot.refToDeclMap.get(node.irNodeId) || (node.props as any)._declId || node.irNodeId;
                if (substituteMap.has(declId)) {
                    const argNode = substituteMap.get(declId)!;
                    const clonedArg = IRNodeCloner.clone(argNode, state);
                    // 親ノードからの参照（ref）を更新するため、元のIdentifierのIDと新しいIDの対応を記録
                    oldToNewId.set(node.irNodeId, clonedArg.irNodeId);
                    return clonedArg;
                }
            }

            const newId = genId();
            oldToNewId.set(node.irNodeId, newId);

            const newChildren: IRNode[] = [];
            for (const child of node.children) {
                newChildren.push(cloneNode(child));
            }

            let newName = node.props.name;
            if (node.type === 'Identifier') {
                if (localDecls.has(node.irNodeId)) {
                    newName = declToNewName.get(node.irNodeId) || newName;
                } else {
                    const resolvedDeclId = snapshot.refToDeclMap.get(node.irNodeId);
                    if (resolvedDeclId && declToNewName.has(resolvedDeclId)) {
                        newName = declToNewName.get(resolvedDeclId)!;
                    }
                }
            }

            return {
                type: node.type,
                irNodeId: newId,
                props: { ...node.props, name: newName },
                children: newChildren
            };
        };

        const clonedRoot = cloneNode(rootNode);

        const updateRefs = (node: IRNode) => {
            for (const [key, val] of Object.entries(node.props)) {
                if (Array.isArray(val)) {
                    node.props[key] = val.map(item => {
                        const itemAny = item as any;
                        if (itemAny && itemAny.type === 'ref' && oldToNewId.has(itemAny.irNodeId)) {
                            return { type: 'ref', irNodeId: oldToNewId.get(itemAny.irNodeId)! };
                        }
                        return item;
                    });
                } else if (val && (val as any).type === 'ref' && oldToNewId.has((val as any).irNodeId)) {
                    node.props[key] = { type: 'ref', irNodeId: oldToNewId.get((val as any).irNodeId)! };
                }
            }
            for (const child of node.children) updateRefs(child);
        };

        updateRefs(clonedRoot);
        return clonedRoot;
    }
}
