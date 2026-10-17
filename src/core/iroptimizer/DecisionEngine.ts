import { CompilationState } from './1_domain/state/CompilationState';
import { CostEstimator } from './1_domain/utils/CostEstimator';

function getIRSignature(node: any, childIndexMap?: Map<string, number>): string {
    if (!node || typeof node !== 'object') {
        return String(node);
    }
    if (Array.isArray(node)) {
        return `[${node.map(item => getIRSignature(item, childIndexMap)).join(',')}]`;
    }
    if (node.type === 'ref') {
        const idx = childIndexMap ? childIndexMap.get(node.irNodeId) : undefined;
        return idx !== undefined ? `{ref:#${idx}}` : `{ref:${node.irNodeId}}`;
    }
    const parts: string[] = [];
    if (node.type) {
        parts.push(`t:${node.type}`);
    }
    if (node.props) {
        const localIndexMap = new Map<string, number>();
        if (Array.isArray(node.children)) {
            for (let i = 0; i < node.children.length; i++) {
                const c = node.children[i];
                if (c && c.irNodeId) {
                    localIndexMap.set(c.irNodeId, i);
                }
            }
        }
        parts.push(`p:${getIRSignatureProps(node.props, localIndexMap)}`);
    }
    if (node.children) {
        parts.push(`c:${getIRSignature(node.children)}`);
    }
    if (parts.length === 0) {
        const keys = Object.keys(node).sort();
        for (const k of keys) {
            if (k !== 'id' && !k.startsWith('_')) {
                parts.push(`${k}:${getIRSignature(node[k], childIndexMap)}`);
            }
        }
    }
    return `{${parts.join(',')}}`;
}

function getIRSignatureProps(props: any, childIndexMap: Map<string, number>): string {
    if (!props || typeof props !== 'object') {
        return String(props);
    }
    if (Array.isArray(props)) {
        return `[${props.map(item => getIRSignatureProps(item, childIndexMap)).join(',')}]`;
    }
    const parts: string[] = [];
    const keys = Object.keys(props).sort();
    for (const k of keys) {
        if (k.startsWith('_')) continue;
        parts.push(`${k}:${getIRSignature(props[k], childIndexMap)}`);
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

