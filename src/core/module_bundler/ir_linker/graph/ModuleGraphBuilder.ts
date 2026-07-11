import { IRRoot, IRNode } from '../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { ModuleInfo, ImportInfo } from '../types';
import { TopLevelAnalyzer } from './TopLevelAnalyzer';
import { PathResolver } from '../../path_resolver/PathResolver';

export class ModuleGraphBuilder {
    /**
     * IRRoot[] からモジュール間の依存構造（ModuleInfo の Map）を構築します。
     */
    public static build(
        irTrees: IRRoot[],
        entryPaths: Set<string>,
        isExternalModule: (sourcePath: string, currentFilePath: string) => boolean,
        getBase: (p: string) => string,
        existingFiles: string[],
        refToDeclMaps: Map<string, Map<string, string>>
    ): Map<string, ModuleInfo> {
        const modules = new Map<string, ModuleInfo>();
        const exportsMap = new Map<string, Map<string, string>>();

        // 1. 各モジュールの初期化と匿名 export default の正規化
        for (const tree of irTrees) {
            const basePath = getBase(tree.filePath);
            TopLevelAnalyzer.normalizeAnonymousExports(tree, getBase);
            exportsMap.set(basePath, new Map<string, string>());
        }

        // 2. トポロジカルソート順に従い、再エクスポート関係を解決しながら exportsMap を作成
        for (const tree of irTrees) {
            const moduleBase = getBase(tree.filePath);
            const fileExports = exportsMap.get(moduleBase)!;

            const fileProgram = tree.children[0]?.children?.find(c => c.type === 'Program');
            if (!fileProgram) continue;

            const bodyRefs = fileProgram.props['body'];
            if (!Array.isArray(bodyRefs)) continue;

            for (const ref of bodyRefs) {
                if (!ref || ref.type !== 'ref') continue;
                const child = fileProgram.children.find(c => c.irNodeId === ref.irNodeId);
                if (!child) continue;

                if (child.type === 'ExportNamedDeclaration') {
                    const sourceRef = child.props['source'];
                    let fromExports: Map<string, string> | undefined;
                    if (sourceRef && sourceRef.type === 'ref') {
                        const sourceNode = child.children.find(c => c.irNodeId === sourceRef.irNodeId);
                        if (sourceNode && !isExternalModule(sourceNode.props['value'], tree.filePath)) {
                            const fromBase = getBase(PathResolver.resolve(tree.filePath, sourceNode.props['value'], existingFiles));
                            fromExports = exportsMap.get(fromBase) || exportsMap.get(fromBase + '/index');
                        }
                    }

                    const declRef = child.props['declaration'];
                    if (declRef && declRef.type === 'ref') {
                        const declNode = child.children.find(c => c.irNodeId === declRef.irNodeId);
                        if (declNode) {
                            if (declNode.type === 'VariableDeclaration') {
                                for (const decltorRef of declNode.props.declarations || []) {
                                    if (decltorRef && decltorRef.type === 'ref') {
                                        const decltorNode = declNode.children.find(c => c.irNodeId === decltorRef.irNodeId);
                                        if (decltorNode && decltorNode.props.id && decltorNode.props.id.type === 'ref') {
                                            const idNode = decltorNode.children.find(c => c.irNodeId === decltorNode.props.id.irNodeId);
                                            if (idNode && idNode.type === 'Identifier') {
                                                fileExports.set(idNode.props.name as string, idNode.irNodeId);
                                            }
                                        }
                                    }
                                }
                            } else if (declNode.type === 'FunctionDeclaration' || declNode.type === 'ClassDeclaration') {
                                if (declNode.props.id && declNode.props.id.type === 'ref') {
                                    const idNode = declNode.children.find(c => c.irNodeId === declNode.props.id.irNodeId);
                                    if (idNode && idNode.type === 'Identifier') {
                                        fileExports.set(idNode.props.name as string, idNode.irNodeId);
                                    }
                                }
                            }
                        }
                    }

                    const specifiers = child.props['specifiers'] || [];
                    for (const specRef of specifiers) {
                        if (specRef && specRef.type === 'ref') {
                            const specNode = child.children.find(c => c.irNodeId === specRef.irNodeId);
                            if (specNode && specNode.type === 'ExportSpecifier') {
                                const localRef = specNode.props['local'];
                                const exportedRef = specNode.props['exported'] || specNode.props['local'];
                                if (localRef && localRef.type === 'ref' && exportedRef && exportedRef.type === 'ref') {
                                    const localNode = specNode.children.find(c => c.irNodeId === localRef.irNodeId);
                                    const exportedNode = specNode.children.find(c => c.irNodeId === exportedRef.irNodeId);
                                    if (localNode && exportedNode && localNode.type === 'Identifier' && exportedNode.type === 'Identifier') {
                                        const localName = localNode.props.name as string;
                                        const exportedName = exportedNode.props.name as string;
                                        if (fromExports) {
                                            const targetDeclId = fromExports.get(localName);
                                            if (targetDeclId) {
                                                fileExports.set(exportedName, targetDeclId);
                                            }
                                        } else {
                                            fileExports.set(exportedName, localNode.irNodeId);
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else if (child.type === 'ExportDefaultDeclaration') {
                    const declRef = child.props['declaration'];
                    if (declRef && declRef.type === 'ref') {
                        const declNode = child.children.find(c => c.irNodeId === declRef.irNodeId);
                        if (declNode) {
                            let idNode: IRNode | undefined;
                            if (declNode.type === 'Identifier') {
                                idNode = declNode;
                            } else if (declNode.type === 'FunctionDeclaration' || declNode.type === 'ClassDeclaration') {
                                if (declNode.props.id && declNode.props.id.type === 'ref') {
                                    idNode = declNode.children.find(c => c.irNodeId === declNode.props.id.irNodeId);
                                }
                            }
                            if (idNode) {
                                fileExports.set('default', idNode.irNodeId);
                            }
                        }
                    }
                } else if (child.type === 'ExportAllDeclaration') {
                    const sourceRef = child.props['source'];
                    if (sourceRef && sourceRef.type === 'ref') {
                        const sourceNode = child.children.find(c => c.irNodeId === sourceRef.irNodeId);
                        if (sourceNode && !isExternalModule(sourceNode.props['value'], tree.filePath)) {
                            const fromBase = getBase(PathResolver.resolve(tree.filePath, sourceNode.props['value'], existingFiles));
                            const fromExports = exportsMap.get(fromBase) || exportsMap.get(fromBase + '/index');
                            if (fromExports) {
                                for (const [name, declId] of fromExports.entries()) {
                                    if (name !== 'default') {
                                        fileExports.set(name, declId);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // 3. 各モジュールのインポート情報、およびトップレベル文の構築
        for (const tree of irTrees) {
            const basePath = getBase(tree.filePath);
            const fileProgram = tree.children[0]?.children?.find(c => c.type === 'Program');
            const imports = new Map<string, ImportInfo>();

            if (fileProgram) {
                const bodyRefs = fileProgram.props['body'];
                if (Array.isArray(bodyRefs)) {
                    for (const ref of bodyRefs) {
                        if (!ref || ref.type !== 'ref') continue;
                        const child = fileProgram.children.find(c => c.irNodeId === ref.irNodeId);
                        if (!child || child.type !== 'ImportDeclaration') continue;

                        const sourceRef = child.props['source'];
                        if (sourceRef && sourceRef.type === 'ref') {
                            const sourceNode = child.children.find(c => c.irNodeId === sourceRef.irNodeId);
                            if (sourceNode) {
                                const sourceVal = sourceNode.props['value'] as string;
                                const specifiers = child.props['specifiers'] || [];
                                for (const specRef of specifiers) {
                                    if (specRef && specRef.type === 'ref') {
                                        const specNode = child.children.find(c => c.irNodeId === specRef.irNodeId);
                                        if (specNode) {
                                            let importedName = 'default';
                                            let localNode: IRNode | undefined;
                                            if (specNode.type === 'ImportSpecifier') {
                                                const importedRef = specNode.props['imported'];
                                                if (importedRef && importedRef.type === 'ref') {
                                                    const importedNode = specNode.children.find(c => c.irNodeId === importedRef.irNodeId);
                                                    if (importedNode) importedName = importedNode.props['name'] as string;
                                                }
                                                const localRef = specNode.props['local'] || specNode.props['imported'];
                                                if (localRef && localRef.type === 'ref') {
                                                    localNode = specNode.children.find(c => c.irNodeId === localRef.irNodeId);
                                                }
                                            } else if (specNode.type === 'ImportDefaultSpecifier') {
                                                importedName = 'default';
                                                const localRef = specNode.props['local'];
                                                if (localRef && localRef.type === 'ref') {
                                                    localNode = specNode.children.find(c => c.irNodeId === localRef.irNodeId);
                                                }
                                            } else if (specNode.type === 'ImportNamespaceSpecifier') {
                                                importedName = '*';
                                                const localRef = specNode.props['local'];
                                                if (localRef && localRef.type === 'ref') {
                                                    localNode = specNode.children.find(c => c.irNodeId === localRef.irNodeId);
                                                }
                                            }

                                            if (localNode && localNode.type === 'Identifier') {
                                                imports.set(localNode.irNodeId, {
                                                    sourcePath: sourceVal,
                                                    importedName,
                                                    localName: localNode.props.name as string,
                                                    localDeclId: localNode.irNodeId
                                                });
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            const refToDeclMap = refToDeclMaps.get(tree.filePath) || new Map<string, string>();
            const statements = TopLevelAnalyzer.analyze(tree, refToDeclMap);
            const isEntry = entryPaths.has(basePath) || entryPaths.has(basePath + '/index');

            modules.set(basePath, {
                filePath: tree.filePath,
                basePath,
                statements,
                exports: exportsMap.get(basePath) || new Map<string, string>(),
                imports,
                isEntry,
                tree
            });
        }

        return modules;
    }
}
