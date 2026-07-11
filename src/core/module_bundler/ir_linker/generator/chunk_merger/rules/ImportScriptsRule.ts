import { IRNode } from '../../../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { ASTTransformerRule } from '../../../../../infra/ASTTransformer';
import { MergeContext } from '../MergeContext';

export class ImportScriptsRule implements ASTTransformerRule<MergeContext> {
    public match(node: IRNode, context: MergeContext): boolean {
        if (node.type !== 'CallExpression') return false;

        const calleeRef = node.props['callee'];
        if (!calleeRef || calleeRef.type !== 'ref') return false;

        const calleeNode = node.children.find(c => c.irNodeId === calleeRef.irNodeId);
        return !!calleeNode && calleeNode.type === 'Identifier' && calleeNode.props['name'] === 'importScripts';
    }

    public transform(
        node: IRNode,
        context: MergeContext,
        walk: (n: IRNode, parent?: IRNode) => IRNode,
        parent?: IRNode
    ): IRNode {
        const calleeRef = node.props['callee'];
        const calleeNode = node.children.find(c => c.irNodeId === calleeRef.irNodeId)!;
        const argsRef = node.props['arguments'] || [];

        const remainingArgsRefs: any[] = [];
        const remainingChildren: IRNode[] = [];

        const replacedCallee = walk(calleeNode, node);
        remainingChildren.push(replacedCallee);

        for (const argRef of argsRef) {
            if (argRef && argRef.type === 'ref') {
                const argNode = node.children.find(c => c.irNodeId === argRef.irNodeId);
                if (argNode) {
                    if (argNode.type === 'StringLiteral') {
                        const pathVal = argNode.props['value'] as string;
                        if (context.isExternalModule(pathVal, context.currentFilePath)) {
                            const replacedArg = walk(argNode, node);
                            remainingArgsRefs.push({ type: 'ref', irNodeId: replacedArg.irNodeId });
                            remainingChildren.push(replacedArg);
                        }
                    } else {
                        const replacedArg = walk(argNode, node);
                        remainingArgsRefs.push({ type: 'ref', irNodeId: replacedArg.irNodeId });
                        remainingChildren.push(replacedArg);
                    }
                }
            }
        }

        if (remainingArgsRefs.length === 0) {
            return {
                type: 'Identifier',
                irNodeId: node.irNodeId,
                props: { name: 'undefined' },
                children: []
            };
        }

        return {
            ...node,
            props: {
                ...node.props,
                callee: { type: 'ref', irNodeId: replacedCallee.irNodeId },
                arguments: remainingArgsRefs
            },
            children: remainingChildren
        };
    }
}
