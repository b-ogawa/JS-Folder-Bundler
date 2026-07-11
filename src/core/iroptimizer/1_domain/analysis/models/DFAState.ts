export interface DFAState {
    readonly in: ReadonlySet<string>;
    readonly out: ReadonlySet<string>;
}
