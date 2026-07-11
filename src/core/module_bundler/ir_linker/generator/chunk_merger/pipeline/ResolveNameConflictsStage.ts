import { PipelineStage } from '../../../../../infra/Pipeline';
import { MergeContext } from '../MergeContext';

export class ResolveNameConflictsStage implements PipelineStage<MergeContext> {
    public readonly name = 'ResolveNameConflictsStage';

    execute(context: MergeContext): void {
        for (const [declId, declInfo] of context.allTopLevelDecls.entries()) {
            const varName = declInfo.varName;
            if (context.globalVariables.has(varName)) {
                let counter = 1;
                let newName = `${varName}_${counter}`;
                while (context.globalVariables.has(newName)) { 
                    counter++; 
                    newName = `${varName}_${counter}`; 
                }
                context.renameJobs.set(declId, newName);
                context.globalVariables.add(newName);
            } else {
                context.globalVariables.add(varName);
            }
        }
    }
}
