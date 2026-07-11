import { DataFlowProblem } from '../../../1_domain/analysis/models/DataFlowProblem';
import { LivenessData } from '../../../1_domain/analysis/models/NodeDataFlowSets';

export class LivenessAnalysis implements DataFlowProblem<Set<string>, LivenessData> {
    direction: 'forward' | 'backward' = 'backward';

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

    transferNode(data: LivenessData, inputState: Set<string>): Set<string> {
        for (const d of data.def) inputState.delete(d);
        for (const u of data.use) inputState.add(u);
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
