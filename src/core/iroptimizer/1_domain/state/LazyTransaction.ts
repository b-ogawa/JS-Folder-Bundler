import { IRNode, IRRoot } from '../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { CompilationState } from './CompilationState';

export type MutationType = 'replace' | 'remove';

export interface Mutation {
    type: MutationType;
    targetIrNodeId: string;
    newNode?: IRNode;
}

export class LazyTransaction {
    private baseState: CompilationState;
    private mutations: Map<string, Mutation>;

    constructor(baseState: CompilationState) {
        this.baseState = baseState;
        this.mutations = new Map();
    }

    public clone(): LazyTransaction {
        const cloned = new LazyTransaction(this.baseState);
        cloned.mutations = new Map(this.mutations);
        return cloned;
    }

    public replace(targetIrNodeId: string, newNode: IRNode): void {
        this.mutations.set(targetIrNodeId, { type: 'replace', targetIrNodeId, newNode });
    }

    public remove(targetIrNodeId: string): void {
        this.mutations.set(targetIrNodeId, { type: 'remove', targetIrNodeId });
    }

    public commit(): CompilationState {
        if (this.mutations.size === 0) {
            return this.baseState;
        }

        const newRootNode = this.applyMutations(this.baseState.irRoot) as IRRoot;
        return this.baseState.withIRRoot(newRootNode);
    }

    private applyMutations(node: IRNode, excludedIds: Set<string> = new Set()): IRNode {
        // ノード自体が置換対象の場合（ルートを含む部分木の置換など）
        const nodeMutation = this.mutations.get(node.irNodeId);
        if (nodeMutation && nodeMutation.type === 'replace' && nodeMutation.newNode && !excludedIds.has(node.irNodeId)) {
             excludedIds.add(node.irNodeId);
             const result = this.applyMutations(nodeMutation.newNode, excludedIds);
             excludedIds.delete(node.irNodeId); // バックトラック
             return result;
        }

        let hasChanges = false;
        const newProps: Record<string, any> = {};

        const getFinalId = (id: string): string => {
            let currentId = id;
            const visited = new Set<string>();
            while (true) {
                if (visited.has(currentId)) break;
                visited.add(currentId);
                const m = this.mutations.get(currentId);
                if (m && m.type === 'replace' && m.newNode) {
                    currentId = m.newNode.irNodeId;
                } else {
                    break;
                }
            }
            return currentId;
        };
        
        // プロパティ内の子ノード参照の更新
        for (const [key, val] of Object.entries(node.props)) {
            if (Array.isArray(val)) {
                const newArray = [];
                let arrayChanged = false;
                for (const item of val) {
                    if (item && item.type === 'ref') {
                        const m = this.mutations.get(item.irNodeId);
                        if (m && m.type === 'remove') {
                            arrayChanged = true; // 削除
                        } else {
                            const finalId = getFinalId(item.irNodeId);
                            if (finalId !== item.irNodeId) {
                                arrayChanged = true;
                                newArray.push({ type: 'ref', irNodeId: finalId });
                            } else {
                                newArray.push(item);
                            }
                        }
                    } else {
                        newArray.push(item);
                    }
                }
                newProps[key] = newArray;
                if (arrayChanged) hasChanges = true;
            } else if (val && val.type === 'ref') {
                const m = this.mutations.get(val.irNodeId);
                if (m && m.type === 'remove') {
                    hasChanges = true;
                    newProps[key] = null; // または適切に削除
                } else {
                    const finalId = getFinalId(val.irNodeId);
                    if (finalId !== val.irNodeId) {
                        hasChanges = true;
                        newProps[key] = { type: 'ref', irNodeId: finalId };
                    } else {
                        newProps[key] = val;
                    }
                }
            } else {
                newProps[key] = val;
            }
        }

        // 子ノード配列の更新
        const newChildren: IRNode[] = [];
        for (const child of node.children) {
            const m = this.mutations.get(child.irNodeId);
            if (m && m.type === 'remove') {
                hasChanges = true; // 子ノードの削除
            } else {
                const newChild = this.applyMutations(child, excludedIds);
                newChildren.push(newChild);
                if (newChild !== child) {
                    hasChanges = true;
                }
            }
        }

        // 変更があった場合のみ、新しいインスタンスを作成して返す
        if (hasChanges) {
            return {
                ...node,
                props: newProps,
                children: newChildren
            };
        }

        return node; // 変更がなければ既存のオブジェクトを構造共有
    }
}
