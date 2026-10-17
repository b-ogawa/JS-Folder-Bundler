import { IRNode, IRRoot } from '../ir_converter/ASTtoIRConverter';
import { IRUtils } from '../ir_converter/IRUtils';

export class ConstantResolver {
    private declToInitMap = new Map<string, IRNode>();
    private refToDeclMap: Map<string, string>;
    private reassignedDeclIds = new Set<string>();

    constructor(irRoot: IRRoot, refToDeclMap: Map<string, string>) {
        this.refToDeclMap = refToDeclMap;
        this.collectReassignments(irRoot);
        this.buildDeclToInitMap(irRoot);
    }

    private collectReassignments(node: IRNode) {
        if (node.type === 'AssignmentExpression') {
            const leftNode = IRUtils.resolveRef(node, node.props.left);
            if (leftNode) {
                const idents = IRUtils.extractPatternIdentifiers(leftNode);
                for (const id of idents) {
                    const declId = this.refToDeclMap.get(id.irNodeId) || id.irNodeId;
                    this.reassignedDeclIds.add(declId);
                }
            }
        } else if (node.type === 'UpdateExpression') {
            const argNode = IRUtils.resolveRef(node, node.props.argument);
            if (argNode && argNode.type === 'Identifier') {
                const declId = this.refToDeclMap.get(argNode.irNodeId) || argNode.irNodeId;
                this.reassignedDeclIds.add(declId);
            }
        } else if (node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
            const leftNode = IRUtils.resolveRef(node, node.props.left);
            if (leftNode) {
                const idents = IRUtils.extractPatternIdentifiers(leftNode);
                for (const id of idents) {
                    const declId = this.refToDeclMap.get(id.irNodeId) || id.irNodeId;
                    this.reassignedDeclIds.add(declId);
                }
            }
        }

        if (node.children) {
            for (const child of node.children) {
                this.collectReassignments(child);
            }
        }
    }

    private buildDeclToInitMap(node: IRNode, parentKind?: string) {
        const currentKind = node.type === 'VariableDeclaration' ? (node.props.kind as string) : parentKind;
        if (node.type === 'VariableDeclarator' && currentKind === 'const') {
            const idNode = IRUtils.resolveRef(node, node.props.id);
            const initNode = IRUtils.resolveRef(node, node.props.init);
            if (idNode && idNode.type === 'Identifier' && initNode) {
                if (!this.reassignedDeclIds.has(idNode.irNodeId)) {
                    this.declToInitMap.set(idNode.irNodeId, initNode);
                }
            }
        }
        if (node.children) {
            for (const child of node.children) {
                this.buildDeclToInitMap(child, currentKind);
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
