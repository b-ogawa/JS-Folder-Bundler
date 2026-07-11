import { IRNode } from './ASTtoIRConverter';

export class IRtoASTConverter {
    /**
     * Converts an IRNode back into a Babel AST node.
     */
    static convert(node: IRNode): any {
        const convertInternal = (irNode: IRNode): any => {
            const astNode: any = { type: irNode.type };

            for (const key of Object.keys(irNode.props)) {
                const prop = irNode.props[key];

                if (Array.isArray(prop)) {
                    astNode[key] = prop.map(item => {
                        if (item && typeof item === 'object' && item.type === 'ref') {
                            const childNode = irNode.children.find(c => c.irNodeId === item.irNodeId);
                            return childNode ? convertInternal(childNode) : null;
                        }
                        return item;
                    });
                } else if (prop && typeof prop === 'object' && prop.type === 'ref') {
                    const childNode = irNode.children.find(c => c.irNodeId === prop.irNodeId);
                    astNode[key] = childNode ? convertInternal(childNode) : null;
                } else {
                    astNode[key] = prop;
                }
            }

            // === Babel AST 復元時のフォールバックアサーション ===
            // 中間表現レイヤーで型変換（NewExpression -> CallExpression など）が行われた結果、
            // Babelが要求する必須のプロパティが抜け落ちていた場合、ここで透過的に自動補完する。
            if (astNode.type === 'CallExpression' || astNode.type === 'OptionalCallExpression') {
                if (astNode.optional === undefined || astNode.optional === null) {
                    astNode.optional = false;
                }
            }
            if (astNode.type === 'MemberExpression' || astNode.type === 'OptionalMemberExpression') {
                if (astNode.optional === undefined || astNode.optional === null) {
                    astNode.optional = false;
                }
            }
            // ======================================================================

            return astNode;
        };

        return convertInternal(node);
    }
}
