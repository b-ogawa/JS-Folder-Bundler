import { IRNode } from './ASTtoIRConverter';

export interface IRVisitor {
    enter?: (node: IRNode, parent?: IRNode) => void;
    exit?: (node: IRNode, parent?: IRNode) => void;
    [nodeType: string]: any; // 特定のノードタイプに対するハンドラ（例: CallExpression: (node) => void）
}

export class IRTraverser {
    /**
     * IRツリーを再帰的に走査し、Visitorパターンのコールバックを実行する
     */
    static traverse(node: IRNode, visitor: IRVisitor, parent?: IRNode) {
        if (!node) return;

        if (visitor.enter) visitor.enter(node, parent);
        
        if (typeof visitor[node.type] === 'function') {
            visitor[node.type](node, parent);
        }

        if (node.children) {
            for (const child of node.children) {
                this.traverse(child, visitor, node);
            }
        }

        if (visitor.exit) visitor.exit(node, parent);
    }
}
