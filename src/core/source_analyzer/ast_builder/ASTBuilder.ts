interface JSXConfig {
    factory?: string;
    fragment?: string;
    runtime?: 'classic' | 'automatic';
    importSource?: string;
    isSolid?: boolean;
}

export class ASTBuilder {
    private static inferJSXConfig(vfs?: any): JSXConfig {
        const config: JSXConfig = {};
        if (!vfs) return config;

        // 1. Try to read tsconfig.json
        const tsconfigContent = typeof vfs.read === 'function' 
            ? (vfs.read('tsconfig.json') || vfs.read('/tsconfig.json'))
            : null;

        if (tsconfigContent) {
            try {
                const placeholders: string[] = [];
                const stringRegex = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
                let cleaned = tsconfigContent.replace(stringRegex, (match) => {
                    const id = `___JSONC_STR_${placeholders.length}___`;
                    placeholders.push(match);
                    return id;
                });
                cleaned = cleaned.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
                for (let i = placeholders.length - 1; i >= 0; i--) {
                    cleaned = cleaned.replace(`___JSONC_STR_${i}___`, () => placeholders[i]);
                }
                const parsed = JSON.parse(cleaned);
                const compilerOptions = parsed?.compilerOptions;
                if (compilerOptions) {
                    if (compilerOptions.jsxFactory) {
                        config.factory = compilerOptions.jsxFactory;
                    }
                    if (compilerOptions.jsxFragmentFactory) {
                        config.fragment = compilerOptions.jsxFragmentFactory;
                    }
                    if (compilerOptions.jsx) {
                        const jsx = String(compilerOptions.jsx).toLowerCase();
                        if (jsx.includes('react-jsx')) {
                            config.runtime = 'automatic';
                        } else if (jsx === 'preserve' || jsx === 'react') {
                            config.runtime = 'classic';
                        }
                    }
                    if (compilerOptions.jsxImportSource) {
                        config.importSource = compilerOptions.jsxImportSource;
                    }
                }
            } catch (e) {
                console.warn('[JSXInference] Failed to parse tsconfig.json:', e);
            }
        }

        // 2. Try to read package.json
        const packageContent = typeof vfs.read === 'function'
            ? (vfs.read('package.json') || vfs.read('/package.json'))
            : null;

        if (packageContent) {
            try {
                const parsed = JSON.parse(packageContent);
                const deps = { ...parsed?.dependencies, ...parsed?.devDependencies };
                if (deps) {
                    if (deps['preact']) {
                        config.factory = config.factory || 'h';
                        config.fragment = config.fragment || 'Fragment';
                        config.importSource = config.importSource || 'preact';
                        config.runtime = config.runtime || 'classic';
                    } else if (deps['solid-js']) {
                        config.isSolid = true;
                    }
                }
            } catch (e) {
                console.warn('[JSXInference] Failed to parse package.json:', e);
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
            
            // .js 拡張子でのJSX記述（Create React App等）を許容する。
            // 念のため、誤って .ts 拡張子でJSXが書かれた場合のヒューリスティック・フォールバックも追加。
            const isJSX = filePath.endsWith('.jsx') || 
                          filePath.endsWith('.tsx') || 
                          filePath.endsWith('.js') ||
                          (filePath.endsWith('.ts') && /<[A-Za-z]+/.test(sourceCode));
                          
            const presets = [];
            
            if (isTS) presets.push('typescript');
             if (isJSX) {
                const jsxConfig = this.inferJSXConfig(vfs);
                if (jsxConfig.isSolid && Babel.availablePresets && Babel.availablePresets['solid']) {
                    presets.push('solid');
                } else {
                    const reactOpts: any = {};
                    if (jsxConfig.factory) reactOpts.pragma = jsxConfig.factory;
                    if (jsxConfig.fragment) reactOpts.pragmaFrag = jsxConfig.fragment;
                    
                    // ランタイムが明示されていない場合は、UMD環境との互換性を保つため 'classic' を強制する
                    reactOpts.runtime = jsxConfig.runtime || 'classic';
                    
                    if (jsxConfig.importSource) reactOpts.importSource = jsxConfig.importSource;
                    
                    presets.push(['react', reactOpts]);
                }
            }

            // 1. まず完全にトランスパイルを実行し、型とJSXを消し去った「ピュアなJS文字列」を得る
            const transformed = Babel.transform(sourceCode, {
                filename: filePath,
                presets,
                ast: false, 
                code: true,
                caller: { name: 'ast-builder', supportsStaticESM: true } 
            });

            const pureJsCode = transformed.code || '';

            // 2. ピュアなJS文字列を、今度はプラグインなしで純粋にパースしてクリーンなASTを得る
            const astResult = Babel.transform(pureJsCode, {
                filename: filePath.replace(/\.(ts|tsx|jsx)$/, '.js'),
                presets: [], 
                ast: true,
                code: false, 
                parserOpts: { sourceType: 'module' }
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