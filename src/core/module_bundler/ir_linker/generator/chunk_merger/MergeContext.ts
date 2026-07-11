import { IRRoot, IRNode, IRScopeInfo } from '../../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { ModuleInfo } from '../../types';

export class MergeContext {
    // 1. 静的なインプット
    public irTrees: IRRoot[];
    public modules: Map<string, ModuleInfo>;
    public entryBasePaths: Set<string>;
    public isExternalModule: (sourcePath: string, currentFilePath: string) => boolean;
    public getBase: (p: string) => string;
    public refToDeclMaps: Map<string, Map<string, string>>;
    public resolvePath: (sourceFilePath: string, rawPath: string) => string;
    public isAsset: (resolvedPath: string) => boolean;
    public fileExists: (resolvedPath: string) => boolean;
    public parseTemplate: (code: string) => IRNode[];
    public reachabilityMap: Map<string, Set<string>> | undefined;
    public workerEntryBases: Set<string> | undefined;
    public bundleId: string | undefined;
    public logger: ((log: { type: 'info' | 'success' | 'error'; msg: string }) => void) | undefined;

    // 2. パイプライン中に蓄積される状態
    public currentFilePath = '';
    public deterministicCounter = 0;
    public allTopLevelDecls = new Map<string, { varName: string; declId: string; filePath: string }>();
    public dynamicImportedBases = new Set<string>();
    public chunkIdMap = new Map<string, string>();
    public extImportAdoptedDecls = new Map<string, { defaultDeclId?: string; namespaceDeclId?: string; namedDeclIds: Map<string, string> }>();
    public extImportRedirects = new Map<string, string>();
    public renameJobs = new Map<string, string>();
    public globalVariables = new Set<string>();
    public thunkDeclIdMap = new Map<string, string>();
    public nodeReplacements = new Map<string, IRNode>();

    // 3. ボイラープレート生成用の制御情報
    public spawnFuncName = '';
    public chunkUrlFuncName = '';
    public needsSpawnBoilerplate = false;
    public needsChunkUrlBoilerplate = false;

    // 4. 仕分け済みステートメントの格納バッファ
    public globalExternalImports: IRNode[] = [];
    public commonStatements: IRNode[] = [];
    public mainStatements: IRNode[] = [];
    public workerStatementsMap = new Map<string, IRNode[]>();

    // 5. 最終的な出力結果
    public linkedRoot!: IRRoot;
    public mergedScopeInfo!: IRScopeInfo;

    constructor(
        irTrees: IRRoot[],
        modules: Map<string, ModuleInfo>,
        entryBasePaths: Set<string>,
        isExternalModule: (sourcePath: string, currentFilePath: string) => boolean,
        getBase: (p: string) => string,
        refToDeclMaps: Map<string, Map<string, string>>,
        resolvePath: (sourceFilePath: string, rawPath: string) => string,
        isAsset: (resolvedPath: string) => boolean,
        fileExists: (resolvedPath: string) => boolean,
        parseTemplate: (code: string) => IRNode[],
        reachabilityMap: Map<string, Set<string>> | undefined,
        workerEntryBases: Set<string> | undefined,
        bundleId: string | undefined,
        logger: ((log: { type: 'info' | 'success' | 'error'; msg: string }) => void) | undefined
    ) {
        this.irTrees = irTrees;
        this.modules = modules;
        this.entryBasePaths = entryBasePaths;
        this.isExternalModule = isExternalModule;
        this.getBase = getBase;
        this.refToDeclMaps = refToDeclMaps;
        this.resolvePath = resolvePath;
        this.isAsset = isAsset;
        this.fileExists = fileExists;
        this.parseTemplate = parseTemplate;
        this.reachabilityMap = reachabilityMap;
        this.workerEntryBases = workerEntryBases;
        this.bundleId = bundleId;
        this.logger = logger;

        // workerEntryBasesが存在する場合、初期化処理を行う
        if (this.workerEntryBases) {
            for (const wBase of this.workerEntryBases) {
                this.getSafeChunkId(wBase);
            }
        }
    }

    public getDeterministicId(prefix = 'ir_id'): string {
        return `${prefix}_${(++this.deterministicCounter).toString(36)}`;
    }

    public getSafeChunkId(base: string): string {
        if (!this.chunkIdMap.has(base)) {
            this.chunkIdMap.set(base, `chunk_${base.replace(/[^a-zA-Z0-9]/g, '_')}_${this.chunkIdMap.size}`);
        }
        return this.chunkIdMap.get(base)!;
    }
}
