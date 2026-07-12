import { IRNode } from '../../../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { COMPILER_CONSTANTS } from '../../../../../utils/Constants';
import { PipelineStage } from '../../../../../infra/Pipeline';
import { MergeContext } from '../MergeContext';
import { ASTTransformer } from '../../../../../infra/ASTTransformer';
import { IdentifierRenameRule } from '../rules/IdentifierRenameRule';
import { UrlConstructorRule } from '../rules/UrlConstructorRule';
import { WorkerConstructorRule } from '../rules/WorkerConstructorRule';
import { ImportScriptsRule } from '../rules/ImportScriptsRule';

export class TransformASTNodesStage implements PipelineStage<MergeContext> {
    public readonly name = 'TransformASTNodesStage';

    execute(context: MergeContext): void {
        const transformer = new ASTTransformer<MergeContext>(
            [
                new IdentifierRenameRule(),
                new UrlConstructorRule(),
                new WorkerConstructorRule(),
                new ImportScriptsRule()
            ],
            {
                replaceId: (id) => context.nodeReplacements.get(id)?.irNodeId
            }
        );

        for (const tree of context.irTrees) {
            const basePath = context.getBase(tree.filePath);
            const mod = context.modules.get(basePath) || context.modules.get(basePath + '/index');
            if (!mod) continue;

            const isEntryFile = context.entryBasePaths.has(basePath) || context.entryBasePaths.has(basePath + '/index');
            const isWorkerEntryFile = context.workerEntryBases && (context.workerEntryBases.has(basePath) || context.workerEntryBases.has(basePath + '/index')) && !isEntryFile;

            const fileProgram = tree.children[0]?.children?.find(c => c.type === 'Program');
            if (!fileProgram) continue;

            // 1. 各ファイル処理時のコンテキスト初期化
            context.currentFilePath = tree.filePath;
            context.nodeReplacements.clear();

            // 2. このファイルの識別子リネーム用マッピングを構築
            const refToDeclMap = context.refToDeclMaps.get(tree.filePath) || new Map<string, string>();
            const irNodeMap = new Map<string, IRNode>();
            const buildMaps = (n: IRNode) => { 
                irNodeMap.set(n.irNodeId, n); 
                if (n.children) n.children.forEach(buildMaps); 
            };
            buildMaps(fileProgram);

            for (const [refId, resolvedDeclId] of refToDeclMap.entries()) {
                const actualDeclId = context.extImportRedirects.get(resolvedDeclId) || resolvedDeclId;
                const targetInfo = context.allTopLevelDecls.get(actualDeclId);

                if (targetInfo) {
                    const targetName = context.renameJobs.get(actualDeclId) || targetInfo.varName;
                    const node = irNodeMap.get(refId);
                    if (node && node.type === 'Identifier' && node.props.name !== targetName) {
                        context.nodeReplacements.set(refId, { ...node, props: { ...node.props, name: targetName } });
                    }
                } else if (context.renameJobs.has(actualDeclId)) {
                    const newName = context.renameJobs.get(actualDeclId)!;
                    const node = irNodeMap.get(refId);
                    if (node && node.type === 'Identifier') {
                        context.nodeReplacements.set(refId, { ...node, props: { ...node.props, name: newName } });
                    }
                }
            }

            // 3. AST変換処理を実行
            const updatedFileProgram = transformer.transform(fileProgram, context);
            const updatedBodyRefs = updatedFileProgram.props['body'];
            if (!Array.isArray(updatedBodyRefs)) continue;

            const isDynamic = context.dynamicImportedBases.has(basePath) || context.dynamicImportedBases.has(basePath + '/index');
            type BodyStatementInfo = { node: IRNode; originId: string };
            const fileBodyStatements: BodyStatementInfo[] = [];

            // 4. ステートメントの仕分け前スキャン
            for (let i = 0; i < updatedBodyRefs.length; i++) {
                const childRef = updatedBodyRefs[i];
                if (!childRef || childRef.type !== 'ref') continue;
                
                const child = updatedFileProgram.children.find(c => c.irNodeId === childRef.irNodeId);
                if (!child) continue;

                if (child.type === 'ImportDeclaration') {
                    const sourceRef = child.props['source'];
                    if (sourceRef && sourceRef.type === 'ref') {
                        const sourceNode = child.children.find(c => c.irNodeId === sourceRef.irNodeId);
                        if (sourceNode) {
                            const sourceVal = sourceNode.props['value'] as string;
                            const resolvedPath = context.resolvePath(tree.filePath, sourceVal);
                            if (context.isAsset(resolvedPath)) continue;

                            if (context.isExternalModule(sourceVal, tree.filePath)) {
                                context.globalExternalImports.push(child);
                            } else {
                                // 内部モジュールのNamespace Importに対して名前空間オブジェクトの実体を動的に合成して出力する
                                const specifiers = child.props['specifiers'] || [];
                                for (const specRef of specifiers) {
                                    if (specRef && specRef.type === 'ref') {
                                        const specNode = child.children.find(c => c.irNodeId === specRef.irNodeId);
                                        if (specNode && specNode.type === 'ImportNamespaceSpecifier') {
                                            const localRef = specNode.props['local'];
                                            const localNode = specNode.children.find(c => c.irNodeId === localRef?.irNodeId);
                                            
                                            if (localNode && localNode.type === 'Identifier') {
                                                const fromBase = context.getBase(resolvedPath);
                                                const fromExports = context.modules.get(fromBase)?.exports || context.modules.get(fromBase + '/index')?.exports;
                                                
                                                if (fromExports) {
                                                    const genId = () => context.getDeterministicId('ir_ns_obj');
                                                    const properties: IRNode[] = [];
                                                    
                                                    for (const [expName, expDeclId] of fromExports.entries()) {
                                                        const keyNode: IRNode = { type: 'Identifier', irNodeId: genId(), props: { name: expName }, children: [] };
                                                        
                                                        const actualDeclId = context.extImportRedirects.get(expDeclId) || expDeclId;
                                                        const valName = context.renameJobs.get(actualDeclId) || 'unknown'; 
                                                        
                                                        const valNode: IRNode = { 
                                                            type: 'Identifier', 
                                                            irNodeId: genId(), 
                                                            props: { name: valName, _declId: actualDeclId }, 
                                                            children: [] 
                                                        };
                                                        refToDeclMap.set(valNode.irNodeId, actualDeclId);
                                                        
                                                        const propNode: IRNode = {
                                                            type: 'ObjectProperty',
                                                            irNodeId: genId(),
                                                            props: { key: { type: 'ref', irNodeId: keyNode.irNodeId }, value: { type: 'ref', irNodeId: valNode.irNodeId }, computed: false, shorthand: false, method: false, kind: 'init' },
                                                            children: [keyNode, valNode]
                                                        };
                                                        properties.push(propNode);
                                                    }
                                                    
                                                    const objNode: IRNode = {
                                                        type: 'ObjectExpression',
                                                        irNodeId: genId(),
                                                        props: { properties: properties.map(p => ({ type: 'ref', irNodeId: p.irNodeId })) },
                                                        children: properties
                                                    };
                                                    
                                                    const nsDeclId = localNode.irNodeId;
                                                    const nsName = context.renameJobs.get(nsDeclId) || localNode.props['name'];
                                                    
                                                    const idNode: IRNode = {
                                                        type: 'Identifier',
                                                        irNodeId: nsDeclId,
                                                        props: { name: nsName, _declId: nsDeclId },
                                                        children: []
                                                    };
                                                    
                                                    const decltorNode: IRNode = {
                                                        type: 'VariableDeclarator',
                                                        irNodeId: genId(),
                                                        props: { id: { type: 'ref', irNodeId: idNode.irNodeId }, init: { type: 'ref', irNodeId: objNode.irNodeId } },
                                                        children: [idNode, objNode]
                                                    };
                                                    
                                                    const nsVarDecl: IRNode = {
                                                        type: 'VariableDeclaration',
                                                        irNodeId: genId(),
                                                        props: { kind: 'const', declarations: [{ type: 'ref', irNodeId: decltorNode.irNodeId }] },
                                                        children: [decltorNode]
                                                    };
                                                    
                                                    fileBodyStatements.push({ node: nsVarDecl, originId: child.irNodeId });
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    continue;
                }

                if (child.type === 'ExportNamedDeclaration' || child.type === 'ExportDefaultDeclaration') {
                    const declRef = child.props['declaration'];
                    if (declRef && declRef.type === 'ref') {
                        const declNode = child.children.find(c => c.irNodeId === declRef.irNodeId);
                        if (declNode) {
                            if (declNode.type === 'VariableDeclaration' || declNode.type === 'FunctionDeclaration' || declNode.type === 'ClassDeclaration') {
                                fileBodyStatements.push({ node: declNode, originId: child.irNodeId });
                            }
                        }
                    }
                    continue;
                }
                
                if (child.type === 'ExportAllDeclaration') continue;
                
                fileBodyStatements.push({ node: child, originId: child.irNodeId });
            }

            // 5. 仕分け処理 (Dynamic ImportのThunk生成、または Main/Worker 分岐)
            if (isDynamic) {
                const thunkName = `__dynamic_import_${basePath.replace(/[^a-zA-Z0-9_]/g, '_')}`;
                const thunkDeclId = context.thunkDeclIdMap.get(thunkName) || `thunk_decl_${basePath.replace(/[^a-zA-Z0-9_]/g, '_')}`;
                
                const targetExports = mod.exports;
                const properties: { keyName: string; targetDeclId: string }[] = [];
                for (const [expName, declId] of targetExports.entries()) {
                    properties.push({ keyName: expName, targetDeclId: declId });
                }
                const thunkNodes = this.createThunkFunction(
                    thunkName,
                    thunkDeclId,
                    fileBodyStatements.map(s => s.node),
                    properties,
                    refToDeclMap,
                    context
                );
                
                const thunkOrigins = new Set<string>();
                for (const declId of targetExports.values()) {
                    const origins = context.reachabilityMap?.get(declId);
                    if (origins) {
                        for (const o of origins) {
                            thunkOrigins.add(o);
                        }
                    }
                }
                for (const stmt of mod.statements.values()) {
                    if (stmt.type === 'SideEffect') {
                        const origins = context.reachabilityMap?.get(stmt.irNodeId);
                        if (origins) {
                            for (const o of origins) {
                                thunkOrigins.add(o);
                            }
                        }
                    }
                }
                
                const belongsTo = (thunkOrigins.size === 0) ? 'none' : (thunkOrigins.size > 1 ? 'common' : Array.from(thunkOrigins)[0]);
                
                for (const tNode of thunkNodes) {
                    if (belongsTo === 'common') {
                        context.commonStatements.push(tNode);
                    } else if (belongsTo === 'main') {
                        context.mainStatements.push(tNode);
                    } else if (belongsTo !== 'none') {
                        let arr = context.workerStatementsMap.get(belongsTo);
                        if (!arr) {
                            arr = [];
                            context.workerStatementsMap.set(belongsTo, arr);
                        }
                        arr.push(tNode);
                    }
                }
            } else {
                const hasBrowserGlobals = (n: IRNode): boolean => {
                    if (n.type === 'Identifier' && n.props && COMPILER_CONSTANTS.BROWSER_GLOBALS.has(n.props.name)) {
                        return true;
                    }
                    if (n.children) {
                        for (const child of n.children) {
                            if (hasBrowserGlobals(child)) return true;
                        }
                    }
                    return false;
                };

                const splitAndGuardVariableDeclaration = (stmt: IRNode): IRNode[] => {
                    const genId = () => context.getDeterministicId('ir_split_var');
                    
                    const declNode: IRNode = {
                        type: 'VariableDeclaration',
                        irNodeId: genId(),
                        props: {
                            kind: 'let',
                            declarations: []
                        },
                        children: []
                    };

                    const assignmentStmts: IRNode[] = [];

                    const cloneNode = (n: IRNode): IRNode => {
                        const newId = context.getDeterministicId('ir_clone');
                        const newChildren = n.children ? n.children.map(cloneNode) : [];
                        const newProps = n.props ? { ...n.props } : {};
                        return { type: n.type, irNodeId: newId, props: newProps, children: newChildren };
                    };

                    const decls = stmt.props.declarations || [];
                    for (const dRef of decls) {
                        if (dRef && dRef.type === 'ref') {
                            const dNode = stmt.children.find(c => c.irNodeId === dRef.irNodeId);
                            if (dNode && dNode.type === 'VariableDeclarator') {
                                const idRef = dNode.props.id;
                                const initRef = dNode.props.init;

                                const newDNodeId = genId();
                                const newDNode: IRNode = {
                                    type: 'VariableDeclarator',
                                    irNodeId: newDNodeId,
                                    props: {
                                        id: idRef,
                                        init: null
                                    },
                                    children: []
                                };
                                
                                let idNode: IRNode | undefined;
                                if (idRef && idRef.type === 'ref') {
                                    idNode = dNode.children.find(c => c.irNodeId === idRef.irNodeId);
                                    if (idNode) {
                                        newDNode.children.push(idNode);
                                    }
                                }
                                
                                declNode.props.declarations.push({ type: 'ref', irNodeId: newDNodeId });
                                declNode.children.push(newDNode);

                                if (initRef && initRef.type === 'ref') {
                                    const initNode = dNode.children.find(c => c.irNodeId === initRef.irNodeId);
                                    if (idRef && idRef.type === 'ref' && idNode && initNode) {
                                        const assignId = genId();
                                        const exprStmtId = genId();

                                        const clonedIdNode = cloneNode(idNode);
                                        const clonedInitNode = cloneNode(initNode);

                                        const assignNode: IRNode = {
                                            type: 'AssignmentExpression',
                                            irNodeId: assignId,
                                            props: {
                                                operator: '=',
                                                left: { type: 'ref', irNodeId: clonedIdNode.irNodeId },
                                                right: { type: 'ref', irNodeId: clonedInitNode.irNodeId }
                                            },
                                            children: [clonedIdNode, clonedInitNode]
                                        };

                                        const exprStmtNode: IRNode = {
                                            type: 'ExpressionStatement',
                                            irNodeId: exprStmtId,
                                            props: {
                                                expression: { type: 'ref', irNodeId: assignNode.irNodeId }
                                            },
                                            children: [assignNode]
                                        };

                                        assignmentStmts.push(exprStmtNode);
                                    }
                                }
                            }
                        }
                    }

                    const result: IRNode[] = [declNode];
                    
                    for (const assignStmt of assignmentStmts) {
                        const winIdentId = context.getDeterministicId('ir_win_guard_ident');
                        const typeOfWinNode: IRNode = {
                            type: 'UnaryExpression',
                            irNodeId: genId(),
                            props: { operator: 'typeof', prefix: true, argument: { type: 'ref', irNodeId: winIdentId } },
                            children: [{ type: 'Identifier', irNodeId: winIdentId, props: { name: 'window' }, children: [] }]
                        };
                        const undefStrNode: IRNode = {
                            type: 'StringLiteral',
                            irNodeId: genId(),
                            props: { value: 'undefined' },
                            children: []
                        };
                        const windowTestNode: IRNode = {
                            type: 'BinaryExpression',
                            irNodeId: genId(),
                            props: { operator: '!==', left: { type: 'ref', irNodeId: typeOfWinNode.irNodeId }, right: { type: 'ref', irNodeId: undefStrNode.irNodeId } },
                            children: [typeOfWinNode, undefStrNode]
                        };

                        const blockNode: IRNode = {
                            type: 'BlockStatement',
                            irNodeId: genId(),
                            props: { body: [{ type: 'ref', irNodeId: assignStmt.irNodeId }] },
                            children: [assignStmt]
                        };
                        const guardedStmt: IRNode = {
                            type: 'IfStatement',
                            irNodeId: genId(),
                            props: {
                                test: { type: 'ref', irNodeId: windowTestNode.irNodeId },
                                consequent: { type: 'ref', irNodeId: blockNode.irNodeId },
                                alternate: null
                            },
                            children: [windowTestNode, blockNode]
                        };
                        result.push(guardedStmt);
                    }

                    return result;
                };

                for (const stmtInfo of fileBodyStatements) {
                    const stmt = stmtInfo.node;

                    // 不要になった importScripts の呼び出し跡 ( 空の表現 / undefined; ) をツリーから除去
                    if (stmt.type === 'ExpressionStatement') {
                        const exprRef = stmt.props.expression;
                        if (exprRef && exprRef.type === 'ref') {
                            const exprNode = stmt.children.find(c => c.irNodeId === exprRef.irNodeId);
                            if (exprNode && exprNode.type === 'Identifier' && exprNode.props.name === 'undefined') {
                                continue; 
                            }
                        }
                    }

                    const stmtOrigins = context.reachabilityMap?.get(stmtInfo.originId);
                    if (!stmtOrigins || stmtOrigins.size === 0) {
                        continue;
                    }

                    if (isWorkerEntryFile) {
                        let arr = context.workerStatementsMap.get(basePath);
                        if (!arr) {
                            arr = [];
                            context.workerStatementsMap.set(basePath, arr);
                        }
                        arr.push(stmt);
                    } else if (stmtOrigins.size > 1) {
                        if (hasBrowserGlobals(stmt)) {
                            if (stmt.type === 'VariableDeclaration') {
                                const splitted = splitAndGuardVariableDeclaration(stmt);
                                for (const s of splitted) {
                                    context.commonStatements.push(s);
                                }
                            } else {
                                const genId = () => context.getDeterministicId('ir_side_effect_guard');
                                const winIdentId = context.getDeterministicId('ir_win_guard_ident');

                                const typeOfWinNode: IRNode = {
                                    type: 'UnaryExpression',
                                    irNodeId: genId(),
                                    props: { operator: 'typeof', prefix: true, argument: { type: 'ref', irNodeId: winIdentId } },
                                    children: [{ type: 'Identifier', irNodeId: winIdentId, props: { name: 'window' }, children: [] }]
                                };
                                const undefStrNode: IRNode = {
                                    type: 'StringLiteral',
                                    irNodeId: genId(),
                                    props: { value: 'undefined' },
                                    children: []
                                };
                                const windowTestNode: IRNode = {
                                    type: 'BinaryExpression',
                                    irNodeId: genId(),
                                    props: { operator: '!==', left: { type: 'ref', irNodeId: typeOfWinNode.irNodeId }, right: { type: 'ref', irNodeId: undefStrNode.irNodeId } },
                                    children: [typeOfWinNode, undefStrNode]
                                };

                                const blockNode: IRNode = {
                                    type: 'BlockStatement',
                                    irNodeId: genId(),
                                    props: { body: [{ type: 'ref', irNodeId: stmt.irNodeId }] },
                                    children: [stmt]
                                };
                                const guardedStmt: IRNode = {
                                    type: 'IfStatement',
                                    irNodeId: genId(),
                                    props: {
                                        test: { type: 'ref', irNodeId: windowTestNode.irNodeId },
                                        consequent: { type: 'ref', irNodeId: blockNode.irNodeId },
                                        alternate: null
                                    },
                                    children: [windowTestNode, blockNode]
                                };
                                context.commonStatements.push(guardedStmt);
                            }
                        } else {
                            context.commonStatements.push(stmt);
                        }
                    } else {
                        const singleOrigin = Array.from(stmtOrigins)[0];
                        if (singleOrigin === 'main') {
                            context.mainStatements.push(stmt);
                        } else {
                            let arr = context.workerStatementsMap.get(singleOrigin);
                            if (!arr) {
                                arr = [];
                                context.workerStatementsMap.set(singleOrigin, arr);
                            }
                            arr.push(stmt);
                        }
                    }
                }
            }
        }
    }

    private createThunkFunction(
        thunkName: string,
        thunkDeclId: string,
        bodyStatements: IRNode[],
        exportsProperties: { keyName: string; targetDeclId: string }[],
        refToDeclMap: Map<string, string>,
        context: MergeContext
    ): IRNode[] {
        const cacheVarName = `${thunkName}_cache`;
        
        let propsCode = '';
        for (const prop of exportsProperties) {
            const targetInfo = context.allTopLevelDecls.get(prop.targetDeclId);
            const actualName = context.renameJobs.get(prop.targetDeclId) || (targetInfo ? targetInfo.varName : prop.keyName);
            propsCode += `"${prop.keyName}": ${actualName},\n`;
        }

        const code = `
            let ${cacheVarName};
            function ${thunkName}() {
                if (${cacheVarName}) return ${cacheVarName};
                __INJECT_BODY__();
                ${cacheVarName} = { ${propsCode} };
                return ${cacheVarName};
            }
        `;
        const astList = context.parseTemplate(code);
        
        this.replacePlaceholderWithStatements(astList[1], '__INJECT_BODY__', bodyStatements, context);

        const walk = (node: IRNode) => {
            if (node.type === 'Identifier') {
                if (node.props['name'] === thunkName) {
                    node.props['_declId'] = thunkDeclId;
                }
                for (const prop of exportsProperties) {
                    const targetInfo = context.allTopLevelDecls.get(prop.targetDeclId);
                    const actualName = context.renameJobs.get(prop.targetDeclId) || (targetInfo ? targetInfo.varName : prop.keyName);
                    
                    if (node.props['name'] === actualName && node.props['_declId'] !== thunkDeclId) {
                        node.props['_declId'] = prop.targetDeclId;
                        refToDeclMap.set(node.irNodeId, prop.targetDeclId);
                    }
                }
            }
            if (node.children) node.children.forEach(walk);
        };
        astList.forEach(walk);

        return astList;
    }

    private replacePlaceholderWithStatements(ast: IRNode, placeholderName: string, statements: IRNode[], context: MergeContext): void {
        let replaced = false;
        const walk = (node: IRNode) => {
            if (node.type === 'BlockStatement' || node.type === 'Program') {
                const bodyRefs = node.props['body'];
                if (Array.isArray(bodyRefs)) {
                    let indexToReplace = -1;
                    for (let i = 0; i < bodyRefs.length; i++) {
                        const ref = bodyRefs[i];
                        if (ref && ref.type === 'ref') {
                            const child = node.children.find(c => c.irNodeId === ref.irNodeId);
                            if (child && child.type === 'ExpressionStatement') {
                                const exprRef = child.props['expression'];
                                if (exprRef && exprRef.type === 'ref') {
                                    const exprNode = child.children.find(c => c.irNodeId === exprRef.irNodeId);
                                    if (exprNode && exprNode.type === 'CallExpression') {
                                        const calleeRef = exprNode.props['callee'];
                                        if (calleeRef && calleeRef.type === 'ref') {
                                            const calleeNode = exprNode.children.find(c => c.irNodeId === calleeRef.irNodeId);
                                            if (calleeNode && calleeNode.type === 'Identifier' && calleeNode.props['name'] === placeholderName) {
                                                indexToReplace = i;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (indexToReplace !== -1) {
                        const targetRef = bodyRefs[indexToReplace];
                        const newRefs = statements.map(s => ({ type: 'ref', irNodeId: s.irNodeId }));
                        bodyRefs.splice(indexToReplace, 1, ...newRefs);

                        const childIndex = node.children.findIndex(c => c.irNodeId === targetRef.irNodeId);
                        if (childIndex !== -1) {
                            node.children.splice(childIndex, 1, ...statements);
                        }
                        replaced = true;
                    }
                }
            }
            if (node.children) node.children.forEach(walk);
        };
        walk(ast);

        if (!replaced) {
            throw new Error(`[Compiler Internal Error] Template injection failed. Placeholder "${placeholderName}" was not found in the AST.`);
        }
    }
}
