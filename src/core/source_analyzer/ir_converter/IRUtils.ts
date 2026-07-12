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
}
