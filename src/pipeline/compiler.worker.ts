// スクリプト読み込みおよび評価完了の確認
console.log('[Compiler Worker] Script loaded and evaluated successfully.');

import * as Babel from '@babel/standalone';
import * as Terser from 'terser';
import { SourceAnalyzerFacade } from '../core/source_analyzer/SourceAnalyzerFacade';
import { WorldCompiler } from './WorldCompiler';
import { VariableMangler } from '../core/physical_compressor/VariableMangler';
import { VirtualFileSystem } from '../core/asset_extractor/VirtualFileSystem';
import { BabelPatcher } from '../core/utils/BabelPatcher';

// 1. インポートしたライブラリを globalThis に登録し、既存コードがそのまま動くようにする
(globalThis as any).Babel = Babel;
(globalThis as any).Terser = Terser;

// 2. Worker内グローバルのBabelにパッチを適用 (traverse, typesの露出)
try {
    BabelPatcher.applyPatch();
} catch (e) {
    console.error("[Compiler Worker] Failed to apply Babel patch:", e);
}

// グローバルエラーのハンドリング
self.addEventListener('error', (e) => {
    console.error('[Worker Global Error]', e);
    self.postMessage({
        type: 'error', requestId: 'unknown',
        error: { message: `[Worker Global Error] ${e.message} (File: ${e.filename}, Line: ${e.lineno})`, stack: e.error?.stack || '' }
    });
});
self.addEventListener('unhandledrejection', (e) => {
    console.error('[Worker Unhandled Rejection]', e);
    self.postMessage({
        type: 'error', requestId: 'unknown',
        error: { message: `[Worker Unhandled Rejection] ${e.reason?.message || String(e.reason)}`, stack: e.reason?.stack || '' }
    });
});

// 3. メッセージハンドラ
self.onmessage = async (e: MessageEvent<any>) => {
    const reqId = e.data?.requestId || 'unknown';
    const logger = (log: { type: 'info' | 'success' | 'error'; msg: string }) => {
        self.postMessage({ type: 'log', requestId: reqId, log });
    };

    // スレッドのメッセージ受信通知
    logger({ type: 'info', msg: '[Worker] Worker thread successfully triggered and received data.' });

    try {
        const { requestId, serializedVfs, config, filterOptions, mainEntryPaths, actualMode, actualHtmlEntry } = e.data;
        logger({ type: 'info', msg: '[Worker] Data deserialization started...' });

        const vfs = VirtualFileSystem.fromSerialized(serializedVfs);
        logger({ type: 'info', msg: '[Worker] VFS ready. Starting SourceAnalyzerFacade.analyzeAll...' });

        // AST解析および元のファイルサイズ計算
        const irTrees = SourceAnalyzerFacade.analyzeAll(vfs, filterOptions);
        logger({ type: 'info', msg: `[Worker] AST analysis complete. Parsed ${irTrees.length} files.` });
        let originalSize = 0;
        
        if (actualMode === 'direct') {
            const inputCode = vfs.read('input.js') || '';
            originalSize = new Blob([inputCode]).size;
        } else {
            for (const tree of irTrees) {
                const fileContent = vfs.read(tree.filePath);
                if (fileContent) originalSize += new Blob([fileContent]).size;
            }
            const htmlPath = actualHtmlEntry || 'index.html';
            const htmlContent = vfs.read(htmlPath);
            if (htmlContent) originalSize += new Blob([htmlContent]).size;
        }

        const worldCompiler = new WorldCompiler(vfs, config, filterOptions, logger);

        // インラインスクリプトの個別限界圧縮 (WorldCompiler + VariableMangler)
        const inlineMetaStr = vfs.read('_meta_inline_scripts.json');
        if (inlineMetaStr) {
            const inlineList = JSON.parse(inlineMetaStr);
            for (const item of inlineList) {
                let optCode = await worldCompiler.compile(item.path);
                if (config.golfEnabled && config.enableMangle) {
                    optCode = await VariableMangler.mangle(optCode, config.terserCompress, logger);
                }
                const cleanCode = optCode.replace(/^["']use strict["'];?\s*/i, '');
                vfs.write(item.path, cleanCode);
            }
        }

        // メインスクリプトのコンパイル
        let jsCodeStr = '';
        if (mainEntryPaths.length > 0) {
            jsCodeStr = await worldCompiler.compile(mainEntryPaths);
        }

        const externalImportsSet = worldCompiler.getExternalImports();

        // メインコードの難読化と圧縮
        if (config.golfEnabled && config.enableMangle) {
            logger({ type: 'info', msg: '[Worker] Executing VariableMangler on main script...' });
            jsCodeStr = await VariableMangler.mangle(jsCodeStr, !!config.terserCompress, logger);
        }

        const cleanCode = jsCodeStr.trim();
        if (cleanCode === '') {
            jsCodeStr = '';
        } else if (config.addStrict && !cleanCode.startsWith('"use strict"') && !cleanCode.startsWith("'use strict'")) {
            jsCodeStr = '"use strict";\n' + jsCodeStr;
        }

        // 4. 成功メッセージの返却
        self.postMessage({
            type: 'success',
            requestId: reqId,
            result: {
                jsCodeStr,
                serializedVfs: vfs.serialize(),
                originalSize,
                externalImports: Array.from(externalImportsSet)
            }
        });
    } catch (err: any) {
        // エラー詳細を UI のログパネルにも強制出力する
        logger({ type: 'error', msg: `[Worker Exception] ${err?.message || String(err)}\nStack: ${err?.stack || ''}` });

        // 5. エラーハンドリングとエラー情報の返却
        self.postMessage({
            type: 'error',
            requestId: reqId,
            error: {
                message: err.message,
                stack: err.stack
            }
        });
    }
};
