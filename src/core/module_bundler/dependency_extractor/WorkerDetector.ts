import { IRRoot, IRNode } from '../../source_analyzer/ir_converter/ASTtoIRConverter';
import { IRTraverser } from '../../source_analyzer/ir_converter/IRTraverser';
import { ScopeResolver } from '../../source_analyzer/scope_analyzer/ScopeResolver';
import { ConstantResolver } from '../../source_analyzer/scope_analyzer/ConstantResolver';

export class WorkerDetector {
    /**
     * IRツリーから Worker 等の未解決 of 依存パス（生文字列）一覧を抽出します。
     * VFS（ファイルシステム）上での解決は上位オーケストレーターの責務です。
     */
    static extractRawWorkerPaths(
        ir: IRRoot, 
        logger?: (log: { type: 'info' | 'success' | 'error'; msg: string }) => void
    ): string[] {
        const paths = new Set<string>();

        const refToDeclMap = ScopeResolver.resolve(ir);
        const resolver = new ConstantResolver(ir, refToDeclMap);

        const extractPath = (argNode: IRNode, constructorName: string) => {
            const resolvedArg = resolver.resolve(argNode);
            let relativePath: string | null = null;
            let unresolvedReason: string | null = null;

            if (resolvedArg.type === 'NewExpression') {
                const calleeRef = resolvedArg.props['callee'];
                if (calleeRef && calleeRef.type === 'ref') {
                    const calleeNode = resolvedArg.children.find(c => c.irNodeId === calleeRef.irNodeId);
                    if (calleeNode && calleeNode.type === 'Identifier' && calleeNode.props['name'] === 'URL') {
                        const urlArgs = resolvedArg.props['arguments'] || [];
                        if (urlArgs.length > 0 && urlArgs[0].type === 'ref') {
                            const urlFirstArgNode = resolvedArg.children.find(c => c.irNodeId === urlArgs[0].irNodeId);
                            if (urlFirstArgNode) {
                                const resolvedUrlArg = resolver.resolve(urlFirstArgNode);
                                if (resolvedUrlArg && (resolvedUrlArg.type === 'StringLiteral' || resolvedUrlArg.type === 'Literal')) {
                                    relativePath = resolvedUrlArg.props['value'] as string;
                                } else {
                                    unresolvedReason = `URL constructor argument resolved to non-string type: "${resolvedUrlArg.type}"`;
                                }
                            }
                        } else {
                            unresolvedReason = `URL constructor has no arguments`;
                        }
                    } else {
                        unresolvedReason = `Instantiation of class other than URL: "${calleeNode?.props['name'] || 'unknown'}"`;
                    }
                }
            } else if (resolvedArg.type === 'StringLiteral' || resolvedArg.type === 'Literal') {
                relativePath = resolvedArg.props['value'] as string;
            } else {
                unresolvedReason = `Argument resolved to non-string/non-URL type: "${resolvedArg.type}"`;
            }

            if (relativePath) {
                if (/^(https?:)?\/\//i.test(relativePath)) {
                    if (logger) {
                        logger({
                            type: 'info',
                            msg: `[WorkerDetector] External network worker path detected: "${relativePath}" (in ${ir.filePath}). Skipping bundle inlining.`
                        });
                    }
                } else {
                    paths.add(relativePath);
                    if (logger) {
                        logger({
                            type: 'info',
                            msg: `[WorkerDetector] Successfully resolved worker path: "${relativePath}" (in ${ir.filePath})`
                        });
                    }
                }
            } else {
                if (logger) {
                    logger({
                        type: 'info',
                        msg: `[WorkerDetector Warning] Detected ${constructorName} call at ${ir.filePath} but could not resolve path statically. Reason: ${unresolvedReason || 'unknown'}. Falling back to runtime loading.`
                    });
                }
            }
        };

        if (ir.children && ir.children.length > 0) {
            IRTraverser.traverse(ir.children[0], {
                NewExpression: (node: IRNode) => {
                    const calleeRef = node.props['callee'];
                    if (calleeRef && calleeRef.type === 'ref') {
                        const calleeNode = node.children.find(c => c.irNodeId === calleeRef.irNodeId);
                        if (calleeNode && calleeNode.type === 'Identifier') {
                            const name = calleeNode.props['name'];
                            if (name === 'Worker' || name === 'SharedWorker') {
                                const args = node.props['arguments'] || [];
                                if (args.length > 0 && args[0].type === 'ref') {
                                    const firstArgNode = node.children.find(c => c.irNodeId === args[0].irNodeId);
                                    if (firstArgNode) extractPath(firstArgNode, name);
                                } else {
                                    if (logger) {
                                        logger({
                                            type: 'info',
                                            msg: `[WorkerDetector Warning] ${name} instantiated with no arguments at ${ir.filePath}.`
                                        });
                                    }
                                }
                            }
                        }
                    }
                },
                CallExpression: (node: IRNode) => {
                    const calleeRef = node.props['callee'];
                    if (calleeRef && calleeRef.type === 'ref') {
                        const calleeNode = node.children.find(c => c.irNodeId === calleeRef.irNodeId);
                        if (calleeNode && calleeNode.type === 'MemberExpression') {
                            const propRef = calleeNode.props['property'];
                            if (propRef && propRef.type === 'ref') {
                                const propNode = calleeNode.children.find(c => c.irNodeId === propRef.irNodeId);
                                if (propNode && propNode.type === 'Identifier') {
                                    const name = propNode.props['name'];
                                    if (name === 'addModule' || name === 'register') {
                                        const args = node.props['arguments'] || [];
                                        if (args.length > 0 && args[0].type === 'ref') {
                                            const firstArgNode = node.children.find(c => c.irNodeId === args[0].irNodeId);
                                            if (firstArgNode) extractPath(firstArgNode, `navigator.serviceWorker.${name}`);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });
        }

        return Array.from(paths);
    }
}
