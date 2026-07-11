export class BabelPatcher {
    /**
     * Babel-standalone の内部API (traverse, types) を
     * ダミープラグイン経由で抽出し、グローバルオブジェクトに露出させるハック
     */
    static applyPatch(): void {
        const Babel = (globalThis as any).Babel;
        if (!Babel) {
            console.warn("[BabelPatcher] globalThis.Babel is not defined. Patch skipped.");
            return;
        }

        try {
            let extractedCtx: any = null;
            Babel.transform("()=>{}", {
                plugins: [function (api: any) {
                    extractedCtx = api;
                    return { visitor: {} };
                }]
            });
            
            if (extractedCtx) {
                if (!Babel.traverse) Babel.traverse = extractedCtx.traverse;
                if (!Babel.types) Babel.types = extractedCtx.types;
                console.log("[BabelPatcher] Successfully extracted and patched internal Babel APIs.");
            }
        } catch (e) {
            console.error("[BabelPatcher] Babel context extraction failed:", e);
        }
    }
}
