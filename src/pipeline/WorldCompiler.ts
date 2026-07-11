import { VirtualFileSystem } from '../core/asset_extractor/VirtualFileSystem';
import { SourceAnalyzerFacade } from '../core/source_analyzer/SourceAnalyzerFacade';
import { IRLinker } from '../core/module_bundler/ir_linker/IRLinker';
import { IROptimizer } from '../core/iroptimizer/Orchestrator';
import { WorkerDetector } from '../core/module_bundler/dependency_extractor/WorkerDetector';
import { IRRoot, IRNode } from '../core/source_analyzer/ir_converter/ASTtoIRConverter';
import { IRtoASTConverter } from '../core/source_analyzer/ir_converter/IRtoASTConverter';
import { VariableMangler } from '../core/physical_compressor/VariableMangler';
import { DependencyExtractor } from '../core/module_bundler/dependency_extractor/DependencyExtractor';
import { PathResolver } from '../core/module_bundler/path_resolver/PathResolver';

export class WorldCompiler {
    private vfs: VirtualFileSystem;
    private config: any;
    private filterOptions: any;
    private logger: (log: { type: 'info' | 'success' | 'error'; msg: string }) => void;
    private compiledWorlds = new Map<string, string>();
    private externalImports = new Set<string>();
    private _blobIrCounter = 0;
    
    private parsedIRCache: IRRoot[] | null = null;

    constructor(
        vfs: VirtualFileSystem,
        config: any,
        filterOptions: any,
        logger: (log: { type: 'info' | 'success' | 'error'; msg: string }) => void
    ) {
        this.vfs = vfs;
        this.config = config;
        this.filterOptions = filterOptions;
        this.logger = logger;

        PathResolver.setLogger(logger);
    }

    public getExternalImports(): Set<string> {
        return this.externalImports;
    }

    private cloneIRTrees(trees: IRRoot[]): IRRoot[] {
        const cloneProps = (obj: any): any => {
            if (obj === null || typeof obj !== 'object') {
                return obj; 
            }
            if (Array.isArray(obj)) {
                return obj.map(cloneProps);
            }
            const cloned: Record<string, any> = {};
            for (const key of Object.keys(obj)) {
                cloned[key] = cloneProps(obj[key]);
            }
            return cloned;
        };

        return trees.map(tree => {
            const cloneNode = (node: IRNode): IRNode => ({
                ...node,
                props: cloneProps(node.props),
                children: node.children.map(cloneNode)
            });

            const clonedScopeInfo = {
                bindings: new Map(),
                scopes: new Map(),
                escapedVars: new Set(tree.scopeInfo.escapedVars),
                errors: [...tree.scopeInfo.errors]
            };

            for (const [k, v] of tree.scopeInfo.bindings) {
                clonedScopeInfo.bindings.set(k, { ...v, references: [...v.references] });
            }
            for (const [k, v] of tree.scopeInfo.scopes) {
                clonedScopeInfo.scopes.set(k, { ...v });
            }

            return {
                ...tree,
                props: cloneProps(tree.props),
                children: tree.children.map(cloneNode),
                scopeInfo: clonedScopeInfo
            };
        });
    }

    private createWorkerBlobIR(workerCode: string): IRNode {
        const genId = () => `ir_wblob_${(++this._blobIrCounter).toString(36)}`;
        
        const escapedRaw = workerCode
            .replace(/\\/g, '\\\\')
            .replace(/`/g, '\\`')
            .replace(/\$\{/g, '\\${');

        const tmplElement: IRNode = {
            type: 'TemplateElement',
            irNodeId: genId(),
            props: {
                value: { raw: escapedRaw, cooked: workerCode },
                tail: true
            },
            children: []
        };

        const tmplLiteral: IRNode = {
            type: 'TemplateLiteral',
            irNodeId: genId(),
            props: {
                quasis: [{ type: 'ref', irNodeId: tmplElement.irNodeId }],
                expressions: []
            },
            children: [tmplElement]
        };

        const arrNode: IRNode = { type: 'ArrayExpression', irNodeId: genId(), props: { elements: [{ type: 'ref', irNodeId: tmplLiteral.irNodeId }] }, children: [tmplLiteral] };
        
        const typeKey: IRNode = { type: 'Identifier', irNodeId: genId(), props: { name: 'type' }, children: [] };
        const typeVal: IRNode = { type: 'StringLiteral', irNodeId: genId(), props: { value: 'application/javascript' }, children: [] };
        const propNode: IRNode = { type: 'ObjectProperty', irNodeId: genId(), props: { key: { type: 'ref', irNodeId: typeKey.irNodeId }, value: { type: 'ref', irNodeId: typeVal.irNodeId }, computed: false, shorthand: false }, children: [typeKey, typeVal] };
        
        const objNode: IRNode = { type: 'ObjectExpression', irNodeId: genId(), props: { properties: [{ type: 'ref', irNodeId: propNode.irNodeId }] }, children: [propNode] };
        const blobIdent: IRNode = { type: 'Identifier', irNodeId: genId(), props: { name: 'Blob' }, children: [] };
        const newBlobNode: IRNode = { type: 'NewExpression', irNodeId: genId(), props: { callee: { type: 'ref', irNodeId: blobIdent.irNodeId }, arguments: [{ type: 'ref', irNodeId: arrNode.irNodeId }, { type: 'ref', irNodeId: objNode.irNodeId }] }, children: [blobIdent, arrNode, objNode] };
        
        const urlIdent: IRNode = { type: 'Identifier', irNodeId: genId(), props: { name: 'URL' }, children: [] };
        const createIdent: IRNode = { type: 'Identifier', irNodeId: genId(), props: { name: 'createObjectURL' }, children: [] };
        const memNode: IRNode = { type: 'MemberExpression', irNodeId: genId(), props: { object: { type: 'ref', irNodeId: urlIdent.irNodeId }, property: { type: 'ref', irNodeId: createIdent.irNodeId }, computed: false }, children: [urlIdent, createIdent] };
        
        const callNode: IRNode = { type: 'CallExpression', irNodeId: genId(), props: { callee: { type: 'ref', irNodeId: memNode.irNodeId }, arguments: [{ type: 'ref', irNodeId: newBlobNode.irNodeId }] }, children: [memNode, newBlobNode] };
        
        return callNode;
    }

    private replacePlaceholderInIR(node: IRNode, placeholder: string, replacementIR: IRNode): boolean {
        let replaced = false;
        if (!node.children) return false;

        for (let i = 0; i < node.children.length; i++) {
            const child = node.children[i];
            if (child.type === 'StringLiteral' && child.props['value'] === placeholder) {
                node.children[i] = replacementIR;
                replaced = true;
                
                for (const key of Object.keys(node.props)) {
                    const prop = node.props[key];
                    if (prop && prop.type === 'ref' && prop.irNodeId === child.irNodeId) {
                        node.props[key] = { type: 'ref', irNodeId: replacementIR.irNodeId };
                    } else if (Array.isArray(prop)) {
                        for (let j = 0; j < prop.length; j++) {
                            if (prop[j] && prop[j].type === 'ref' && prop[j].irNodeId === child.irNodeId) {
                                prop[j] = { type: 'ref', irNodeId: replacementIR.irNodeId };
                            }
                        }
                    }
                }
            } else {
                if (this.replacePlaceholderInIR(child, placeholder, replacementIR)) {
                    replaced = true;
                }
            }
        }
        return replaced;
    }

    private resolveCDNUrl(modulePath: string, isWorker: boolean = false): string {
        if (/^(https?:)?\/\//i.test(modulePath)) return modulePath;

        let packageJson: any = null;
        try {
            const pjContent = this.vfs.read('package.json');
            if (pjContent) packageJson = JSON.parse(pjContent);
        } catch (err) {}

        let basePackage = modulePath;
        let subpath = '';
        if (modulePath.startsWith('@')) {
            const parts = modulePath.split('/');
            if (parts.length > 2) {
                basePackage = parts.slice(0, 2).join('/');
                subpath = parts.slice(2).join('/');
            } else {
                basePackage = modulePath;
            }
        } else {
            const parts = modulePath.split('/');
            if (parts.length > 1) {
                basePackage = parts[0];
                subpath = parts.slice(1).join('/');
            }
        }

        let version = '';
        if (packageJson?.dependencies?.[basePackage]) {
            version = packageJson.dependencies[basePackage];
        } else if (packageJson?.devDependencies?.[basePackage]) {
            version = packageJson.devDependencies[basePackage];
        }
        if (version) version = version.replace(/^[\^~]/, '');

        let targetUrl = this.config.cdnTemplate || 'https://esm.sh/[module]@[version]/[path]';
        targetUrl = targetUrl.replace('[module]', basePackage);
        if (version) targetUrl = targetUrl.replace('[version]', version);
        else targetUrl = targetUrl.replace('@[version]', '').replace('[version]', '');
        
        if (subpath) targetUrl = targetUrl.replace('[path]', subpath);
        else targetUrl = targetUrl.replace('/[path]', '').replace('[path]', '');

        return targetUrl;
    }

    private extractAndResolveExternalImports(node: IRNode, isWorker: boolean) {
        if (!node) return;
        
        let pathValueNode: IRNode | null = null;

        if (node.type === 'ImportDeclaration' || node.type === 'ImportExpression') {
            const sourceRef = node.props?.['source'];
            if (sourceRef && sourceRef.type === 'ref') {
                pathValueNode = node.children?.find((c: any) => c.irNodeId === sourceRef.irNodeId) || null;
            }
        } else if (node.type === 'CallExpression') {
            const calleeRef = node.props?.['callee'];
            if (calleeRef && calleeRef.type === 'ref') {
                const calleeNode = node.children?.find((c: any) => c.irNodeId === calleeRef.irNodeId);
                if (calleeNode && (calleeNode.type === 'Import' || (calleeNode.type === 'Identifier' && calleeNode.props['name'] === 'importScripts'))) {
                    const args = node.props['arguments'] || [];
                    for (const argRef of args) {
                         if (argRef && argRef.type === 'ref') {
                             const argNode = node.children?.find((c: any) => c.irNodeId === argRef.irNodeId);
                             if (argNode && (argNode.type === 'StringLiteral' || argNode.type === 'Literal')) {
                                 const val = argNode.props['value'];
                                 if (val && typeof val === 'string') {
                                     if (!val.startsWith('.') && !val.startsWith('/')) {
                                         this.externalImports.add(val);
                                         if (isWorker || argNode.props['_isWorkerImport']) {
                                             argNode.props['value'] = this.resolveCDNUrl(val, true);
                                         }
                                     }
                                 }
                             }
                         }
                    }
                }
            }
        }

        if (pathValueNode && (pathValueNode.type === 'StringLiteral' || pathValueNode.type === 'Literal')) {
            const val = pathValueNode.props['value'];
            if (val && typeof val === 'string') {
                if (!val.startsWith('.') && !val.startsWith('/')) {
                    this.externalImports.add(val);
                    if (isWorker || pathValueNode.props['_isWorkerImport']) {
                        pathValueNode.props['value'] = this.resolveCDNUrl(val, true);
                    }
                }
            }
        }

        if (node.children) {
            for (const child of node.children) {
                this.extractAndResolveExternalImports(child, isWorker);
            }
        }
    }

    public async compile(entryPaths: string | string[], isWorker: boolean = false): Promise<string> {
        const baseKey = Array.isArray(entryPaths) ? entryPaths.join(',') : entryPaths;
        const cacheKey = `${baseKey}_${isWorker ? 'worker' : 'main'}`;
        
        if (this.compiledWorlds.has(cacheKey)) {
            return this.compiledWorlds.get(cacheKey)!;
        }

        this.logger({ type: 'info', msg: `Compiling world entry: ${cacheKey}...` });

        if (!this.parsedIRCache) {
            this.parsedIRCache = SourceAnalyzerFacade.analyzeAll(this.vfs, this.filterOptions);
        }
        
        const irTreesForPrep = this.cloneIRTrees(this.parsedIRCache);
        let existingFiles = irTreesForPrep.map(t => t.filePath);
        if (this.vfs && typeof this.vfs.list === 'function') {
            existingFiles = Array.from(new Set([...existingFiles, ...this.vfs.list()]));
        }

        const paths = Array.isArray(entryPaths) ? entryPaths : [entryPaths];
        for (const p of paths) {
            const entryTree = irTreesForPrep.find(t => t.filePath === p);
            if (!entryTree) {
                throw new Error(`Entry file ${p} was not found in the parsed AST roots.`);
            }
        }

        this.logger({ type: 'info', msg: `[World Debug] Worker config.golfEnabled is: ${this.config.golfEnabled}` });

        const parseTemplate = (templateCode: string): IRNode[] => {
            try {
                const ir = SourceAnalyzerFacade.analyzeToIR(templateCode, '_boilerplate_template.js', this.vfs);
                const programNode = ir.children[0]?.children?.find(c => c.type === 'Program');
                return programNode?.children || [];
            } catch (err: any) {
                this.logger({ type: 'error', msg: `[TemplateParser] Failed to parse AST template: ${err.message}` });
                return [];
            }
        };

        this.logger({ type: 'info', msg: `Scanning all files for Worker dependencies...` });
        const workerPathsSet = new Set<string>();
        
        // 解析済みASTファイルを走査しWorker依存を静的に抽出
        for (const tree of irTreesForPrep) {
            const rawPaths = WorkerDetector.extractRawWorkerPaths(tree, this.logger);
            for (const p of rawPaths) {
                try {
                    // ファイルパスを起点に相対パスを解決
                    const resolved = PathResolver.resolve(tree.filePath, p, existingFiles, true);
                    const base = resolved.replace(/\.(js|ts|jsx|tsx)$/, '');
                    const exists = existingFiles.some(f => f.replace(/\.(js|ts|jsx|tsx)$/, '') === base);
                    
                    if (exists) {
                        if (!workerPathsSet.has(resolved)) {
                            workerPathsSet.add(resolved);
                            this.logger({ type: 'success', msg: `[Dependency Discovery] Found Worker entry: "${resolved}" (from ${tree.filePath})` });
                        }
                    } else {
                        this.logger({ type: 'info', msg: `[WorldCompiler] Candidate worker path "${p}" (resolved to "${resolved}") is not a file in the workspace. Skipping.` });
                    }
                } catch (e) {
                    // パス解決エラーは無視
                }
            }
        }
        
        const workerPaths = Array.from(workerPathsSet);

        // プレリンク処理の廃止

        if (workerPaths.length > 0) {
            this.logger({ type: 'info', msg: `Found ${workerPaths.length} multi-threaded entry-points: ${workerPaths.join(', ')}` });
        }

        this.logger({ type: 'info', msg: `Executing unified multi-thread link pipeline for ${cacheKey}` });
        const irTrees = this.cloneIRTrees(this.parsedIRCache);
        
        // 抽出されたWorkerパスを渡してリンクを実行
        const linkedIR = IRLinker.link(irTrees, this.vfs, entryPaths, workerPaths.length > 0 ? workerPaths : undefined, this.logger, this.config.bundleId, parseTemplate);

        let optimizedIR = linkedIR;
        if (this.config.golfEnabled) {
            this.logger({ type: 'info', msg: `Optimizing AST (Golf) for ${cacheKey}` });

            const evaluatePureFunction = (funcNode: IRNode, args: any[]) => {
                const Babel = (globalThis as any).Babel;
                if (!Babel) throw new Error("Babel not available");
                const ast = IRtoASTConverter.convert(funcNode);
                const { code: funcCode } = Babel.transformFromAst({ type: 'Program', body: [ast] }, '', { presets: [], ast: false });
                
                const argStrings = args.map(arg => typeof arg === 'string' ? JSON.stringify(arg) : String(arg));
                const iifeCode = `return (${funcCode})(${argStrings.join(', ')});`;
                return new Function(iifeCode)();
            };

            const optimizerConfig = {
                ...this.config,
                services: { evaluatePureFunction }
            };

            optimizedIR = IROptimizer.optimize(linkedIR, optimizerConfig);
        } else {
            this.logger({ type: 'info', msg: 'Skipping AST Optimization (golfEnabled is false)' });
        }

        this.extractAndResolveExternalImports(optimizedIR, isWorker);

        let jsCode = SourceAnalyzerFacade.generateFromIR(optimizedIR);

        this.compiledWorlds.set(cacheKey, jsCode);
        return jsCode;
    }
}