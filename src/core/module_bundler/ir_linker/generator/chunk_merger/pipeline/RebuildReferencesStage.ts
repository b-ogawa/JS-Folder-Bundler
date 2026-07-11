import { PipelineStage } from '../../../../../infra/Pipeline';
import { MergeContext } from '../MergeContext';

export class RebuildReferencesStage implements PipelineStage<MergeContext> {
    public readonly name = 'RebuildReferencesStage';

    execute(context: MergeContext): void {
        for (const binding of context.mergedScopeInfo.bindings.values()) {
            binding.references = [];
        }
        
        for (const refToDeclMap of context.refToDeclMaps.values()) {
            for (const [refId, resolvedDeclId] of refToDeclMap.entries()) {
                if (refId !== resolvedDeclId) {
                    const actualDeclId = context.extImportRedirects.get(resolvedDeclId) || resolvedDeclId;
                    const binding = context.mergedScopeInfo.bindings.get(actualDeclId);
                    if (binding) {
                        if (!binding.references.includes(refId)) {
                            binding.references.push(refId);
                        }
                    }
                }
            }
        }
    }
}
