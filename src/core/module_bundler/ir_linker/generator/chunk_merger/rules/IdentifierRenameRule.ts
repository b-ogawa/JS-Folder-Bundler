import { IRNode } from '../../../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { ASTTransformerRule } from '../../../../../infra/ASTTransformer';
import { MergeContext } from '../MergeContext';

export class IdentifierRenameRule implements ASTTransformerRule<MergeContext> {
    public match(node: IRNode, context: MergeContext): boolean {
        return node.type === 'Identifier' && context.nodeReplacements.has(node.irNodeId);
    }

    public transform(
        node: IRNode,
        context: MergeContext,
        walk: (n: IRNode, parent?: IRNode) => IRNode,
        parent?: IRNode
    ): IRNode {
        return context.nodeReplacements.get(node.irNodeId)!;
    }
}
