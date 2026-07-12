import { IRNode, IRRoot } from '../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { AnalysisSnapshot } from '../../1_domain/analysis/AnalysisSnapshot';
import { CFGBuilder } from './CFGBuilder';
import { ScopeResolver } from '../../../source_analyzer/scope_analyzer/ScopeResolver';
import { IRDataFlowExtractor } from './extractor/IRDataFlowExtractor';
import { DataFlowSolver } from './DataFlowSolver';
import { LivenessAnalysis } from './problems/LivenessAnalysis';
import { ReachingDefinitionAnalysis } from './problems/ReachingDefinitionAnalysis';

export class NativeFlowAnalyzer {
    public static analyze(irRoot: IRRoot): AnalysisSnapshot {
        const { blocks, nodeToBlock, parentMap } = CFGBuilder.build(irRoot);
        
        const nodeMap = new Map<string, IRNode>();
        const buildNodeMap = (n: IRNode) => {
            nodeMap.set(n.irNodeId, n);
            if (n.children) n.children.forEach(buildNodeMap);
        };
        buildNodeMap(irRoot);

        // Resolve refToDeclMap straight from ScopeInfo
        const refToDeclMap = ScopeResolver.resolve(irRoot);

        // Pre-compute O(1) reference counts
        const referenceCounts = new Map<string, number>();
        for (const [refId, declId] of refToDeclMap.entries()) {
            if (refId !== declId) { // Ignore self-references
                // Only count the reference if it exists in the current tree
                if (nodeMap.has(refId)) {
                    referenceCounts.set(declId, (referenceCounts.get(declId) || 0) + 1);
                }
            }
        }

        // Get escaped variables from ScopeInfo
        const escapedVars = new Set<string>();
        if (irRoot.scopeInfo && irRoot.scopeInfo.escapedVars) {
            for (const escapedIrId of irRoot.scopeInfo.escapedVars) {
                // We don't strictly need to check nodeMap for escaped variables, 
                // but doing it for safety.
                if (nodeMap.has(escapedIrId)) {
                    escapedVars.add(escapedIrId);
                }
            }
        }

        // --- New Data-Driven DFA Engine ---
        // 1. Data Extraction Phase
        const livenessDataMap = IRDataFlowExtractor.extractLivenessData(blocks, refToDeclMap, parentMap, nodeMap);
        const { dataMap: reachingDefDataMap, defToVar } = IRDataFlowExtractor.extractReachingDefData(blocks, refToDeclMap, nodeMap);

        // 2. Solving Phase
        const livenessProblem = new LivenessAnalysis();
        const { nodeStates: livenessStates } = DataFlowSolver.solve(livenessProblem, blocks, livenessDataMap);

        const reachingDefProblem = new ReachingDefinitionAnalysis();
        const { nodeStates: reachingDefStates, unmergedBlockStates: unmergedReachingDefs } = DataFlowSolver.solve(reachingDefProblem, blocks, reachingDefDataMap);
        
        return new AnalysisSnapshot(
            blocks, 
            nodeToBlock, 
            livenessStates, 
            parentMap, 
            refToDeclMap, 
            referenceCounts,
            escapedVars,
            reachingDefStates, 
            defToVar, 
            nodeMap,
            unmergedReachingDefs
        );
    }
}