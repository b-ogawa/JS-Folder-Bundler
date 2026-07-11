import { IRRoot } from '../source_analyzer/ir_converter/ASTtoIRConverter';
import { CompilationState, CompilerServices } from './1_domain/state/CompilationState';
import { ActionScanner } from './3_search/ActionScanner';
import { StateExpander } from './3_search/StateExpander';
import { DecisionEngine } from './DecisionEngine';
import { NativeFlowAnalyzer } from './2_service/analysis/NativeFlowAnalyzer';
import { PhaseScheduler } from './2_service/PhaseScheduler';

export interface OptimizerConfig {
    enableBeamSearch?: boolean;
    beamWidth?: number;
    stage1Depth?: number;
    stage2Depth?: number;
    patience?: number;
    maxIterations?: number;
    enabledRuleIds?: Record<string, boolean>;
    terserCompress?: boolean;
    services?: CompilerServices; // 外部サービス定義
    logger?: (log: { type: 'info' | 'success' | 'error'; msg: string }) => void;
}

export class IROptimizer {
    static optimize(initialRoot: IRRoot, config: OptimizerConfig): IRRoot {
        const logger = config.logger || (() => {});
        const baseBeamWidth = config.enableBeamSearch ? (config.beamWidth || 3) : 1;
        const maxIterations = config.maxIterations !== undefined ? config.maxIterations : 5;
        const isTerserEnabled = !!config.terserCompress;
        
        // --- 決定論的IDジェネレータの注入 ---
        let _optCounter = 0;
        const defaultGenerateId = (prefix = 'ir_opt') => `${prefix}_${(++_optCounter).toString(36)}`;
        const services: CompilerServices = {
            ...config.services,
            generateId: config.services?.generateId || defaultGenerateId
        };
        
        let currentRoot = initialRoot;
        let lastBestCost = DecisionEngine.getInitialCost(new CompilationState(currentRoot, {}, null, services), isTerserEnabled);

        for (let iter = 0; iter < maxIterations; iter++) {
            logger({ type: 'info', msg: `[IROptimizer] Iteration ${iter + 1}/${maxIterations} starting with Cost: ${lastBestCost} bytes` });
            
            let currentStates = [new CompilationState(currentRoot, {}, null, services)];
            let bestOverallState = currentStates[0];
            let bestOverallCost = lastBestCost;

            // PhaseScheduler から「探索リソースの配分計画」を受け取る
            const schedules = PhaseScheduler.getSchedules(baseBeamWidth, config, config.enabledRuleIds);

            for (const schedule of schedules) {
                logger({ type: 'info', msg: `[IROptimizer] Entering Phase: ${schedule.id} (Depth: ${schedule.maxDepth}, Beam: ${schedule.beamWidth})` });

                let noImprovementCount = 0;
                let scheduleBestCost = bestOverallCost;

                for (let depth = 0; depth < schedule.maxDepth; depth++) {
                    let allNextStates: CompilationState[] = [];
                    let hasNewActions = false;

                    for (const state of currentStates) {
                        const snapshot = NativeFlowAnalyzer.analyze(state.irRoot);
                        const analyzedState = state.withAnalysis(snapshot);

                        // ミクロ・マクロの全ルールを一括スキャン
                        const actions = ActionScanner.scan(analyzedState, schedule.rules);
                        
                        // Tabu List (禁忌リスト) によるフィルタリング
                        const appliedActions = (state.metadata as any).appliedActions || new Set<string>();
                        const validActions = actions.filter(action => {
                            const key = `${action.ruleId}:${action.targetIrNodeId}`;
                            return !appliedActions.has(key);
                        });

                        if (validActions.length > 0) {
                            hasNewActions = true;
                            const expandedStates = StateExpander.expand(analyzedState, validActions);
                            allNextStates.push(...expandedStates);
                        } else {
                            allNextStates.push(analyzedState);
                        }
                    }

                    if (!hasNewActions) {
                        logger({ type: 'info', msg: `[IROptimizer] Search space exhausted. Breaking early at depth ${depth + 1}.` });
                        break;
                    }

                    // DecisionEngineによる状態の評価と枝刈り
                    currentStates = DecisionEngine.evaluateAndPrune(allNextStates, schedule.beamWidth, isTerserEnabled);
                    const currentBestCost = DecisionEngine.getInitialCost(currentStates[0], isTerserEnabled);

                    // 最小コスト更新時の処理
                    if (currentBestCost < bestOverallCost) {
                        const actionTaken = currentStates[0].metadata.lastAction || 'Unknown Action';
                        const savedBytes = bestOverallCost - currentBestCost;
                        logger({ type: 'success', msg: `[IROptimizer] Cost Reduced: ${bestOverallCost} -> ${currentBestCost} bytes (-${savedBytes} bytes) by [${actionTaken}]` });
                        
                        bestOverallState = currentStates[0];
                        bestOverallCost = currentBestCost;
                    }

                    // スケジュール内での改善チェック
                    if (currentBestCost < scheduleBestCost) {
                        scheduleBestCost = currentBestCost;
                        noImprovementCount = 0;
                    } else {
                        noImprovementCount++;
                    }
                    
                    console.debug(`[IROptimizer] Depth ${depth + 1}/${schedule.maxDepth} | Current Best Cost: ${currentBestCost} | Overall Best: ${bestOverallCost}`);

                    const patienceLimit = config.patience !== undefined ? config.patience : 3;
                    if (noImprovementCount >= patienceLimit) {
                        logger({ type: 'info', msg: `[IROptimizer] Cost stagnation detected (${noImprovementCount} steps without improvement). Breaking early.` });
                        break;
                    }
                }
            }

            // 以前のイテレーションと比較してコストが改善しなかった場合は早期に終了する
            if (bestOverallCost >= lastBestCost) {
                logger({ type: 'success', msg: `[IROptimizer] Optimization converged at iteration ${iter + 1}` });
                break;
            }

            currentRoot = bestOverallState.irRoot;
            lastBestCost = bestOverallCost;
        }

        return currentRoot;
    }
}
