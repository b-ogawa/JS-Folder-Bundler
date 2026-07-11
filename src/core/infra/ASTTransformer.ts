import { IRNode } from '../source_analyzer/ir_converter/ASTtoIRConverter';

export interface ASTTransformerRule<TContext> {
    match(node: IRNode, context: TContext): boolean;
    transform(
        node: IRNode, 
        context: TContext, 
        walk: (n: IRNode, parent?: IRNode) => IRNode, 
        parent?: IRNode
    ): IRNode;
}

export interface ASTTransformerOptions {
    replaceId?: (irNodeId: string) => string | undefined;
}

export class ASTTransformer<TContext> {
    constructor(
        private rules: ASTTransformerRule<TContext>[],
        private options?: ASTTransformerOptions
    ) {}

    public transform(rootNode: IRNode, context: TContext): IRNode {
        const walk = (node: IRNode, parent?: IRNode): IRNode => {
            // 1. ルールがマッチした場合は早期に適用し、自動での子ノード走査はスキップする（ショートサーキット）
            for (const rule of this.rules) {
                if (rule.match(node, context)) {
                    return rule.transform(node, context, walk, parent);
                }
            }

            // 2. ルールが適用されなかった場合のみ、デフォルトで子ノードを再帰走査する
            let hasChanges = false;
            const newChildren: IRNode[] = [];
            if (node.children) {
                for (const child of node.children) {
                    const newChild = walk(child, node);
                    newChildren.push(newChild);
                    if (newChild !== child) {
                        hasChanges = true;
                    }
                }
            }

            // nodeProps 内の参照を更新（ID変更に伴う props['body'] 等の参照の同期）
            const newProps: Record<string, any> = {};
            for (const [key, val] of Object.entries(node.props)) {
                if (Array.isArray(val)) {
                    const newArray = [];
                    for (const item of val) {
                        if (item && item.type === 'ref') {
                            // 1. オプションで明示的に指定された置換ID
                            const replacedId = this.options?.replaceId?.(item.irNodeId);
                            if (replacedId) {
                                newArray.push({ type: 'ref', irNodeId: replacedId });
                                hasChanges = true;
                                continue;
                            }
                            // 2. 子ノード走査によるIDの変化を追従
                            const tChild = newChildren.find(c => c.irNodeId === item.irNodeId || c.props._originalId === item.irNodeId);
                            if (tChild && tChild.irNodeId !== item.irNodeId) {
                                newArray.push({ type: 'ref', irNodeId: tChild.irNodeId });
                                hasChanges = true;
                                continue;
                            }
                        }
                        newArray.push(item);
                    }
                    newProps[key] = newArray;
                } else {
                    if (val && (val as any).type === 'ref') {
                        const refItem = val as any;
                        const replacedId = this.options?.replaceId?.(refItem.irNodeId);
                        if (replacedId) {
                            newProps[key] = { type: 'ref', irNodeId: replacedId };
                            hasChanges = true;
                        } else {
                            const tChild = newChildren.find(c => c.irNodeId === refItem.irNodeId || c.props._originalId === refItem.irNodeId);
                            if (tChild && tChild.irNodeId !== refItem.irNodeId) {
                                newProps[key] = { type: 'ref', irNodeId: tChild.irNodeId };
                                hasChanges = true;
                            } else {
                                newProps[key] = val;
                            }
                        }
                    } else {
                        newProps[key] = val;
                    }
                }
            }

            let resultNode = node;
            if (hasChanges) {
                resultNode = { ...node, children: newChildren, props: newProps };
            }

            // 元のIDを保持（親がPropsを再構築する際のマッチング用）
            if (resultNode.irNodeId !== node.irNodeId && !resultNode.props._originalId) {
                resultNode.props._originalId = node.irNodeId;
            }
            
            return resultNode;
        };

        return walk(rootNode);
    }
}
