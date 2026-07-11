import { IRNode } from '../../../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { ASTTransformerRule } from '../../../../../infra/ASTTransformer';
import { MergeContext } from '../MergeContext';
import { ConstantResolver } from '../../../../../source_analyzer/scope_analyzer/ConstantResolver';

export class UrlConstructorRule implements ASTTransformerRule<MergeContext> {
    public match(node: IRNode, context: MergeContext): boolean {
        if (node.type !== 'NewExpression') return false;

        const calleeRef = node.props['callee'];
        if (!calleeRef || calleeRef.type !== 'ref') return false;

        const calleeNode = node.children.find(c => c.irNodeId === calleeRef.irNodeId);
        if (!calleeNode || calleeNode.type !== 'Identifier' || calleeNode.props['name'] !== 'URL') return false;

        const args = node.props['arguments'] || [];
        if (args.length === 0 || args[0].type !== 'ref') return false;

        const firstArgNode = node.children.find(c => c.irNodeId === args[0].irNodeId);
        if (!firstArgNode) return false;

        const currentTree = context.irTrees.find(t => t.filePath === context.currentFilePath);
        if (!currentTree) return false;

        const refToDeclMap = context.refToDeclMaps.get(context.currentFilePath) || new Map<string, string>();
        const resolver = new ConstantResolver(currentTree, refToDeclMap);

        const resolvedUrlArg = resolver.resolve(firstArgNode);
        if (!resolvedUrlArg || (resolvedUrlArg.type !== 'StringLiteral' && resolvedUrlArg.type !== 'Literal')) return false;

        const val = resolvedUrlArg.props['value'] as string;
        if (!val || typeof val !== 'string' || val.length <= 2 || /^(https?:)?\/\//i.test(val)) return false;

        const resolved = context.resolvePath(context.currentFilePath, val);
        const base = context.getBase(resolved);

        return !!context.workerEntryBases && context.workerEntryBases.has(base);
    }

    public transform(
        node: IRNode,
        context: MergeContext,
        walk: (n: IRNode, parent?: IRNode) => IRNode,
        parent?: IRNode
    ): IRNode {
        const calleeRef = node.props['callee'];
        const args = node.props['arguments'] || [];
        const firstArgNode = node.children.find(c => c.irNodeId === args[0].irNodeId)!;

        const currentTree = context.irTrees.find(t => t.filePath === context.currentFilePath)!;
        const refToDeclMap = context.refToDeclMaps.get(context.currentFilePath) || new Map<string, string>();
        const resolver = new ConstantResolver(currentTree, refToDeclMap);
        const resolvedUrlArg = resolver.resolve(firstArgNode);
        const val = resolvedUrlArg.props['value'] as string;

        const resolved = context.resolvePath(context.currentFilePath, val);
        const base = context.getBase(resolved);
        const safeChunkId = context.getSafeChunkId(base);

        if (context.logger) {
            context.logger({
                type: 'info',
                msg: `[ChunkMerger] Successfully inlined URL constructor call to "${val}" -> replaced with ${context.chunkUrlFuncName}("${safeChunkId}")`
            });
        }

        context.needsChunkUrlBoilerplate = true;

        const genId = () => context.getDeterministicId('ir_chunk_url');
        const calleeIdent: IRNode = { type: 'Identifier', irNodeId: genId(), props: { name: context.chunkUrlFuncName }, children: [] };
        const argNode: IRNode = { type: 'StringLiteral', irNodeId: genId(), props: { value: safeChunkId }, children: [] };

        return {
            type: 'CallExpression',
            irNodeId: node.irNodeId,
            props: {
                callee: { type: 'ref', irNodeId: calleeIdent.irNodeId },
                arguments: [{ type: 'ref', irNodeId: argNode.irNodeId }]
            },
            children: [calleeIdent, argNode]
        };
    }
}
