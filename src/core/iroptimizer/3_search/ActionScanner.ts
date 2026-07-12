import { CompilationState } from '../1_domain/state/CompilationState';
import { TransformRule } from '../interface/TransformRule';
import { IRNode } from '../../source_analyzer/ir_converter/ASTtoIRConverter';

export interface OptimizationAction {
    ruleId: string;
    targetIrNodeId: string;
    candidateIndex: number;
    candidateNode: IRNode | null; // null means deletion
}

export class ActionScanner {
    /**
     * 最適化候補の「探索手法」をルールの性質（Micro/Macro）によって完全に分離するFacade。
     * 見つけた候補はすべてフラットなActionリストとして返し、Orchestratorによる同時展開を可能にする。
     */
    static scan(state: CompilationState, rules: TransformRule[]): OptimizationAction[] {
        const microRules = rules.filter(r => r.type === 'micro');
        const macroRules = rules.filter(r => r.type === 'macro');

        const actions: OptimizationAction[] = [];

        // 1. 独立ブロック内の最適化候補のサーチ (ASTトラバーサル型)
        if (microRules.length > 0) {
            this.scanMicro(state.irRoot, state, microRules, actions);
        }

        // 2. ブロック間/トポロジー最適化候補のサーチ (アナリシス主導型)
        if (macroRules.length > 0) {
            this.scanMacro(state, macroRules, actions);
        }

        return actions;
    }

    // ==========================================
    // Micro Scanner: 局所的なAST構造に基づく探索
    // ==========================================
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
                    
                    // 整合性検証: matchが適合したにもかかわらず候補配列が生成されない例外を検出
                    if (!candidates) {
                        console.error(`[ActionScanner] CRITICAL: Rule '${rule.id}' returned null/undefined candidates!`);
                    }
                    
                    this.recordActions(node.irNodeId, rule.id, candidates || [], actions);
                }
            } catch (e: any) {
                // 例外発生時における解析処理の即時中断（Fail-Fast）およびコンテキスト情報の出力
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

    // ==========================================
    // Macro Scanner: 分析スナップショットに基づく大域的な探索
    // ==========================================
    private static scanMacro(
        state: CompilationState,
        rules: TransformRule[],
        actions: OptimizationAction[]
    ) {
        const snapshot = state.analysisSnapshot;
        if (!snapshot) return;

        // Macro探索はASTをトップダウンで走査するのではなく、解析結果のノード一覧から
        // 大域的な条件（参照カウント0など）に合致するノードを直接抽出する
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

    // ヘルパー: アクションの記録
    private static recordActions(
        targetId: string,
        ruleId: string,
        candidates: IRNode[],
        actions: OptimizationAction[]
    ) {
        if (candidates.length === 0) {
            actions.push({ ruleId, targetIrNodeId: targetId, candidateIndex: 0, candidateNode: null });
        } else {
            candidates.forEach((candidate, index) => {
                actions.push({ ruleId, targetIrNodeId: targetId, candidateIndex: index, candidateNode: candidate });
            });
        }
    }
}