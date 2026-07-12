export interface DataFlowProblem<State, NodeData> {
    direction: 'forward' | 'backward';
    
    // Meet operator (merging states at control flow join points)
    meet(states: Iterable<State>): State;
    
    // Initial state for boundaries (Entry/Exit) and other blocks
    boundaryCondition(): State;
    initialState(): State;
    
    // Transfer function for a single node, using only extracted data
    // This function can modify inputState in-place to reduce memory allocation overhead.
    transferNode(data: NodeData, inputState: State): State;
    
    // Compare states for convergence
    equals(a: State, b: State): boolean;

    // Clone state to isolate persistent states from in-place updates.
    clone(state: State): State;
}
