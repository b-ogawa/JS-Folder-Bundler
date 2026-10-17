import { JsoncUtils } from '../../utils/JsoncUtils';

interface JSXConfig {
    factory?: string;
    fragment?: string;
    runtime?: 'classic' | 'automatic';
    importSource?: string;
    isSolid?: boolean;
}

export class ASTBuilder {
    private static inferJSXConfig(vfs?: any, sourceCode?: string): JSXConfig {
        const config: JSXConfig = {};

        // 1. tsconfig.json / jsconfig.json の compilerOptions 解析（ルートフォルダプレフィックス対応）
        if (vfs && typeof vfs.read === 'function') {
            let tsconfigContent = vfs.read('tsconfig.json') || vfs.read('/tsconfig.json') || vfs.read('jsconfig.json');
            if (!tsconfigContent && typeof vfs.list === 'function') {
                const allFiles: string[] = vfs.list();
                const tcPath = allFiles.find(f => f.endsWith('/tsconfig.json') || f.endsWith('/jsconfig.json'));
                if (tcPath) tsconfigContent = vfs.read(tcPath);
            }
            if (tsconfigContent) {
                try {
                    const parsed = JsoncUtils.parse(tsconfigContent);
                    const compilerOptions = parsed?.compilerOptions;
                    if (compilerOptions) {
                        if (compilerOptions.jsxFactory) config.factory = compilerOptions.jsxFactory;
                        if (compilerOptions.jsxFragmentFactory) config.fragment = compilerOptions.jsxFragmentFactory;
                        if (compilerOptions.jsxImportSource) config.importSource = compilerOptions.jsxImportSource;
                        if (compilerOptions.jsx) {
                            const jsx = String(compilerOptions.jsx).toLowerCase();
                            if (jsx.includes('react-jsx')) {
                                config.runtime = 'automatic';
                            } else if (jsx === 'preserve' || jsx === 'react') {
                                config.runtime = 'classic';
                            }
                        }
                    }
                } catch (e) {
                    console.warn('[JSXInference] Failed to parse tsconfig.json:', e);
                }
            }
        }

        // 2. ソースコード内プラグマコメントの静的解析
        if (sourceCode) {
            const pragmaMatch = sourceCode.match(/@jsx\s+([^\s*]+)/);
            if (pragmaMatch) config.factory = pragmaMatch[1];
            const fragMatch = sourceCode.match(/@jsxFrag\s+([^\s*]+)/);
            if (fragMatch) config.fragment = fragMatch[1];
            const importSourceMatch = sourceCode.match(/@jsxImportSource\s+([^\s*]+)/);
            if (importSourceMatch) config.importSource = importSourceMatch[1];
            const runtimeMatch = sourceCode.match(/@jsxRuntime\s+(classic|automatic)/);
            if (runtimeMatch) config.runtime = runtimeMatch[1] as 'classic' | 'automatic';
        }

        // 3. インポート状況からのランタイム安全推論
        if (!config.runtime && sourceCode) {
            const hasModuleImports = /\bimport\s+(?:[\s\S]*?\s+from\s+)?['"][^'"]+['"]/.test(sourceCode);
            const hasClassicFactoryImport = /\bimport\s+(?:(?:\*\s+as\s+React\b)|(?:React\b)|(?:\{[^}]*\bh\b[^}]*\}))/.test(sourceCode);

            if (hasModuleImports && !hasClassicFactoryImport) {
                config.runtime = 'automatic';
            } else {
                config.runtime = 'classic';
            }
        }

        return config;
    }

    static build(sourceCode: string, filePath: string, vfs?: any): any {
        try {
            const Babel = (globalThis as any).Babel;
            if (!Babel) {
                throw new Error("Babel standalone is not loaded on the globalThis object.");
            }

            const isTS = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
            const isExplicitJSX = filePath.endsWith('.jsx') || filePath.endsWith('.tsx') || filePath.endsWith('.js');

            const buildPresets = (enableJsx: boolean) => {
                const presets: any[] = [];
                if (isTS) presets.push('typescript');
                if (enableJsx) {
                    const jsxConfig = this.inferJSXConfig(vfs, sourceCode);
                    if (jsxConfig.isSolid && Babel.availablePresets && Babel.availablePresets['solid']) {
                        presets.push('solid');
                    } else {
                        const reactOpts: any = { runtime: jsxConfig.runtime || 'classic' };
                        if (jsxConfig.factory) reactOpts.pragma = jsxConfig.factory;
                        if (jsxConfig.fragment) reactOpts.pragmaFrag = jsxConfig.fragment;
                        if (jsxConfig.importSource) reactOpts.importSource = jsxConfig.importSource;
                        presets.push(['react', reactOpts]);
                    }
                }
                return presets;
            };

            let transformed: any;
            try {
                // .ts ファイルは TS ジェネリクス誤爆を防ぐため JSX なしでトランスパイルを試行
                transformed = Babel.transform(sourceCode, {
                    filename: filePath,
                    presets: buildPresets(isExplicitJSX && !filePath.endsWith('.ts')),
                    ast: false,
                    code: true,
                    caller: { name: 'ast-builder', supportsStaticESM: true }
                });
            } catch (firstErr) {
                // .ts ファイルで構文エラーとなった場合のみ、フォールバックとして JSX を有効化して再試行
                if (filePath.endsWith('.ts')) {
                    transformed = Babel.transform(sourceCode, {
                        filename: filePath.replace(/\.ts$/, '.tsx'),
                        presets: buildPresets(true),
                        ast: false,
                        code: true,
                        caller: { name: 'ast-builder', supportsStaticESM: true }
                    });
                } else {
                    throw firstErr;
                }
            }

            const pureJsCode = transformed.code || '';

            let parserSourceType: 'module' | 'script' | 'unambiguous' = 'unambiguous';
            if (vfs && typeof vfs.read === 'function') {
                const inlineMetaStr = vfs.read('_meta_inline_scripts.json');
                if (inlineMetaStr) {
                    try {
                        const inlineList = JSON.parse(inlineMetaStr);
                        const matched = inlineList.find((item: any) => item.path === filePath);
                        if (matched) {
                            parserSourceType = matched.isModule ? 'module' : 'script';
                        }
                    } catch {}
                }
            }

            // ピュアなJS文字列をクリーンなASTへパース
            const astResult = Babel.transform(pureJsCode, {
                filename: filePath.replace(/\.(ts|tsx|jsx)$/, '.js'),
                presets: [],
                ast: true,
                code: false,
                parserOpts: { sourceType: parserSourceType }
            });

            if (!astResult || !astResult.ast) {
                throw new Error("Babel failed to produce an AST from the transpiled code.");
            }

            return astResult.ast;
        } catch (e: any) {
            console.error("[ASTBuilder] 構文解析・変換エラー:", e.message);
            throw e;
        }
    }
}