export class PathResolver {
    // グローバルロガーを保持する静的プロパティ
    private static globalLogger?: (log: { type: 'info' | 'success' | 'error'; msg: string }) => void;

    // オーケストレーターからロガーを登録する静的メソッド
    static setLogger(logger: (log: { type: 'info' | 'success' | 'error'; msg: string }) => void) {
        this.globalLogger = logger;
    }

    /**
     * 相対パスや絶対パスからVFS上のフルパスを解決する。
     * プロジェクトフォルダ単位でアップロードされた際の「ルートディレクトリ名の不一致」を自動的に補正する。
     */
    static resolve(basePath: string, relativePath: string, existingFiles?: string[], silent: boolean = false): string {
        // --- 早期のファジーマッチング関数 ---
        const findMatch = (targetPath: string): string | undefined => {
            if (!existingFiles || existingFiles.length === 0) return undefined;
            if (existingFiles.includes(targetPath)) return targetPath;
            const suffix = '/' + targetPath;
            return existingFiles.find(f => f.endsWith(suffix));
        };

        const tryExtensions = (base: string): string | undefined => {
            let m = findMatch(base);
            if (m) return m;
            const extensions = ['.tsx', '.ts', '.jsx', '.js'];
            for (const ext of extensions) {
                m = findMatch(base + ext);
                if (m) return m;
            }
            for (const ext of extensions) {
                m = findMatch(base + '/index' + ext);
                if (m) return m;
            }
            return undefined;
        };

        let resolvedBase = '';

        if (relativePath.startsWith('/')) {
            // 絶対パス（ドキュメントルートからの指定）
            resolvedBase = relativePath.replace(/^\/+/, '');
            const match = tryExtensions(resolvedBase);
            if (match) return match;
        } else if (!relativePath.startsWith('.')) {
            // プレフィックスなし相対パス（または外部モジュール）
            const baseDir = basePath.substring(0, basePath.lastIndexOf('/')) || '';
            const testPath = baseDir ? `${baseDir}/${relativePath}` : relativePath;

            // 1. まず testPath (現在のディレクトリ起点) で探す
            let match = tryExtensions(testPath);
            if (match) return match;

            // 2. 次に relativePath (VFSルートからの絶対パス扱い) で探す
            match = tryExtensions(relativePath);
            if (match) return match;

            // 3. どちらも見つからなければ、外部パッケージ（node_modules等）としてそのまま返す
            return relativePath;
        } else {
            // 通常の相対パス（./ や ../）
            const baseDir = basePath.substring(0, basePath.lastIndexOf('/')) || '';
            const baseParts = baseDir ? baseDir.split('/') : [];
            const relParts = relativePath.split('/');
            
            for (const part of relParts) {
                if (part === '.') continue;
                if (part === '..') {
                    if (baseParts.length > 0) baseParts.pop();
                } else {
                    baseParts.push(part);
                }
            }
            resolvedBase = baseParts.join('/');
            const match = tryExtensions(resolvedBase);
            if (match) return match;
        }
        
        // --- VFSに実在しないパスのフォールバック推測 ---
        let resolved = resolvedBase || relativePath;
        if (!resolved.endsWith('.js') && !resolved.endsWith('.ts') && !resolved.endsWith('.jsx') && !resolved.endsWith('.tsx') && !resolved.endsWith('.css')) {
            resolved += '.js'; 
        }
        
        // インポート解決失敗時のフェイルファスト
        if (!silent && (relativePath.startsWith('.') || relativePath.startsWith('/'))) {
            const msg = `[Resolution Error] Module not found in VFS: "${relativePath}" (imported from "${basePath}").`;
            if (this.globalLogger) {
                this.globalLogger({ type: 'error', msg }); 
            }
            throw new Error(msg); // 警告ではなく即座に例外を投げてビルドプロセスを停止させる
        }

        return resolved;
    }
}
