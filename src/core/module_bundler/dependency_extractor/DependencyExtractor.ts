import { IRRoot, IRNode } from '../../source_analyzer/ir_converter/ASTtoIRConverter';
import { IRTraverser } from '../../source_analyzer/ir_converter/IRTraverser';
import { IRUtils } from '../../source_analyzer/ir_converter/IRUtils';

export class DependencyExtractor {
    static extract(ir: IRRoot): string[] {
        const deps = new Set<string>();

        const extractSource = (node: IRNode) => {
            const sourceNode = IRUtils.resolveRef(node, node.props['source']);
            if (sourceNode && sourceNode.type === 'StringLiteral') deps.add(sourceNode.props['value']);
        };

        const visitor = {
            ImportDeclaration: extractSource,
            ExportNamedDeclaration: extractSource,
            ExportAllDeclaration: extractSource,
            ImportExpression: extractSource,
            CallExpression: (node: IRNode) => {
                const calleeNode = IRUtils.resolveRef(node, node.props['callee']);
                if (calleeNode) {
                    const isRequire = calleeNode.type === 'Identifier' && calleeNode.props['name'] === 'require';
                    const isDynamicImport = calleeNode.type === 'Import';
                    const isImportScripts = calleeNode.type === 'Identifier' && calleeNode.props['name'] === 'importScripts';
                    
                    if (isRequire || isDynamicImport) {
                        const argsRef = node.props['arguments'];
                        if (Array.isArray(argsRef) && argsRef.length > 0) {
                            const argNode = IRUtils.resolveRef(node, argsRef[0]);
                            if (argNode && argNode.type === 'StringLiteral') deps.add(argNode.props['value']);
                        }
                    } else if (isImportScripts) {
                        for (const argRef of node.props['arguments'] || []) {
                            const argNode = IRUtils.resolveRef(node, argRef);
                            if (argNode && argNode.type === 'StringLiteral') deps.add(argNode.props['value']);
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
