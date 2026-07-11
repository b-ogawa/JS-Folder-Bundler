import { AppState } from '../types';
import { AssetExtractorFacade } from '../core/asset_extractor/AssetExtractorFacade';
import { AssetMultiplexer } from '../core/physical_compressor/AssetMultiplexer';
import { VirtualFileSystem } from '../core/asset_extractor/VirtualFileSystem';
import { PathResolver } from '../core/module_bundler/path_resolver/PathResolver';

export type CompileLog = {
    type: 'info' | 'success' | 'error';
    msg: string;
};

export class CompilerPipelineFacade {
    // 1. スレッド間で使い回すシングルトンWorker
    private static workerInstance: Worker | null = null;
    // 2. 現在実行中の最新の要求を追跡するID
    private static currentRequestId: string | null = null;
    // 3. メッセージ通信用のシーケンシャルカウンター
    private static messageCounter: number = 0;

    private static getOrCreateWorker(): Worker {
        if (!this.workerInstance) {
            // Viteの module type worker 生成機能を利用する
            this.workerInstance = new Worker(
                new URL('./compiler.worker.ts', import.meta.url),
                { type: 'module' }
            );
        }
        return this.workerInstance;
    }

    async compile(state: AppState, logger: (log: CompileLog) => void): Promise<{code: string, stats: any}> {
        return new Promise(async (resolve, reject) => {
            try {
                logger({ type: 'info', msg: 'Initializing Compiler Pipeline' });
                // 設定情報の整合性確認
                logger({ type: 'info', msg: `[Config Debug] golfEnabled: ${state.config.golfEnabled}, enableMangle: ${state.config.enableMangle}, terserCompress: ${state.config.terserCompress}` });
                const requestId = `req_${++CompilerPipelineFacade.messageCounter}`;
                CompilerPipelineFacade.currentRequestId = requestId;

                const sessionBundleId = 'bundle_main';

                logger({ type: 'info', msg: 'Demultiplexing HTML assets...' });
                const extractorConfig = {
                    inputCode: state.inputCode,
                    mode: state.mode,
                    htmlEntry: state.config.htmlEntry,
                    files: state.files
                };
                const vfs = AssetExtractorFacade.extract(extractorConfig);
                const actualMode = extractorConfig.mode;
                const actualHtmlEntry = extractorConfig.htmlEntry;

                const filterOptions = {
                    includeNodeModules: state.config.includeNodeModules,
                    excludePatterns: state.config.excludePatternsStr
                        ? state.config.excludePatternsStr.split(',').map(p => p.trim()).filter(Boolean)
                        : undefined
                };

                let mainEntryPaths: string[] = [];
                if (actualMode === 'html') {
                    const extractedJsStr = vfs.read('_meta_extracted_js.json');
                    if (extractedJsStr) {
                        try {
                            const entries = JSON.parse(extractedJsStr) as string[];
                            const allFiles = Array.from(vfs.getAll().keys());
                            const htmlBase = actualHtmlEntry || 'index.html';
                            
                            for (const entry of entries) {
                                const resolved = PathResolver.resolve(htmlBase, entry, allFiles);
                                if (resolved) mainEntryPaths.push(resolved);
                            }
                        } catch (err) {}
                    }
                    if (mainEntryPaths.length === 0) {
                        const allFiles = Array.from(vfs.getAll().keys()).filter(f => !f.startsWith('_inline_script_') && !f.startsWith('_meta_'));
                        const likelyEntry = allFiles.find(f => f.endsWith('main.tsx') || f.endsWith('index.tsx') || f.endsWith('main.ts') || f.endsWith('index.ts'));
                        if (likelyEntry) mainEntryPaths.push(likelyEntry);
                        else {
                            const firstJs = allFiles.find(f => f.endsWith('.tsx') || f.endsWith('.ts') || f.endsWith('.jsx') || f.endsWith('.js'));
                            if (firstJs) mainEntryPaths.push(firstJs);
                        }
                    }
                } else {
                    mainEntryPaths.push('input.js');
                }

                // エントリーポイントの確認
                logger({ type: 'info', msg: `[Entry Debug] Detected Main Entries: ${mainEntryPaths.join(', ')}` });

                const worker = CompilerPipelineFacade.getOrCreateWorker();

                worker.onmessage = (e: MessageEvent) => {
                    const data = e.data;
                    if (data.requestId !== CompilerPipelineFacade.currentRequestId) {
                        logger({ type: 'error', msg: `[Facade] Message ignored due to requestId mismatch (Expected: ${CompilerPipelineFacade.currentRequestId}, Got: ${data.requestId}). Type: ${data.type}` });
                        if (data.type === 'error') {
                            logger({ type: 'error', msg: `[Facade] Ignored Error Content: ${data.error?.message}` });
                        }
                        return;
                    }

                    if (data.type === 'log') {
                        logger(data.log);
                    } else if (data.type === 'success') {
                        const { jsCodeStr, serializedVfs, originalSize, externalImports } = data.result;
                        const updatedVfs = VirtualFileSystem.fromSerialized(serializedVfs);
                        
                        logger({ type: 'info', msg: 'Recombining assets (Multiplexing)...' });
                        const compressorConfig = {
                            ...state.config,
                            mode: actualMode,
                            htmlEntry: actualHtmlEntry,
                            externalImports,
                            bundleId: sessionBundleId
                        };

                        let outputCode = jsCodeStr;
                        if (actualMode === 'html' && actualHtmlEntry) {
                            outputCode = AssetMultiplexer.multiplex(jsCodeStr, updatedVfs, actualHtmlEntry, compressorConfig);
                        }
                        const finalSize = new Blob([outputCode]).size;
                        logger({ type: 'success', msg: 'Compilation complete' });
                        resolve({ code: outputCode, stats: { originalSize, finalSize } });
                    } else if (data.type === 'error') {
                        const errorMsg = `Worker Error: ${data.error.message}\nStack: ${data.error.stack || ''}`;
                        logger({ type: 'error', msg: errorMsg });
                        reject(new Error(data.error.message));
                    }
                };

                worker.onerror = (err: any) => {
                    // messageが空の場合にオブジェクト全体をシリアライズして原因を特定する
                    const errMsg = err.message || (err.error && err.error.message) || JSON.stringify(err, ['message', 'filename', 'lineno', 'colno', 'type']);
                    logger({ type: 'error', msg: `Worker internal process error: ${errMsg}` });
                    reject(err);
                };

                try {
                    logger({ type: 'info', msg: '[Facade] Dispatching data to Worker...' });
                    worker.postMessage({
                        requestId,
                        serializedVfs: vfs.serialize(),
                        config: { ...state.config, bundleId: sessionBundleId },
                        filterOptions,
                        mainEntryPaths,
                        actualMode,
                        actualHtmlEntry
                    });
                    logger({ type: 'info', msg: '[Facade] Data successfully dispatched to Worker.' });
                } catch (postErr: any) {
                    logger({ type: 'error', msg: `[Facade] Failed to postMessage to Worker. Serialization error? ${postErr.message}` });
                    reject(postErr);
                }

            } catch (err: any) {
                logger({ type: 'error', msg: `Error: ${err.message}` });
                reject(err);
            }
        });
    }
}
