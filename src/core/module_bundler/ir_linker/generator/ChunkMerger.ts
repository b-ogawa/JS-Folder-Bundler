import { IRRoot, IRNode } from '../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { ModuleInfo } from '../types';
import { MergeContext } from './chunk_merger/MergeContext';
import { Pipeline } from '../../../infra/Pipeline';
import { ExtractTopLevelDeclarationsStage } from './chunk_merger/pipeline/ExtractTopLevelDeclarationsStage';
import { ResolveExternalImportsStage } from './chunk_merger/pipeline/ResolveExternalImportsStage';
import { BindImportResolutionsStage } from './chunk_merger/pipeline/BindImportResolutionsStage';
import { ResolveNameConflictsStage } from './chunk_merger/pipeline/ResolveNameConflictsStage';
import { ReplaceDynamicImportsStage } from './chunk_merger/pipeline/ReplaceDynamicImportsStage';
import { PrepareMergedScopeStage } from './chunk_merger/pipeline/PrepareMergedScopeStage';
import { TransformASTNodesStage } from './chunk_merger/pipeline/TransformASTNodesStage';
import { RebuildReferencesStage } from './chunk_merger/pipeline/RebuildReferencesStage';
import { MergeExternalImportsStage } from './chunk_merger/pipeline/MergeExternalImportsStage';
import { AssembleFinalBundleStage } from './chunk_merger/pipeline/AssembleFinalBundleStage';

export class ChunkMerger {
    public static merge(
        irTrees: IRRoot[],
        modules: Map<string, ModuleInfo>,
        entryBasePaths: Set<string>,
        isExternalModule: (sourcePath: string, currentFilePath: string) => boolean,
        getBase: (p: string) => string,
        refToDeclMaps: Map<string, Map<string, string>>,
        resolvePath: (sourceFilePath: string, rawPath: string) => string,
        isAsset: (resolvedPath: string) => boolean,
        fileExists: (resolvedPath: string) => boolean,
        parseTemplate: (code: string) => IRNode[],
        reachabilityMap: Map<string, Set<string>> | undefined,
        workerEntryBases: Set<string> | undefined,
        bundleId: string | undefined,
        logger: ((log: { type: 'info' | 'success' | 'error'; msg: string }) => void) | undefined
    ): IRRoot {
        // 1. パイプライン共通コンテキストの初期化
        const context = new MergeContext(
            irTrees,
            modules,
            entryBasePaths,
            isExternalModule,
            getBase,
            refToDeclMaps,
            resolvePath,
            isAsset,
            fileExists,
            parseTemplate,
            reachabilityMap,
            workerEntryBases,
            bundleId,
            logger
        );

        // 2. パイプラインを構築
        const pipeline = new Pipeline<MergeContext>(context);
        pipeline
            .add(new ExtractTopLevelDeclarationsStage())
            .add(new ResolveExternalImportsStage())
            .add(new BindImportResolutionsStage())
            .add(new ResolveNameConflictsStage())
            .add(new ReplaceDynamicImportsStage())
            .add(new PrepareMergedScopeStage())
            .add(new TransformASTNodesStage())
            .add(new RebuildReferencesStage())
            .add(new MergeExternalImportsStage())
            .add(new AssembleFinalBundleStage());

        // 3. パイプラインを実行
        pipeline.run();

        // 4. 結合後のルートASTを返却
        return context.linkedRoot;
    }
}