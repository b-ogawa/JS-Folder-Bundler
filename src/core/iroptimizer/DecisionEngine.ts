import { CompilationState } from './1_domain/state/CompilationState';
import { CostEstimator } from './1_domain/utils/CostEstimator';

function getIRSignature(node: any): string {
    if (!node || typeof node !== 'object') {
        return String(node);
    }
    if (Array.isArray(node)) {
        return `[${node.map(getIRSignature).join(',')}]`;
    }
    const parts: string[] = [];
    if (node.type) {
        parts.push(`t:${node.type}`);
    }
    if (node.props) {
        parts.push(`p:${getIRSignature(node.props)}`);
    }
    if (node.children) {
        parts.push(`c:${getIRSignature(node.children)}`);
    }
    if (parts.length === 0) {
        const keys = Object.keys(node).sort();
        for (const k of keys) {
            if (k !== 'id') {
                parts.push(`${k}:${getIRSignature(node[k])}`);
            }
        }
    }
    return `{${parts.join(',')}}`;
}

export class DecisionEngine {
    /**
     * Evaluates an array of CompilationStates, calculates their cost,
     * sorts them in ascending order of cost (lower is better),
     * and prunes duplicate states to maintain diversity in the beam.
     * 
     * @param states The array of states to evaluate.
     * @param beamWidth The maximum number of states to retain.
     * @param isTerserEnabled Whether Terser is enabled for physical compression estimation.
     * @returns An array of the best unique CompilationStates up to beamWidth.
     */
    static evaluateAndPrune(states: CompilationState[], beamWidth: number, isTerserEnabled: boolean = false, logger?: any): CompilationState[] {
        if (states.length === 0) return [];
        
        // Calculate cost and structural signature for each state
        const evaluatedStates = states.map(state => {
            const cost = CostEstimator.estimate(state.irRoot, isTerserEnabled, logger || state.services?.logger);
            const signature = getIRSignature(state.irRoot);
            return { state, cost, signature };
        });

        // Sort by cost ascending (lower cost is better)
        evaluatedStates.sort((a, b) => a.cost - b.cost);

        const pruned: CompilationState[] = [];
        const seenSignatures = new Set<string>();

        // Select up to beamWidth unique states to preserve search diversity
        for (const evaluated of evaluatedStates) {
            if (!seenSignatures.has(evaluated.signature)) {
                seenSignatures.add(evaluated.signature);
                pruned.push(evaluated.state);
                if (pruned.length >= beamWidth) break;
            }
        }

        return pruned;
    }

    static checkConvergence(currentState: CompilationState, nextState: CompilationState, isTerserEnabled: boolean = false): { converged: boolean; currentCost: number; nextCost: number } {
        const currentCost = CostEstimator.estimate(currentState.irRoot, isTerserEnabled);
        const nextCost = CostEstimator.estimate(nextState.irRoot, isTerserEnabled);
        return {
            converged: nextCost >= currentCost,
            currentCost,
            nextCost
        };
    }
    
    static getInitialCost(state: CompilationState, isTerserEnabled: boolean = false, logger?: any): number {
        return CostEstimator.estimate(state.irRoot, isTerserEnabled, logger || state.services?.logger);
    }
}

