import { ModuleInfo, StatementInfo } from '../types';
import { PathResolver } from '../../path_resolver/PathResolver';

export class ReachabilityTracer {
    /**
     * 識別子レベルで到達可能性のトレースを行い、各ノードがどのエントリーポイント(Main / Worker)から
     * 到達可能であるかを示す「到達元シグネチャ」を計算します。
     * 戻り値として、ノードIDごとの到達元セット (Map<string, Set<string>>) を返します。
     */
    public static trace(
        modules: Map<string, ModuleInfo>,
        isExternalModule: (sourcePath: string, currentFilePath: string) => boolean,
        getBase: (p: string) => string,
        existingFiles: string[],
        mainEntryBases: Set<string>,
        workerEntryBases: Set<string>,
        logger?: (log: { type: 'info'; msg: string }) => void
    ): Map<string, Set<string>> {
        const nodeReachability = new Map<string, Set<string>>();
        const queue: { id: string; origin: string }[] = [];

        const addToQueue = (id: string, origin: string) => {
            let s = nodeReachability.get(id);
            if (!s) {
                s = new Set<string>();
                nodeReachability.set(id, s);
            }
            if (!s.has(origin)) {
                s.add(origin);
                queue.push({ id, origin });
            }
        };

        // 補助関数：特定の declId が定義されているモジュールと StatementInfo を探索
        const findDeclarationAndModule = (declId: string): { module: ModuleInfo; stmt: StatementInfo } | null => {
            for (const mod of modules.values()) {
                for (const stmt of mod.statements.values()) {
                    if (stmt.defines.has(declId)) {
                        return { module: mod, stmt };
                    }
                }
            }
            return null;
        };

        // 補助関数：到達したモジュールの副作用文（SideEffect）をキューに追加
        const visitedModulesForOrigin = new Map<string, Set<string>>();
        const activateModuleSideEffects = (mod: ModuleInfo, origin: string) => {
            let visited = visitedModulesForOrigin.get(origin);
            if (!visited) {
                visited = new Set<string>();
                visitedModulesForOrigin.set(origin, visited);
            }
            if (visited.has(mod.basePath)) return;
            visited.add(mod.basePath);

            for (const stmt of mod.statements.values()) {
                if (stmt.type === 'SideEffect') {
                    addToQueue(stmt.irNodeId, origin);
                }
            }
        };

        // 1. エントリーモジュールを起点に初期キューを構築
        for (const mod of modules.values()) {
            const isMainEntry = mainEntryBases.has(mod.basePath) || mainEntryBases.has(mod.basePath + '/index');
            const isWorkerEntry = workerEntryBases.has(mod.basePath) || workerEntryBases.has(mod.basePath + '/index');

            if (isMainEntry) {
                const origin = 'main';
                if (logger) logger({ type: 'info', msg: `[Reachability] Setting origin [${origin}] for entry module: ${mod.basePath}` });
                activateModuleSideEffects(mod, origin);

                // 公開 API の実体 ID
                for (const declId of mod.exports.values()) {
                    addToQueue(declId, origin);
                }

                // 副作用文とエントリーのトップレベル宣言を保護
                for (const stmt of mod.statements.values()) {
                    if (stmt.type === 'SideEffect') {
                        addToQueue(stmt.irNodeId, origin);
                    }
                    
                    // HTMLから読み込まれた外部スクリプトやインラインスクリプトは、
                    // 互いにグローバル空間で変数を共有する「クラシックスクリプト」の可能性が高いため、
                    // エントリーとして指定されたモジュールのトップレベル宣言は安全のためすべて保護する。
                    if (stmt.type === 'Declaration') {
                        addToQueue(stmt.irNodeId, origin);
                    }
                }
            }

            if (isWorkerEntry) {
                const origin = mod.basePath;
                if (logger) logger({ type: 'info', msg: `[Reachability] Setting origin [${origin}] for entry module: ${mod.basePath}` });
                activateModuleSideEffects(mod, origin);

                // 公開 API の実体 ID
                for (const declId of mod.exports.values()) {
                    addToQueue(declId, origin);
                }

                // 副作用文とトップレベル宣言の保護
                for (const stmt of mod.statements.values()) {
                    if (stmt.type === 'SideEffect') {
                        addToQueue(stmt.irNodeId, origin);
                    }

                    // Worker自身のエントリーのトップレベル宣言も保護（イベントリスナー等から参照されるため）
                    if (stmt.type === 'Declaration') {
                        addToQueue(stmt.irNodeId, origin);
                    }
                }
            }
        }

        if (logger) logger({ type: 'info', msg: `[Reachability] Initial queue size: ${queue.length}` });

        // 2. トレースの実行
        while (queue.length > 0) {
            const { id: currentId, origin } = queue.shift()!;

            // A. StatementInfo の ID である場合
            let isStatement = false;
            for (const mod of modules.values()) {
                const stmt = mod.statements.get(currentId);
                if (stmt) {
                    isStatement = true;
                    // ステートメント自体の到達をマーク
                    addToQueue(currentId, origin);
                    activateModuleSideEffects(mod, origin);

                    // 参照している識別子の定義元を追跡
                    for (const refDeclId of stmt.references) {
                        addToQueue(refDeclId, origin);
                    }

                    // 副作用インポート（import './style.css'等）
                    if (stmt.sideEffectImportPath) {
                        if (!isExternalModule(stmt.sideEffectImportPath, mod.filePath)) {
                            const resolvedSourcePath = PathResolver.resolve(mod.filePath, stmt.sideEffectImportPath, existingFiles);
                            const sourceBase = getBase(resolvedSourcePath);
                            const sourceModule = modules.get(sourceBase) || modules.get(sourceBase + '/index');
                            if (sourceModule) {
                                activateModuleSideEffects(sourceModule, origin);
                            }
                        }
                    }

                    // クラシックスクリプト（importScripts 等）の依存モジュールへの伝播
                    if (stmt.classicImports) {
                        for (const importPath of stmt.classicImports) {
                            if (!isExternalModule(importPath, mod.filePath)) {
                                const resolvedSourcePath = PathResolver.resolve(mod.filePath, importPath, existingFiles);
                                const sourceBase = getBase(resolvedSourcePath);
                                const sourceModule = modules.get(sourceBase) || modules.get(sourceBase + '/index');
                                if (sourceModule) {
                                    activateModuleSideEffects(sourceModule, origin);
                                    // クラシックスクリプトとしての読み込みなので、トップレベル宣言もすべて保護する
                                    for (const s of sourceModule.statements.values()) {
                                        if (s.type === 'Declaration') {
                                            addToQueue(s.irNodeId, origin);
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // 動的インポート（import()）の依存モジュールへの伝播（DAGリンク）
                    if (stmt.dynamicImports) {
                        for (const importPath of stmt.dynamicImports) {
                            if (!isExternalModule(importPath, mod.filePath)) {
                                const resolvedSourcePath = PathResolver.resolve(mod.filePath, importPath, existingFiles);
                                const sourceBase = getBase(resolvedSourcePath);
                                const sourceModule = modules.get(sourceBase) || modules.get(sourceBase + '/index');
                                if (sourceModule) {
                                    activateModuleSideEffects(sourceModule, origin);
                                    // 動的インポートは実行時に全ての公開APIへのアクセスを許可するため、全エクスポートを強制保護する
                                    for (const expDeclId of sourceModule.exports.values()) {
                                        addToQueue(expDeclId, origin);
                                    }
                                }
                            }
                        }
                    }
                    break;
                }
            }

            if (isStatement) continue;

            // B. 識別子定義 ID（declId）である場合
            
            let isImported = false;
            
            // 1. まず他モジュールからのインポートであるかを優先して判定
            for (const mod of modules.values()) {
                const impInfo = mod.imports.get(currentId);
                if (impInfo) {
                    isImported = true;
                    
                    // 外部インポート参照のトレース記録
                    if (logger && isExternalModule(impInfo.sourcePath, mod.filePath)) {
                        logger({ type: 'info', msg: `[Reachability] Tracing external import "${impInfo.sourcePath}" (Identifier ID: ${currentId}) from origin: ${origin}` });
                    }

                    activateModuleSideEffects(mod, origin);

                    //「インポート変数自身」の到達マークを追加
                    addToQueue(currentId, origin);

                    // 内部・外部に関わらず、このインポート宣言ノード自体をマークする
                    for (const stmt of mod.statements.values()) {
                        if (stmt.node.type === 'ImportDeclaration') {
                            const specifiers = stmt.node.props.specifiers || [];
                            const hasSpecifier = specifiers.some((sRef: any) => {
                                const sNode = stmt.node.children.find(c => c.irNodeId === sRef.irNodeId);
                                if (sNode && sNode.props.local && sNode.props.local.type === 'ref') {
                                    return sNode.props.local.irNodeId === currentId;
                                }
                                return false;
                            });
                            if (hasSpecifier) {
                                addToQueue(stmt.irNodeId, origin);
                            }
                        }
                    }

                    if (isExternalModule(impInfo.sourcePath, mod.filePath)) {
                        continue;
                    }

                    // 内部モジュールのインポート解決
                    const resolvedSourcePath = PathResolver.resolve(mod.filePath, impInfo.sourcePath, existingFiles);
                    const sourceBase = getBase(resolvedSourcePath);
                    const sourceModule = modules.get(sourceBase) || modules.get(sourceBase + '/index');

                    if (sourceModule) {
                        activateModuleSideEffects(sourceModule, origin);

                        if (impInfo.importedName === '*') {
                            // Namespace インポートは安全のためモジュール全体の全エクスポートをトレース
                            for (const expDeclId of sourceModule.exports.values()) {
                                addToQueue(expDeclId, origin);
                            }
                        } else {
                            const targetDeclId = sourceModule.exports.get(impInfo.importedName);
                            if (targetDeclId) {
                                addToQueue(targetDeclId, origin);
                            }
                        }
                    }
                    break;
                }
            }

            // 2. インポートでなければ、ローカルの定義文としてキューに投入
            if (!isImported) {
                const localDecl = findDeclarationAndModule(currentId);
                if (localDecl) {
                    activateModuleSideEffects(localDecl.module, origin);
                    addToQueue(localDecl.stmt.irNodeId, origin);
                }
            }
        }

        if (logger) logger({ type: 'info', msg: `[Reachability] Trace complete. Marked AST nodes: ${nodeReachability.size}` });
        return nodeReachability;
    }
}
