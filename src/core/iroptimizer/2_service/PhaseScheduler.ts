import { TransformRegistry } from '../1_domain/rules/TransformRegistry';
import { TransformRule } from '../interface/TransformRule';

export interface SearchStrategyConfig {
    id: string;
    rules: TransformRule[]; // 適用対象の全ルール（ミクロ・マクロを包括）
    maxDepth: number;       // 最大探索深度（先読み数）
    beamWidth: number;      // ビーム幅（保持する最大候補数）
}

export class PhaseScheduler {
    /**
     * 最適化パスの順序問題（Phase Ordering Problem）を解決するため、
     * ルールをフェーズで分けることはせず、常に「全ルール」で同時探索を行う。
     * ここでの責務は、ビームサーチの「探索の深さ」と「幅（メモリ使用量）」の
     * ペース配分（スケジューリング）を Orchestrator に提案すること。
     */
    static getSchedules(baseBeamWidth: number, config?: { stage1Depth?: number; stage2Depth?: number }, enabledRuleIds?: Record<string, boolean>): SearchStrategyConfig[] {
        // UIの設定に基づいて、有効なルールだけをフィルタリングする (データ駆動)
        const allRules = TransformRegistry.getAllRules().filter(rule => {
            const defEnabled = rule.defaultEnabled ?? true;
            if (!enabledRuleIds) return defEnabled;
            return enabledRuleIds[rule.id] ?? defEnabled;
        });
        const stage1Depth = config?.stage1Depth !== undefined ? config.stage1Depth : 3;
        const stage2Depth = config?.stage2Depth !== undefined ? config.stage2Depth : 10;

        return [
            {
                id: 'STAGE_1_BROAD_SEARCH',
                rules: allRules,
                maxDepth: stage1Depth,          // ユーザー指定の広域探索深度
                beamWidth: baseBeamWidth * 2   // 広く（多様な状態候補を保持）
            },
            {
                id: 'STAGE_2_DEEP_GOLFING',
                rules: allRules,
                maxDepth: stage2Depth,          // ユーザー指定の詳細探索深度
                beamWidth: baseBeamWidth       // ビーム幅を絞り込んで最適化を収束させる
            }
        ];
    }
}
