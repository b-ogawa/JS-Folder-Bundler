import { IRNode } from '../../../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { ASTTransformerRule } from '../../../../../infra/ASTTransformer';
import { MergeContext } from '../MergeContext';
import { ConstantResolver } from '../../../../../source_analyzer/scope_analyzer/ConstantResolver';
import { WorkerDetector } from '../../../../dependency_extractor/WorkerDetector';

export class WorkerConstructorRule implements ASTTransformerRule<MergeContext> {
    public match(node: IRNode, context: MergeContext): boolean {
        const currentTree = context.irTrees.find(t => t.filePath === context.currentFilePath);
        if (!currentTree) return false;

        const refToDeclMap = context.refToDeclMaps.get(context.currentFilePath) || new Map<string, string>();
        const resolver = new ConstantResolver(currentTree, refToDeclMap);

        const ref = WorkerDetector.detectWorkerPattern(node, resolver);
        if (!ref || !ref.rawPath || (ref.kind !== 'Worker' && ref.kind !== 'SharedWorker')) return false;
        if (/^(https?:)?\/\//i.test(ref.rawPath)) return false;

        const resolved = context.resolvePath(context.currentFilePath, ref.rawPath);
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
        const currentTree = context.irTrees.find(t => t.filePath === context.currentFilePath)!;
        const refToDeclMap = context.refToDeclMaps.get(context.currentFilePath) || new Map<string, string>();
        const resolver = new ConstantResolver(currentTree, refToDeclMap);

        const ref = WorkerDetector.detectWorkerPattern(node, resolver)!;
        const resolved = context.resolvePath(context.currentFilePath, ref.rawPath!);
        const workerId = context.getBase(resolved);
        const safeChunkId = context.getSafeChunkId(workerId);

        if (context.logger) {
            context.logger({
                type: 'info',
                msg: `[ChunkMerger] Successfully inlined ${ref.kind} constructor call to "${ref.rawPath}" -> replaced with ${context.spawnFuncName}("${safeChunkId}")`
            });
        }

        context.needsSpawnBoilerplate = true;
        context.needsChunkUrlBoilerplate = true;

        const genId = () => context.getDeterministicId('ir_spawn_call');
        const spawnIdent: IRNode = { type: 'Identifier', irNodeId: genId(), props: { name: context.spawnFuncName }, children: [] };
        const argStrNode: IRNode = { type: 'StringLiteral', irNodeId: genId(), props: { value: safeChunkId }, children: [] };
        const typeStrNode: IRNode = { type: 'StringLiteral', irNodeId: genId(), props: { value: ref.kind }, children: [] };

        const callArgs: any[] = [
            { type: 'ref', irNodeId: argStrNode.irNodeId },
            { type: 'ref', irNodeId: typeStrNode.irNodeId }
        ];
        const callChildren: IRNode[] = [spawnIdent, argStrNode, typeStrNode];

        const args = node.props['arguments'] || [];
        if (args.length > 1) {
            const optNode = node.children.find((c: any) => c.irNodeId === args[1].irNodeId);
            if (optNode) {
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
}
