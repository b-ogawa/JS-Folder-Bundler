import { VirtualFileSystem } from '../asset_extractor/VirtualFileSystem';
import { JsoncUtils } from './JsoncUtils';

export interface FilterOptions {
    includeNodeModules?: boolean;
    excludePatterns?: string[];
}

export class AssetFilter {
    private static DEFAULT_EXCLUDES = [
        '\\.config\\.',
        '\\.d\\.ts'
    ];

    /**
     * VFS（またはファイル一覧）とtsconfig.jsonの設定、およびオプションから、コンパイル除外パターンリストを取得する
     */
    private static getExcludeRegExps(vfs?: VirtualFileSystem | Map<string, string>, options?: FilterOptions): RegExp[] {
        const excludePatterns: string[] = [...this.DEFAULT_EXCLUDES];

        if (!options?.includeNodeModules) {
            excludePatterns.push('node_modules');
        }

        if (options?.excludePatterns) {
            excludePatterns.push(...options.excludePatterns);
        }

        if (vfs) {
            let tsconfigContent = '';
            if (vfs instanceof Map) {
                tsconfigContent = vfs.get('tsconfig.json') || vfs.get('/tsconfig.json') || '';
                if (!tsconfigContent) {
                    for (const [k, v] of vfs.entries()) {
                        if (k.endsWith('/tsconfig.json')) { tsconfigContent = v; break; }
                    }
                }
            } else if (vfs && typeof vfs.read === 'function') {
                tsconfigContent = vfs.read('tsconfig.json') || vfs.read('/tsconfig.json') || '';
                if (!tsconfigContent && typeof vfs.list === 'function') {
                    const tcPath = vfs.list().find((f: string) => f.endsWith('/tsconfig.json'));
                    if (tcPath) tsconfigContent = vfs.read(tcPath) || '';
                }
            }

            if (tsconfigContent) {
                try {
                    const config = JsoncUtils.parse(tsconfigContent);
                    if (config && Array.isArray(config.exclude)) {
                        config.exclude.forEach((pat: string) => {
                            const escaped = pat
                                .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                                .replace(/\*/g, '.*');
                            excludePatterns.push(escaped);
                        });
                    }
                } catch (e) {
                    console.warn('[AssetFilter] Failed to parse tsconfig.json for exclude patterns:', e);
                }
            }
        }

        const uniquePatterns = Array.from(new Set(excludePatterns));
        return uniquePatterns.map(pat => new RegExp(pat, 'i'));
    }

    /**
     * 与えられたファイルパスがコンパイル対象のJS/TS系アセット（js, ts, jsx, tsx）かどうかを判定する
     */
    static isTargetJS(filePath: string, vfs?: VirtualFileSystem | Map<string, string>, options?: FilterOptions): boolean {
        if (!/\.(js|ts|jsx|tsx)$/.test(filePath)) {
            return false;
        }

        const excludes = this.getExcludeRegExps(vfs, options);
        return !excludes.some(rx => rx.test(filePath));
    }

    /**
     * 与えられたファイルパスがコンパイル対象のHTMLアセットかどうかを判定する
     */
    static isTargetHTML(filePath: string, vfs?: VirtualFileSystem | Map<string, string>, options?: FilterOptions): boolean {
        if (!/\.html$/.test(filePath)) {
            return false;
        }

        const excludes = this.getExcludeRegExps(vfs, options);
        return !excludes.some(rx => rx.test(filePath));
    }
}

