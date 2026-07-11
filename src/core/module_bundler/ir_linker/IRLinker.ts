import { IRRoot, IRNode } from '../../source_analyzer/ir_converter/ASTtoIRConverter';
import { DependencyExtractor } from '../dependency_extractor/DependencyExtractor';
import { PathResolver } from '../path_resolver/PathResolver';
import { ScopeResolver } from '../../source_analyzer/scope_analyzer/ScopeResolver';
import { AssetFilter } from '../../utils/AssetFilter';

import { ModuleGraphBuilder } from './graph/ModuleGraphBuilder';
import { TopLevelAnalyzer } from './graph/TopLevelAnalyzer';
import { ReachabilityTracer } from './analyzer/ReachabilityTracer';
import { TreePruner } from './generator/TreePruner';
import { ChunkMerger } from './generator/ChunkMerger';

export class IRLinker {
    /**
     * トポロジカルソート、グラフ構築、デッドコード除去（Tree Shaking）を行い、複数の IRRoot を 1 つのバンドルに統合します。
     */
    public static link(
        irTrees: IRRoot[],
        vfs?: any,
        entryPaths?: string | string[],
        workerPaths?: string[],
        logger?: (log: { type: 'info' | 'success' | 'error'; msg: string }) => void,
        bundleId?: string,
        parseTemplate?: (code: string) => IRNode[]
    ): IRRoot {
        if (!parseTemplate) {
            throw new Error("[Linker] 'parseTemplate' function is strictly required for AST Template Injection.");
        }

        const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        let phaseTime = startTime;
        const logPhase = (phaseName: string) => {
            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
            if (logger) logger({ type: 'info', msg: `[Linker] ⏱️ ${phaseName} completed in ${(now - phaseTime).toFixed(2)}ms` });
            phaseTime = now;
        };

        const getBase = (p: string) => p.replace(/\.(js|ts|jsx|tsx)$/, '');
        let existingFiles = irTrees.map(t => t.filePath);
        if (vfs && typeof vfs.list === 'function') {
            existingFiles = Array.from(new Set([...existingFiles, ...vfs.list()]));
        }

        if (logger) logger({ type: 'info', msg: `[Linker] Starting Link Process. Total parsed files: ${irTrees.length}` });

        // 1. チャンク境界（Workerなど）の事前抽出とスコープ解決
        const allChunkResolvedPaths = new Set<string>();
        const refToDeclMaps = new Map<string, Map<string, string>>();

        for (const tree of irTrees) {
            const refToDeclMap = ScopeResolver.resolve(tree);
            refToDeclMaps.set(tree.filePath, refToDeclMap);

            // 匿名 default export の正規化を事前実行
            TopLevelAnalyzer.normalizeAnonymousExports(tree, getBase);
            const statements = TopLevelAnalyzer.analyze(tree, refToDeclMap);
            for (const stmt of statements.values()) {
                if (stmt.chunkReferences) {
                    for (const refPath of stmt.chunkReferences) {
                        const resolved = PathResolver.resolve(tree.filePath, refPath, existingFiles, true);
                        allChunkResolvedPaths.add(getBase(resolved));
                    }
                }
            }
        }

        const entryBasePaths = new Set<string>();
        if (entryPaths) {
            const paths = Array.isArray(entryPaths) ? entryPaths : [entryPaths];
            for (const p of paths) {
                entryBasePaths.add(getBase(p));
            }
        } else {
            for (const tree of irTrees) {
                entryBasePaths.add(getBase(tree.filePath));
            }
        }

        const workerBasePaths = new Set<string>();
        if (workerPaths) {
            for (const p of workerPaths) {
                workerBasePaths.add(getBase(p));
            }
        }

        logPhase("Scope Resolution & Chunk Discovery");



        // 2. トポロジカルソートの実行
        const adjList = new Map<string, string[]>();
        for (const tree of irTrees) {
            const deps = DependencyExtractor.extract(tree);
            const resolvedDeps = deps
                .map(d => getBase(PathResolver.resolve(tree.filePath, d, existingFiles)))
                .filter(base => {
                    // チャンク境界ファイル（かつ自身のエントリーポイントでなく、統合対象のWorkerでもない）は依存先から除外
                    if (allChunkResolvedPaths.has(base) && !entryBasePaths.has(base) && !workerBasePaths.has(base)) {
                        return false;
                    }
                    return true;
                });
            adjList.set(getBase(tree.filePath), resolvedDeps);
        }

        const sortedTrees: IRRoot[] = [];
        const visited = new Set<string>();
        const visiting = new Set<string>();

        const visit = (filePath: string) => {
            const base = getBase(filePath);
            if (visited.has(base)) return;
            if (visiting.has(base)) {
                if (logger) {
                    logger({
                        type: 'error',
                        msg: `[Linker Warning] Cyclic dependency detected involving: "${base}". This may cause runtime initialization issues.`
                    });
                }
                return;
            }
            visiting.add(base);
            const deps = adjList.get(base) || [];
            for (const dep of deps) {
                let depTree = irTrees.find(t => getBase(t.filePath) === dep) || irTrees.find(t => getBase(t.filePath) === dep + '/index');
                if (depTree) visit(depTree.filePath);
            }
            visiting.delete(base);
            visited.add(base);
            const tree = irTrees.find(t => getBase(t.filePath) === base);
            if (tree) sortedTrees.push(tree);
        };

        // メインエントリーとWorkerの両方を起点にトポロジカルソートを実行
        const allStartPaths = [...(Array.isArray(entryPaths) ? entryPaths : entryPaths ? [entryPaths] : []), ...(workerPaths || [])];
        if (allStartPaths.length > 0) {
            for (const p of allStartPaths) {
                visit(p);
            }
        } else {
            for (const tree of irTrees) {
                visit(tree.filePath);
            }
        }

        if (logger) {
            logger({
                type: 'info',
                msg: `[Linker] Topological sort complete. Total modules to bundle: ${sortedTrees.length}. Entries: [${Array.from(entryBasePaths).join(', ')}], Workers: [${Array.from(workerBasePaths).join(', ')}]`
            });
            logger({
                type: 'info',
                msg: `[Linker] Order of bundling: ${sortedTrees.map(t => getBase(t.filePath)).join(' -> ')}`
            });
        }
        irTrees = sortedTrees;

        logPhase("Topological Sorting");

        const isExternalModule = (sourcePath: string, currentFilePath: string) => {
            const resolvedPath = PathResolver.resolve(currentFilePath, sourcePath, existingFiles);
            const base = getBase(resolvedPath);

            // チャンク境界であっても統合対象のWorkerであれば外部扱いしない
            if (allChunkResolvedPaths.has(base) && !entryBasePaths.has(base) && !workerBasePaths.has(base)) {
                return true;
            }

            return !irTrees.some(t => getBase(t.filePath) === base || getBase(t.filePath) === base + '/index');
        };

        // 3. モジュール依存関係のグラフ化 (ModuleGraphBuilder)
        const modules = ModuleGraphBuilder.build(
            irTrees,
            entryBasePaths,
            isExternalModule,
            getBase,
            existingFiles,
            refToDeclMaps
        );

        if (logger) {
            for (const [modName, modInfo] of modules.entries()) {
                let decls = 0, sides = 0;
                modInfo.statements.forEach(s => s.type === 'Declaration' ? decls++ : sides++);
                logger({ type: 'info', msg: `[ModuleGraph] ${modName}: ${decls} Declarations, ${sides} SideEffects, ${modInfo.exports.size} Exports` });
            }
        }

        logPhase("Module Graph Building");

        // 4. 識別子レベルでの到達可能性解析 (ReachabilityTracer) - Signature型
        const reachabilityMap = ReachabilityTracer.trace(
            modules,
            isExternalModule,
            getBase,
            existingFiles,
            entryBasePaths,
            workerBasePaths,
            logger
        );

        const markedNodeIds = new Set<string>(reachabilityMap.keys());

        logPhase("Reachability Analysis (DFA)");

        // 5. デッドコード（到達不能ノード）の剪定 (TreePruner)
        TreePruner.prune(modules, markedNodeIds, logger);

        logPhase("Tree Shaking (Pruning)");

        // 6. 剪定済み AST の結合 (ChunkMerger)
        const linkedRoot = ChunkMerger.merge(
            irTrees,
            modules,
            entryBasePaths,
            isExternalModule,
            getBase,
            refToDeclMaps,
            (source, raw) => PathResolver.resolve(source, raw, existingFiles),
            (resolvedPath) => {
                // 拡張子を持たないベアモジュール（例: "react", "three"）はアセットではない
                const extMatch = resolvedPath.match(/\.([a-zA-Z0-9]+)$/);
                if (!extMatch) return false;

                // 拡張子がある場合は、JS/TS系以外をアセットとして扱う
                return !AssetFilter.isTargetJS(resolvedPath, vfs);
            },
            (resolvedPath) => vfs && typeof vfs.read === 'function' && vfs.read(resolvedPath) !== undefined,
            parseTemplate,
            reachabilityMap,
            workerBasePaths,
            bundleId,
            logger
        );

        logPhase("AST Chunk Merging & Injection");

        const totalDuration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
        if (logger) logger({ type: 'info', msg: `[Linker] 🏁 Merged AST generated successfully. Total link time: ${totalDuration.toFixed(2)}ms` });
        return linkedRoot;
    }
}