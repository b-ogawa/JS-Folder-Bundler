import { DataFlowProblem } from '../../../1_domain/analysis/models/DataFlowProblem';
import { ReachingDefData } from '../../../1_domain/analysis/models/NodeDataFlowSets';

export class ReachingDefinitionAnalysis implements DataFlowProblem<Set<string>, ReachingDefData> {
    direction: 'forward' | 'backward' = 'forward';

    meet(states: Iterable<Set<string>>): Set<string> {
        const result = new Set<string>();
        for (const state of states) {
            for (const v of state) {
                result.add(v);
            }
        }
        return result;
    }

    boundaryCondition(): Set<string> {
        return new Set<string>();
    }

    initialState(): Set<string> {
        return new Set<string>();
    }

    transferNode(data: ReachingDefData, inputState: Set<string>): Set<string> {
        for (const k of data.kill) inputState.delete(k);
        for (const g of data.gen) inputState.add(g);
        return inputState;
    }

    equals(a: Set<string>, b: Set<string>): boolean {
        if (a.size !== b.size) return false;
        for (const item of a) if (!b.has(item)) return false;
        return true;
    }

    clone(state: Set<string>): Set<string> {
        return new Set<string>(state);
    }
}
