import { IRRoot, IRNode } from '../ir_converter/ASTtoIRConverter';

export class ScopeResolver {
    /**
     * Extracts reference to declaration map straight from the embedded ScopeInfo,
     * and accounts for newly generated nodes injected by Optimizer rules.
     */
    public static resolve(irRoot: IRRoot): Map<string, string> {
        const refToDeclMap = new Map<string, string>();
        
        if (irRoot.scopeInfo && irRoot.scopeInfo.bindings) {
            for (const [declId, binding] of irRoot.scopeInfo.bindings.entries()) {
                refToDeclMap.set(declId, declId); // Self reference
                if (binding.references) {
                    for (const refId of binding.references) {
                        refToDeclMap.set(refId, declId);
                    }
                }
            }
        }

        // Walk the tree to find any injected Identifiers that carry a _declId
        const walk = (node: IRNode) => {
            if (node.type === 'Identifier' && node.props._declId) {
                refToDeclMap.set(node.irNodeId, node.props._declId);
            }
            if (node.children) {
                for (const child of node.children) walk(child);
            }
        };
        walk(irRoot);

        return refToDeclMap;
    }
}
