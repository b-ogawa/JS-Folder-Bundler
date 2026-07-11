export interface ReachingDefState {
    readonly in: ReadonlySet<string>;  // irNodeId of definitions
    readonly out: ReadonlySet<string>; // irNodeId of definitions
}
