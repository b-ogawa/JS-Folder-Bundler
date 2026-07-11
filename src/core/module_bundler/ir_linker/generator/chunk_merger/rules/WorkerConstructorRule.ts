import { IRNode } from '../../../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { ASTTransformerRule } from '../../../../../infra/ASTTransformer';
import { MergeContext } from '../MergeContext';
import { ConstantResolver } from '../../../../../source_analyzer/scope_analyzer/ConstantResolver';

export class WorkerConstructorRule implements ASTTransformerRule<MergeContext> {
    public match(node: IRNode, context: MergeContext): boolean {
        if (node.type !== 'NewExpression') return false;

        const calleeRef = node.props['callee'];
        if (!calleeRef || calleeRef.type !== 'ref') return false;

        const calleeNode = node.children.find(c => c.irNodeId === calleeRef.irNodeId);
        if (!calleeNode || calleeNode.type !== 'Identifier') return false;

        const name = calleeNode.props['name'];
        if (name !== 'Worker' && name !== 'SharedWorker') return false;

        const args = node.props['arguments'] || [];
        if (args.length === 0 || args[0].type !== 'ref') return false;

        const firstArgNode = node.children.find(c => c.irNodeId === args[0].irNodeId);
        if (!firstArgNode) return false;

        const currentTree = context.irTrees.find(t => t.filePath === context.currentFilePath);
        if (!currentTree) return false;

        const refToDeclMap = context.refToDeclMaps.get(context.currentFilePath) || new Map<string, string>();
        const resolver = new ConstantResolver(currentTree, refToDeclMap);

        const { relativePath } = this.resolveWorkerPath(firstArgNode, resolver);
        if (!relativePath || /^(https?:)?\/\//i.test(relativePath)) return false;

        const resolved = context.resolvePath(context.currentFilePath, relativePath);
        const base = context.getBase(resolved);
        const isExisting = context.modules.has(base) || context.modules.has(base + '/index') || context.fileExists(resolved);

        if (!isExisting) return false;

        return !!context.workerEntryBases && context.workerEntryBases.has(base);
    }

    public transform(
        node: IRNode,
        context: MergeContext,
        walk: (n: IRNode, parent?: IRNode) => IRNode,
        parent?: IRNode
    ): IRNode {
        const calleeRef = node.props['callee'];
        const calleeNode = node.children.find(c => c.irNodeId === calleeRef.irNodeId)!;
        const name = calleeNode.props['name'] as string;

        const args = node.props['arguments'] || [];
        const firstArgNode = node.children.find(c => c.irNodeId === args[0].irNodeId)!;

        const currentTree = context.irTrees.find(t => t.filePath === context.currentFilePath)!;
        const refToDeclMap = context.refToDeclMaps.get(context.currentFilePath) || new Map<string, string>();
        const resolver = new ConstantResolver(currentTree, refToDeclMap);

        const { relativePath } = this.resolveWorkerPath(firstArgNode, resolver);
        const resolved = context.resolvePath(context.currentFilePath, relativePath!);
        const workerId = context.getBase(resolved);
        const safeChunkId = context.getSafeChunkId(workerId);

        if (context.logger) {
            context.logger({
                type: 'info',
                msg: `[ChunkMerger] Successfully inlined ${name} constructor call to "${relativePath}" -> replaced with ${context.spawnFuncName}("${safeChunkId}")`
            });
        }

        context.needsSpawnBoilerplate = true;
        context.needsChunkUrlBoilerplate = true;

        const genId = () => context.getDeterministicId('ir_spawn_call');
        const spawnIdent: IRNode = { type: 'Identifier', irNodeId: genId(), props: { name: context.spawnFuncName }, children: [] };
        const argStrNode: IRNode = { type: 'StringLiteral', irNodeId: genId(), props: { value: safeChunkId }, children: [] };
        const typeStrNode: IRNode = { type: 'StringLiteral', irNodeId: genId(), props: { value: name }, children: [] };

        const callArgs: any[] = [
            { type: 'ref', irNodeId: argStrNode.irNodeId },
            { type: 'ref', irNodeId: typeStrNode.irNodeId }
        ];
        const callChildren: IRNode[] = [spawnIdent, argStrNode, typeStrNode];

        if (args.length > 1) {
            const optNode = node.children.find((c: any) => c.irNodeId === args[1].irNodeId);
            if (optNode) {
                // オプショナルな引数（optionsなど）があれば再帰走査したうえで追加
                const walkedOpt = walk(optNode, node);
                callArgs.push({ type: 'ref', irNodeId: walkedOpt.irNodeId });
                callChildren.push(walkedOpt);
            } else {
                callArgs.push(args[1]);
            }
        }

        return {
            type: 'CallExpression',
            irNodeId: node.irNodeId,
            props: {
                callee: { type: 'ref', irNodeId: spawnIdent.irNodeId },
                arguments: callArgs
            },
            children: callChildren
        };
    }

    private resolveWorkerPath(firstArgNode: IRNode, resolver: ConstantResolver): { relativePath: string | null; unresolvedReason: string | null } {
        const resolvedArg = resolver.resolve(firstArgNode);
        if (!resolvedArg) {
            return { relativePath: null, unresolvedReason: 'Unable to resolve first argument' };
        }

        if (resolvedArg.type === 'NewExpression') {
            const calleeRef2 = resolvedArg.props['callee'];
            if (calleeRef2 && calleeRef2.type === 'ref') {
                const calleeNode2 = resolvedArg.children.find(c => c.irNodeId === calleeRef2.irNodeId);
                if (calleeNode2 && calleeNode2.type === 'Identifier' && calleeNode2.props['name'] === 'URL') {
                    const urlArgs = resolvedArg.props['arguments'] || [];
                    if (urlArgs.length > 0 && urlArgs[0].type === 'ref') {
                        const urlFirstArgNode = resolvedArg.children.find(c => c.irNodeId === urlArgs[0].irNodeId);
                        if (urlFirstArgNode) {
                            const resolvedUrlArg = resolver.resolve(urlFirstArgNode);
                            if (resolvedUrlArg && (resolvedUrlArg.type === 'StringLiteral' || resolvedUrlArg.type === 'Literal')) {
                                return { relativePath: resolvedUrlArg.props['value'] as string, unresolvedReason: null };
                            }
                            return { relativePath: null, unresolvedReason: `URL constructor first argument resolved to non-string: "${resolvedUrlArg?.type || 'unknown'}"` };
                        }
                    }
                    return { relativePath: null, unresolvedReason: 'URL constructor has no arguments' };
                }
                return { relativePath: null, unresolvedReason: `Instantiation of class other than URL: "${calleeNode2?.props['name'] || 'unknown'}"` };
            }
        } else if (resolvedArg.type === 'StringLiteral' || resolvedArg.type === 'Literal') {
            return { relativePath: resolvedArg.props['value'] as string, unresolvedReason: null };
        }

        return { relativePath: null, unresolvedReason: `Argument resolved to non-string/non-URL type: "${resolvedArg.type}"` };
    }
}
