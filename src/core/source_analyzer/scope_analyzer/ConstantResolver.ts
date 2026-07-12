import { IRNode, IRRoot } from '../ir_converter/ASTtoIRConverter';
import { IRUtils } from '../ir_converter/IRUtils';

export class ConstantResolver {
    private declToInitMap = new Map<string, IRNode>();
    private refToDeclMap: Map<string, string>;

    constructor(irRoot: IRRoot, refToDeclMap: Map<string, string>) {
        this.refToDeclMap = refToDeclMap;
        this.buildDeclToInitMap(irRoot);
    }

    private buildDeclToInitMap(node: IRNode) {
        if (node.type === 'VariableDeclarator') {
            const idNode = IRUtils.resolveRef(node, node.props.id);
            const initNode = IRUtils.resolveRef(node, node.props.init);
            if (idNode && idNode.type === 'Identifier' && initNode) {
                this.declToInitMap.set(idNode.irNodeId, initNode);
            }
        }
        if (node.children) {
            for (const child of node.children) {
                this.buildDeclToInitMap(child);
            }
        }
    }

    /**
     * 指定されたノード（識別子など）を定数追跡して最終的な値を返します。
     * 解決できない場合は元のノードをそのまま返します。
     */
    public resolve(node: IRNode, visited = new Set<string>()): IRNode {
        if (node.type === 'Identifier') {
            const declId = this.refToDeclMap.get(node.irNodeId);
            if (declId && !visited.has(declId)) {
                visited.add(declId);
                const initNode = this.declToInitMap.get(declId);
                if (initNode) {
                    return this.resolve(initNode, visited);
                }
            }
        }
        return node;
    }
}
