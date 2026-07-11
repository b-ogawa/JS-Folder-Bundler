export interface PipelineStage<TContext> {
    readonly name: string;
    execute(context: TContext): void;
}

export class Pipeline<TContext> {
    private stages: PipelineStage<TContext>[] = [];

    constructor(private context: TContext) {}

    public add(stage: PipelineStage<TContext>): this {
        this.stages.push(stage);
        return this;
    }

    public run(): void {
        for (const stage of this.stages) {
            stage.execute(this.context);
        }
    }
}
