export interface LivenessData {
    def: Set<string>;
    use: Set<string>;
}

export interface ReachingDefData {
    gen: Set<string>;
    kill: Set<string>;
}
