import { CompilationState } from '../1_domain/state/CompilationState';
import { LazyTransaction } from '../1_domain/state/LazyTransaction';
import { OptimizationAction } from './ActionScanner';

export class StateExpander {
    /**
     * Phase Ordering Search (最適化順序の探索):
     * 抽出された全アクションを一括適用するのではなく、
     * 「ルール（Rule ID）ごと」にグループ化し、
     * 「どのルール群を適用するのが最適か」を探索するための候補状態（分岐）を展開する。
     */
    static expand(baseState: CompilationState, actions: OptimizationAction[]): CompilationState[] {
        if (actions.length === 0) return [];

        const nextStates: CompilationState[] = [];

        // 1. アクションを「ルール（Rule ID）」ごとにグループ化する
        const actionsByRule = new Map<string, OptimizationAction[]>();
        for (const action of actions) {
            if (!actionsByRule.has(action.ruleId)) {
                actionsByRule.set(action.ruleId, []);
            }
            actionsByRule.get(action.ruleId)!.push(action);
        }

        // 2. ルールごとに対象状態を分岐させる（探索空間の構築）
        for (const [ruleId, ruleActions] of actionsByRule.entries()) {
            
            // 同一ルール内での「確定アクション」と「分岐アクション(複数候補)」を処理する
            const actionsByNode = new Map<string, OptimizationAction[]>();
            for (const action of ruleActions) {
                if (!actionsByNode.has(action.targetIrNodeId)) {
                    actionsByNode.set(action.targetIrNodeId, []);
                }
                actionsByNode.get(action.targetIrNodeId)!.push(action);
            }

            // このルールを適用するためのトランザクション候補
            let ruleTransactions: LazyTransaction[] = [new LazyTransaction(baseState)];

            for (const [nodeId, nodeActions] of actionsByNode.entries()) {
                if (nodeActions.length === 1) {
                    // 確定アクションをすべてのトランザクション候補に適用
                    const action = nodeActions[0];
                    for (const tx of ruleTransactions) {
                        if (action.candidateNode === null) tx.remove(nodeId);
                        else tx.replace(nodeId, action.candidateNode);
                    }
                } else {
                    // 複数候補（例：if文の変換方法が2通りある等）がある場合は、個別の分岐を作成
                    const nextTx: LazyTransaction[] = [];
                    for (const tx of ruleTransactions) {
                        for (const action of nodeActions) {
                            const clonedTx = tx.clone();
                            if (action.candidateNode === null) clonedTx.remove(nodeId);
                            else clonedTx.replace(nodeId, action.candidateNode);
                            nextTx.push(clonedTx);
                        }
                    }
                    // 探索空間の過度な肥大化を防ぐための上限設定
                    ruleTransactions = nextTx.slice(0, 50);
                }
            }

            // 3. ルール適用後の状態を次の探索ステップの候補として確定
            for (const tx of ruleTransactions) {
                const newState = tx.commit();
                
                const newlyApplied = new Set<string>((baseState.metadata as any).appliedActions || []);
                for (const action of ruleActions) {
                    newlyApplied.add(`${action.ruleId}:${action.targetIrNodeId}`);
                }

                const newMetadata = {
                    ...newState.metadata,
                    lastAction: `Applied rule: ${ruleId}`,
                    appliedActions: newlyApplied
                };
                // 第4引数に newState.services を渡し、IDジェネレータ等のサービス群を後続の探索状態へ引き継ぐ
                nextStates.push(new CompilationState(newState.irRoot, newMetadata, newState.analysisSnapshot, newState.services));
            }
        }

        // 「何もしない(No-Op)」状態（ベース状態）も候補として必ず追加する。
        // 全てのルール適用によるコストが改悪だった場合、元の状態が最善として選択可能になる。
        nextStates.push(baseState);

        return nextStates;
    }
}