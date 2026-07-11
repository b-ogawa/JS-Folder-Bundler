export class VariableMangler {
    private static terserLoadPromise: Promise<any> | null = null;

    /**
     * TerserをCDNから動的にロードし、globalThis.Terserにマウント
     */
    private static async loadTerser(): Promise<any> {
        if ((globalThis as any).Terser) {
            return (globalThis as any).Terser;
        }

        if (this.terserLoadPromise) {
            return this.terserLoadPromise;
        }

        if (typeof window === 'undefined') {
            throw new Error("Terser is not loaded in this environment (no window available).");
        }

        console.info("[VariableMangler] Terser is not found. Fetching from CDN...");
        
        this.terserLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            // jsdelivrでネットワークエラーになるケースがあるためunpkgに変更
            script.src = 'https://unpkg.com/terser/dist/bundle.min.js';
            
            script.onload = () => {
                if ((globalThis as any).Terser) {
                    console.info("[VariableMangler] Terser successfully loaded from CDN.");
                    resolve((globalThis as any).Terser);
                } else {
                    reject(new Error("Terser script loaded, but globalThis.Terser is still undefined."));
                }
            };
            
            script.onerror = () => {
                reject(new Error("Failed to load Terser from CDN. It might be blocked by an AdBlocker or network issue."));
            };
            
            document.head.appendChild(script);
        });

        return this.terserLoadPromise;
    }

    static async mangle(code: string, enableCompress: boolean = false, logger?: (log: { type: 'info' | 'success' | 'error'; msg: string }) => void): Promise<string> {
        const log = (msg: string, type: 'info' | 'success' | 'error' = 'info') => {
            console.log(`[VariableMangler] ${msg}`);
            if (logger) {
                logger({ type, msg: `[VariableMangler] ${msg}` });
            }
        };

        log(`Starting mangle process... Code length: ${code.length}, enableCompress: ${enableCompress}`);
        
        let Terser: any;
        try {
            Terser = await this.loadTerser();
            log(`Terser successfully loaded. Version: ${Terser.VERSION || 'unknown'}`);
        } catch (e: any) {
            log(`Failed to load Terser: ${e.message}`, 'error');
            return code;
        }

        try {
            const minifyOptions = {
                toplevel: false,
                mangle: {
                    toplevel: false,
                },
                compress: enableCompress ? {
                    toplevel: false,
                    passes: 2
                } : false,
                output: {
                    beautify: false,
                    // HTMLのインラインスクリプト内での安全なエスケープ処理を指示
                    inline_script: true
                }
            };
            log(`Calling Terser.minify with options: ${JSON.stringify(minifyOptions)}`);

            const resultPromise = Terser.minify(code, minifyOptions);
            log(`Terser.minify returned type: ${typeof resultPromise}. Is Promise: ${resultPromise instanceof Promise}`);
            
            const result = await resultPromise;
            
            if (!result) {
                log('Terser returned null or undefined result', 'error');
                return code;
            }

            log(`Terser result keys: ${Object.keys(result).join(', ')}`);
            if (result.error) {
                log(`Terser inner error: ${result.error.message || result.error}`, 'error');
                if (result.error.stack) {
                    log(`Terser error stack: ${result.error.stack}`, 'error');
                }
                return code;
            }

            if (result.code === undefined || result.code === null) {
                log('Terser result.code is undefined or null', 'error');
                return code;
            }

            log(`Terser minify completed successfully. Output length: ${result.code.length}`);
            log(`Original head: ${code.substring(0, 100)}...`);
            log(`Mangled head: ${result.code.substring(0, 100)}...`);
            
            return result.code;
        } catch (error: any) {
            log(`Terser execution threw exception: ${error.message}\nStack: ${error.stack}`, 'error');
            return code; // 失敗時は元のコードを安全に返す
        }
    }
}