import { IRRoot, IRNode } from '../../source_analyzer/ir_converter/ASTtoIRConverter';
import { IRTraverser } from '../../source_analyzer/ir_converter/IRTraverser';

export class DependencyExtractor {
    static extract(ir: IRRoot): string[] {
        const deps = new Set<string>();

        const extractSource = (node: IRNode) => {
            const sourceRef = node.props['source'];
            if (sourceRef && sourceRef.type === 'ref') {
                const sourceNode = node.children.find(c => c.irNodeId === sourceRef.irNodeId);
                if (sourceNode && sourceNode.type === 'StringLiteral') deps.add(sourceNode.props['value']);
            }
        };

        const visitor = {
            ImportDeclaration: extractSource,
            ExportNamedDeclaration: extractSource,
            ExportAllDeclaration: extractSource,
            ImportExpression: extractSource,
            CallExpression: (node: IRNode) => {
                const calleeRef = node.props['callee'];
                if (calleeRef && calleeRef.type === 'ref') {
                    const calleeNode = node.children.find(c => c.irNodeId === calleeRef.irNodeId);
                    if (calleeNode) {
                        const isRequire = calleeNode.type === 'Identifier' && calleeNode.props['name'] === 'require';
                        const isDynamicImport = calleeNode.type === 'Import';
                        const isImportScripts = calleeNode.type === 'Identifier' && calleeNode.props['name'] === 'importScripts';
                        
                        if (isRequire || isDynamicImport) {
                            const argsRef = node.props['arguments'];
                            if (Array.isArray(argsRef) && argsRef.length > 0 && argsRef[0].type === 'ref') {
                                const argNode = node.children.find(c => c.irNodeId === argsRef[0].irNodeId);
                                if (argNode && argNode.type === 'StringLiteral') deps.add(argNode.props['value']);
                            }
                        } else if (isImportScripts) {
                            for (const argRef of node.props['arguments'] || []) {
                                if (argRef && argRef.type === 'ref') {
                                    const argNode = node.children.find(c => c.irNodeId === argRef.irNodeId);
                                    if (argNode && argNode.type === 'StringLiteral') deps.add(argNode.props['value']);
                                }
                            }
                        }
                    }
                }
            }
        };

        if (ir.children && ir.children.length > 0) {
            IRTraverser.traverse(ir.children[0], visitor);
        }
        return Array.from(deps);
    }
}
