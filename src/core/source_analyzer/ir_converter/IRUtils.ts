import { IRNode } from './ASTtoIRConverter';

export class IRUtils {
    /**
     * 参照オブジェクトから子ノードを安全に解決します。
     * 内部状態（キャッシュ）を持たない純粋関数として実装し、
     * ASTのミュータブルな変更（splice等）に対する不整合を完全に防ぎます。
     */
    static resolveRef(node: IRNode, prop: any): IRNode | undefined {
        if (!prop || prop.type !== 'ref' || !node.children) return undefined;
        return node.children.find(c => c.irNodeId === prop.irNodeId);
    }

    /**
     * 参照プロパティの配列から、子ノードの配列を安全に解決します。
     */
    static resolveRefArray(node: IRNode, propArray: any): IRNode[] {
        if (!Array.isArray(propArray)) return [];
        return propArray.map(p => this.resolveRef(node, p)).filter((n): n is IRNode => n !== undefined);
    }

    /**
     * パターンノード（Identifier, ObjectPattern, ArrayPattern 等）から定義識別子ノードを再帰抽出します。
     */
    static extractPatternIdentifiers(patternNode: IRNode): IRNode[] {
        const results: IRNode[] = [];
        const walk = (node: IRNode) => {
            if (!node) return;
            if (node.type === 'Identifier') {
                results.push(node);
                return;
            }
            if (node.type === 'ObjectPattern') {
                const properties = node.props.properties || [];
                for (const propRef of properties) {
                    const propNode = IRUtils.resolveRef(node, propRef);
                    if (propNode) {
                        if (propNode.type === 'Property' || propNode.type === 'ObjectProperty') {
                            const valNode = IRUtils.resolveRef(propNode, propNode.props.value);
                            if (valNode) walk(valNode);
                        } else if (propNode.type === 'RestElement') {
                            const argNode = IRUtils.resolveRef(propNode, propNode.props.argument);
                            if (argNode) walk(argNode);
                        }
                    }
                }
            } else if (node.type === 'ArrayPattern') {
                const elements = node.props.elements || [];
                for (const elRef of elements) {
                    const elNode = IRUtils.resolveRef(node, elRef);
                    if (elNode) walk(elNode);
                }
            } else if (node.type === 'AssignmentPattern') {
                const leftNode = IRUtils.resolveRef(node, node.props.left);
                if (leftNode) walk(leftNode);
            } else if (node.type === 'RestElement') {
                const argNode = IRUtils.resolveRef(node, node.props.argument);
                if (argNode) walk(argNode);
            }
        };
        walk(patternNode);
        return results;
    }
}

