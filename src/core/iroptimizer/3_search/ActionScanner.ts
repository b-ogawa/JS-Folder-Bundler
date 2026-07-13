import { CompilationState } from '../1_domain/state/CompilationState';
import { TransformRule } from '../interface/TransformRule';
import { IRNode } from '../../source_analyzer/ir_converter/ASTtoIRConverter';

export interface OptimizationAction {
    ruleId: string;
    targetIrNodeId: string;
    candidateIndex: number;
    candidateNode: IRNode | null; // nullはノード削除を示す
}

export class ActionScanner {
    /**
     * ルールの種類（micro/macro）に応じて最適化候補を収集する。
     * 収集した最適化候補は平坦なリストとして返却する。
     */
    static scan(state: CompilationState, rules: TransformRule[]): OptimizationAction[] {
        const microRules = rules.filter(r => r.type === 'micro');
        const macroRules = rules.filter(r => r.type === 'macro');

        const actions: OptimizationAction[] = [];

        // 局所最適化（micro）
        if (microRules.length > 0) {
            this.scanMicro(state.irRoot, state, microRules, actions);
        }

        // 大域最適化（macro）
        if (macroRules.length > 0) {
            this.scanMacro(state, macroRules, actions);
        }

        return actions;
    }

    // 局所的なAST構造に基づく探索（micro）
    private static scanMicro(
        node: IRNode,
        state: CompilationState,
        rules: TransformRule[],
        actions: OptimizationAction[]
    ) {
        if (!node) return;

        for (const rule of rules) {
            try {
                if (rule.match(node, state)) {
                    const candidates = rule.candidates(node, state);
                    
                    // matchに適合したにもかかわらずcandidatesが未生成の場合のエラーチェック
                    if (!candidates) {
                        console.error(`[ActionScanner] CRITICAL: Rule '${rule.id}' returned null/undefined candidates!`);
                    }
                    
                    this.recordActions(node.irNodeId, rule.id, candidates || [], actions);
                }
            } catch (e: any) {
                // 例外発生時のコンテキストログ出力と再スロー
                console.error(`[ActionScanner] CRASH in Rule '${rule.id}' (Micro) on Node '${node.type}' (${node.irNodeId})`);
                console.error(`[ActionScanner] Node Props:`, node.props);
                throw e; // 呼び出し元への例外の伝播
            }
        }

        if (node.children && Array.isArray(node.children)) {
            for (const child of node.children) {
                this.scanMicro(child, state, rules, actions);
            }
        }
    }

    // 解析スナップショットに基づく大域的な探索（macro）
    private static scanMacro(
        state: CompilationState,
        rules: TransformRule[],
        actions: OptimizationAction[]
    ) {
        const snapshot = state.analysisSnapshot;
        if (!snapshot) return;

        // 解析結果のノード一覧から、大域的な条件に合致するノードを抽出する
        for (const node of snapshot.nodeMap.values()) {
            for (const rule of rules) {
                try {
                    if (rule.match(node, state)) {
                        const candidates = rule.candidates(node, state);
                        this.recordActions(node.irNodeId, rule.id, candidates || [], actions);
                    }
                } catch (e: any) {
                    // グローバル最適化処理における例外の即時伝播
                    console.error(`[ActionScanner] CRASH in Rule '${rule.id}' (Macro) on Node '${node.type}' (${node.irNodeId})`);
                    throw e;
                }
            }
        }
    }

    // アクションの記録
    private static recordActions(
        targetId: string,
        ruleId: string,
        candidates: (IRNode | null)[],
        actions: OptimizationAction[]
    ) {
        if (candidates.length === 0) {
            return;
        }

        candidates.forEach((candidate, index) => {
            actions.push({ ruleId, targetIrNodeId: targetId, candidateIndex: index, candidateNode: candidate });
        });
    }
}