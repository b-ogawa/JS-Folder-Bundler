import { IRRoot, IRNode } from '../../source_analyzer/ir_converter/ASTtoIRConverter';
import { IRTraverser } from '../../source_analyzer/ir_converter/IRTraverser';
import { ScopeResolver } from '../../source_analyzer/scope_analyzer/ScopeResolver';
import { ConstantResolver } from '../../source_analyzer/scope_analyzer/ConstantResolver';
import { IRUtils } from '../../source_analyzer/ir_converter/IRUtils';

export interface WorkerReference {
    kind: 'Worker' | 'SharedWorker' | 'ServiceWorker' | 'Worklet';
    rawPath: string | null;
    unresolvedReason?: string;
    sourceNode: IRNode;
}

export class WorkerDetector {
    /**
     * IRツリーから Worker 等の未解決の依存パス（生文字列）一覧を抽出します。
     * VFS（ファイルシステム）上での解決は上位オーケストレーターの責務
     */
    static extractRawWorkerPaths(
        ir: IRRoot, 
        logger?: (log: { type: 'info' | 'success' | 'error'; msg: string }) => void
    ): string[] {
        const paths = new Set<string>();

        const refToDeclMap = ScopeResolver.resolve(ir);
        const resolver = new ConstantResolver(ir, refToDeclMap);

        if (ir.children && ir.children.length > 0) {
            IRTraverser.traverse(ir.children[0], {
                NewExpression: (node: IRNode) => {
                    const ref = this.detectWorkerPattern(node, resolver);
                    if (ref) this.handleDetectedWorker(ref, ir, paths, logger);
                },
                CallExpression: (node: IRNode) => {
                    const ref = this.detectWorkerPattern(node, resolver);
                    if (ref) this.handleDetectedWorker(ref, ir, paths, logger);
                }
            });
        }

        return Array.from(paths);
    }

    private static handleDetectedWorker(ref: WorkerReference, ir: IRRoot, paths: Set<string>, logger?: (log: { type: 'info' | 'success' | 'error'; msg: string }) => void) {
        if (ref.rawPath) {
            if (/^(https?:)?\/\//i.test(ref.rawPath)) {
                if (logger) {
                    logger({
                        type: 'info',
                        msg: `[WorkerDetector] External network worker path detected: "${ref.rawPath}" (in ${ir.filePath}). Skipping bundle inlining.`
                    });
                }
            } else {
                paths.add(ref.rawPath);
                if (logger) {
                    logger({
                        type: 'info',
                        msg: `[WorkerDetector] Successfully resolved worker path: "${ref.rawPath}" (in ${ir.filePath})`
                    });
                }
            }
        } else {
            if (logger) {
                logger({
                    type: 'info',
                    msg: `[WorkerDetector Warning] Detected ${ref.kind} call at ${ir.filePath} but could not resolve path statically. Reason: ${ref.unresolvedReason || 'unknown'}. Falling back to runtime loading.`
                });
            }
        }
    }

    /**
     * ASTノードがWorker系の生成パターンに合致するかを判定し、引数パスを追跡して返します。
     */
    public static detectWorkerPattern(node: IRNode, resolver: ConstantResolver): WorkerReference | null {
        if (node.type === 'NewExpression') {
            const calleeNode = IRUtils.resolveRef(node, node.props['callee']);
            if (calleeNode?.type === 'Identifier') {
                const name = calleeNode.props['name'];
                if (name === 'Worker' || name === 'SharedWorker') {
                    const args = node.props['arguments'] || [];
                    if (args.length > 0) {
                        const firstArgNode = IRUtils.resolveRef(node, args[0]);
                        if (firstArgNode) {
                            const resolved = this.resolvePathArg(firstArgNode, resolver);
                            return {
                                kind: name as 'Worker' | 'SharedWorker',
                                rawPath: resolved.path,
                                unresolvedReason: resolved.unresolvedReason,
                                sourceNode: node
                            };
                        }
                    }
                    return {
                        kind: name as 'Worker' | 'SharedWorker',
                        rawPath: null,
                        unresolvedReason: `${name} instantiated with no arguments`,
                        sourceNode: node
                    };
                }
            }
        } else if (node.type === 'CallExpression') {
            const calleeNode = IRUtils.resolveRef(node, node.props['callee']);
            if (calleeNode?.type === 'MemberExpression') {
                const propNode = IRUtils.resolveRef(calleeNode, calleeNode.props['property']);
                const objNode = IRUtils.resolveRef(calleeNode, calleeNode.props['object']);
                
                if (propNode?.type === 'Identifier' && objNode) {
                    const name = propNode.props['name'];
                    if (name === 'addModule' || name === 'register') {
                        let isTarget = false;
                        let kind: 'ServiceWorker' | 'Worklet' | null = null;
                        
                        if (objNode.type === 'Identifier') {
                            const objName = objNode.props['name'] as string;
                            if (objName === 'serviceWorker' || objName.toLowerCase().includes('worklet')) {
                                isTarget = true;
                                kind = objName === 'serviceWorker' ? 'ServiceWorker' : 'Worklet';
                            }
                        } else if (objNode.type === 'MemberExpression') {
                            const subPropNode = IRUtils.resolveRef(objNode, objNode.props['property']);
                            if (subPropNode?.type === 'Identifier') {
                                const subPropName = subPropNode.props['name'] as string;
                                if (subPropName === 'serviceWorker' || subPropName.toLowerCase().includes('worklet')) {
                                    isTarget = true;
                                    kind = subPropName === 'serviceWorker' ? 'ServiceWorker' : 'Worklet';
                                }
                            }
                        }

                        if (isTarget && kind) {
                            const args = node.props['arguments'] || [];
                            if (args.length > 0) {
                                const firstArgNode = IRUtils.resolveRef(node, args[0]);
                                if (firstArgNode) {
                                    const resolved = this.resolvePathArg(firstArgNode, resolver);
                                    return {
                                        kind,
                                        rawPath: resolved.path,
                                        unresolvedReason: resolved.unresolvedReason,
                                        sourceNode: node
                                    };
                                }
                            }
                            return {
                                kind,
                                rawPath: null,
                                unresolvedReason: `${kind === 'ServiceWorker' ? 'navigator.serviceWorker.register' : 'Worklet.addModule'} called with no arguments`,
                                sourceNode: node
                            };
                        }
                    }
                }
            }
        }

        return null;
    }

    private static resolvePathArg(argNode: IRNode, resolver: ConstantResolver): { path: string | null; unresolvedReason?: string } {
        const resolvedArg = resolver.resolve(argNode);
        
        if (resolvedArg.type === 'NewExpression') {
            const calleeNode = IRUtils.resolveRef(resolvedArg, resolvedArg.props['callee']);
            
            if (calleeNode?.type === 'Identifier' && calleeNode.props['name'] === 'URL') {
                const urlArgs = resolvedArg.props['arguments'] || [];
                if (urlArgs.length > 0) {
                    const urlFirstArgNode = IRUtils.resolveRef(resolvedArg, urlArgs[0]);
                    if (urlFirstArgNode) {
                        const resolvedUrlArg = resolver.resolve(urlFirstArgNode);
                        if (resolvedUrlArg && (resolvedUrlArg.type === 'StringLiteral' || resolvedUrlArg.type === 'Literal')) {
                            return { path: resolvedUrlArg.props['value'] as string };
                        } else {
                            return { path: null, unresolvedReason: `URL constructor argument resolved to non-string type: "${resolvedUrlArg.type}"` };
                        }
                    }
                }
                return { path: null, unresolvedReason: `URL constructor has no arguments` };
            }
            return { path: null, unresolvedReason: `Instantiation of class other than URL: "${calleeNode?.props['name'] || 'unknown'}"` };
        } else if (resolvedArg.type === 'StringLiteral' || resolvedArg.type === 'Literal') {
            return { path: resolvedArg.props['value'] as string };
        }
        
        return { path: null, unresolvedReason: `Argument resolved to non-string/non-URL type: "${resolvedArg.type}"` };
    }
}
