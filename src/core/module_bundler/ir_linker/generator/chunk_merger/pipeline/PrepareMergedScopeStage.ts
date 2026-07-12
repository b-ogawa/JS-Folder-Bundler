import { IRRoot, IRScopeInfo } from '../../../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { PipelineStage } from '../../../../../infra/Pipeline';
import { MergeContext } from '../MergeContext';

export class PrepareMergedScopeStage implements PipelineStage<MergeContext> {
    public readonly name = 'PrepareMergedScopeStage';

    execute(context: MergeContext): void {
        // 1. スコープ情報コンテナの初期化
        context.mergedScopeInfo = {
            bindings: new Map(),
            scopes: new Map(),
            escapedVars: new Set(),
            errors: []
        };

        // 2. 衝突防止用の一意な名前生成
        context.spawnFuncName = context.getDeterministicId('__spawn');
        context.chunkUrlFuncName = context.getDeterministicId('__getChunkUrl');

        // 3. 結合用 IRRoot の作成
        context.linkedRoot = {
            type: 'IRRoot',
            irNodeId: 'ir_root_linked',
            filePath: 'bundle.js',
            props: {},
            children: [{
                type: 'File',
                irNodeId: 'ir_file_linked',
                props: {
                    program: { type: 'ref', irNodeId: 'ir_program_linked' },
                    comments: [],
                    tokens: []
                },
                children: [{
                    type: 'Program',
                    irNodeId: 'ir_program_linked',
                    props: {
                        sourceType: 'module',
                        body: [],
                        directives: []
                    },
                    children: []
                }]
            }],
            scopeInfo: context.mergedScopeInfo
        };

        // 4. 各ファイルのスコープ情報のマージとリネームの適用
        for (const tree of context.irTrees) {
            const basePath = context.getBase(tree.filePath);
            const mod = context.modules.get(basePath) || context.modules.get(basePath + '/index');
            if (!mod) continue;

            const isEntryFile = context.entryBasePaths.has(basePath) || context.entryBasePaths.has(basePath + '/index');
            const isWorkerEntryFile = context.workerEntryBases && (context.workerEntryBases.has(basePath) || context.workerEntryBases.has(basePath + '/index'));

            if (tree.scopeInfo) {
                // bindings マージ & renameJobsの適用
                for (const [id, binding] of tree.scopeInfo.bindings.entries()) {
                    const finalName = context.renameJobs.get(id) || binding.name;
                    context.mergedScopeInfo.bindings.set(id, { ...binding, name: finalName });
                }

                // scopes マージ
                for (const [id, scope] of tree.scopeInfo.scopes.entries()) {
                    context.mergedScopeInfo.scopes.set(id, { ...scope });
                }

                // escapedVars マージ
                for (const id of tree.scopeInfo.escapedVars) {
                    context.mergedScopeInfo.escapedVars.add(id);
                }

                // errors マージ
                context.mergedScopeInfo.errors.push(...tree.scopeInfo.errors);
            }

            // エントリーポイントからのエクスポートされた定義を escapedVars に追加する
            if (isEntryFile || isWorkerEntryFile) {
                for (const declId of mod.exports.values()) {
                    const actualDeclId = context.extImportRedirects.get(declId) || declId;
                    context.mergedScopeInfo.escapedVars.add(actualDeclId);
                }

                // ReachabilityTracerで行っている保護ロジックと一致させるため、
                // エントリーファイルのトップレベル宣言も escapedVars に登録し、後段の最適化エンジン(Golf)のDCEから保護する
                for (const stmt of mod.statements.values()) {
                    if (stmt.type === 'Declaration') {
                        for (const declId of stmt.defines) {
                            const actualDeclId = context.extImportRedirects.get(declId) || declId;
                            context.mergedScopeInfo.escapedVars.add(actualDeclId);
                        }
                    }
                }
            }
        }
    }
}