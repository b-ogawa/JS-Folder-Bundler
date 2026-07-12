import { CFGBlock } from './models/CFGBlock';
import { DFAState } from './models/DFAState';
import { ReachingDefState } from './models/ReachingDefState';
import { IRNode } from '../../../source_analyzer/ir_converter/ASTtoIRConverter';

export class AnalysisSnapshot {
    constructor(
        public readonly blocks: ReadonlyMap<string, CFGBlock>,
        public readonly nodeToBlock: ReadonlyMap<string, string>,
        public readonly livenessStates: ReadonlyMap<string, DFAState>,
        public readonly parentMap: ReadonlyMap<string, string>, // irNodeId -> parentIrNodeId
        public readonly refToDeclMap: ReadonlyMap<string, string>, // refId -> declId
        public readonly referenceCounts: ReadonlyMap<string, number>, // declId -> reference count
        public readonly escapedVars: ReadonlySet<string>, // declId that are escaped (used in closures, exports, globals)
        public readonly reachingDefStates: ReadonlyMap<string, ReachingDefState>,
        public readonly defToVar: ReadonlyMap<string, string[]>, // 1対多の定義リストに変更
        public readonly nodeMap: ReadonlyMap<string, IRNode>,
        public readonly unmergedReachingDefs: ReadonlyMap<string, Map<string, ReachingDefState>> = new Map()
    ) {}

    public hasDivergingStates(nodeId: string): boolean {
        const blockId = this.nodeToBlock.get(nodeId);
        if (!blockId) return false;
        
        // We only care about diverging states if this node is at the START of a block.
        const block = this.blocks.get(blockId);
        if (!block || block.nodes.length === 0 || block.nodes[0].irNodeId !== nodeId) return false;

        const unmerged = this.unmergedReachingDefs.get(blockId);
        if (!unmerged || unmerged.size < 2) return false;

        // Check if there is any difference between the reaching defs of predecessors
        let firstState: ReadonlySet<string> | null = null;
        for (const stateObj of unmerged.values()) {
            const state = stateObj.out; // Extract the OUT state from the predecessor
            if (firstState === null) {
                firstState = state;
            } else {
                if (firstState.size !== state.size) return true;
                for (const item of firstState) {
                    if (!state.has(item)) return true;
                }
            }
        }
        return false;
    }

    public isVariableLiveAfter(declId: string, nodeAfterId: string): boolean {
        // If it's an escaped variable (global, exported, or closure captured),
        // we must conservatively consider it ALWAYS live because we don't know who might read it.
        if (this.escapedVars.has(declId)) {
            return true;
        }

        const state = this.livenessStates.get(nodeAfterId);
        // 情報がない（探索中に新しく生成されたノードなど）場合は保守的に「生存している(true)」と判定する
        return state ? state.out.has(declId) : true;
    }

    public getReachingDefinitions(nodeId: string, declId: string): ReadonlySet<string> {
        const state = this.reachingDefStates.get(nodeId);
        if (!state) return new Set<string>();

        const result = new Set<string>();
        for (const defId of state.in) {
            const definedVars = this.defToVar.get(defId);
            // 配列内に目的の変数が含まれているかをチェック
            if (definedVars && definedVars.includes(declId)) {
                result.add(defId);
            }
        }
        return result;
    }

    /**
     * 変数の参照IDから、その実体となる関数ノード（FunctionDeclaration、ArrowFunctionExpression、または FunctionExpression）を安全に取得します。
     * 直接指定された関数式・アロー関数式の解決、DFAによる再代入の追跡、および静的スコープによるグローバル参照やホイスティングの解決をカプセル化します。
     */
    public resolveFunctionDefinition(refNodeId: string): IRNode | null {
        // 0. 対象のノード自体がすでにアロー関数や関数式の場合は直接返す
        const node = this.nodeMap.get(refNodeId);
        if (node && (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression')) {
            return node;
        }

        const declId = this.refToDeclMap.get(refNodeId) || refNodeId;
        const declNode = this.nodeMap.get(declId);
        if (declNode && (declNode.type === 'ArrowFunctionExpression' || declNode.type === 'FunctionExpression')) {
            return declNode;
        }
        
        // 1. DFA (Reaching Definitions) で追跡を試みる
        const defs = this.getReachingDefinitions(refNodeId, declId);
        if (defs && defs.size === 1) {
            const defId = Array.from(defs)[0];
            const defNode = this.nodeMap.get(defId);
            if (defNode) {
                if (defNode.type === 'FunctionDeclaration') return defNode;
                if (defNode.type === 'VariableDeclarator') {
                    const initRef = defNode.props.init;
                    if (initRef && initRef.type === 'ref') {
                        const initNode = this.nodeMap.get(initRef.irNodeId);
                        if (initNode && (initNode.type === 'ArrowFunctionExpression' || initNode.type === 'FunctionExpression')) {
                            return initNode;
                        }
                    }
                }
            }
        }

        // 2. DFAが断絶している（グローバル関数やホイスティング）場合は、スコープツリーから静的に解決する
        const parentId = this.parentMap.get(declId);
        if (parentId) {
            const parent = this.nodeMap.get(parentId);
            if (parent) {
                if (parent.type === 'FunctionDeclaration') return parent;
                if (parent.type === 'VariableDeclarator') {
                    const initRef = parent.props.init;
                    if (initRef && initRef.type === 'ref') {
                        const initNode = this.nodeMap.get(initRef.irNodeId);
                        if (initNode && (initNode.type === 'ArrowFunctionExpression' || initNode.type === 'FunctionExpression')) {
                            return initNode;
                        }
                    }
                }
            }
        }
        return null;
    }
}