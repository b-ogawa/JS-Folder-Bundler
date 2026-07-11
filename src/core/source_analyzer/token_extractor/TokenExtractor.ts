export class TokenExtractor {
    /**
     * ソースコードを字句解析し、トークンの配列を抽出する
     * Babelの内部APIを隠蔽し、独自のパイプラインで利用可能な形式で返す
     */
    static extract(sourceCode: string) {
        try {
            const Babel = (globalThis as any).Babel;
            if (!Babel) {
                throw new Error("Babel standalone is not loaded on the globalThis object.");
            }

            let tokens = [];
            if (typeof Babel.parse === 'function') {
                const ast = Babel.parse(sourceCode, {
                    filename: 'temp.tsx',
                    presets: ['typescript', 'react'],
                    parserOpts: { tokens: true }
                });
                tokens = ast?.tokens || [];
            } else {
                const transformed = Babel.transform(sourceCode, {
                    filename: 'temp.tsx',
                    presets: ['typescript', 'react'],
                    ast: true,
                    code: false,
                    configFile: false,
                    babelrc: false,
                    parserOpts: { tokens: true }
                });
                tokens = transformed?.ast?.tokens || [];
            }
            return tokens;
        } catch (e: any) {
            console.error("[TokenExtractor] 字句解析エラー:", e.message);
            throw e;
        }
    }
}

