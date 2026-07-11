import { IRNode } from '../../../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { PipelineStage } from '../../../../../infra/Pipeline';
import { MergeContext } from '../MergeContext';

export class MergeExternalImportsStage implements PipelineStage<MergeContext> {
    public readonly name = 'MergeExternalImportsStage';

    execute(context: MergeContext): void {
        const mergedImports = new Map<string, {
            defaultSpecifier: IRNode | null;
            defaultSpecifierName: string | null;
            namedSpecifiers: Map<string, IRNode>;
            namespaceSpecifier: IRNode | null;
            namespaceSpecifierName: string | null;
            originalDeclNode: IRNode;
        }>();

        // 1. 重複する外部インポートを収集
        for (const extImport of context.globalExternalImports) {
            const sourceRef = extImport.props['source'];
            const sourceNode = extImport.children.find((c: any) => c.irNodeId === sourceRef.irNodeId);
            if (!sourceNode) continue;
            
            const sourcePath = sourceNode.props['value'] as string;
            if (!mergedImports.has(sourcePath)) {
                mergedImports.set(sourcePath, {
                    defaultSpecifier: null,
                    defaultSpecifierName: null,
                    namedSpecifiers: new Map(),
                    namespaceSpecifier: null,
                    namespaceSpecifierName: null,
                    originalDeclNode: extImport
                });
            }
            
            const group = mergedImports.get(sourcePath)!;
            const specifiers = extImport.props['specifiers'] || [];
            
            for (const specRef of specifiers) {
                if (!specRef || specRef.type !== 'ref') continue;
                const specNode = extImport.children.find((c: any) => c.irNodeId === specRef.irNodeId);
                if (!specNode) continue;

                if (specNode.type === 'ImportDefaultSpecifier') {
                    const localRef = specNode.props['local'];
                    const localNode = specNode.children.find((c: any) => c.irNodeId === localRef?.irNodeId);
                    const localName = localNode ? localNode.props['name'] as string : '';
                    if (!group.defaultSpecifier) {
                        group.defaultSpecifier = specNode;
                        group.defaultSpecifierName = localName;
                    }
                } else if (specNode.type === 'ImportNamespaceSpecifier') {
                    const localRef = specNode.props['local'];
                    const localNode = specNode.children.find((c: any) => c.irNodeId === localRef?.irNodeId);
                    const localName = localNode ? localNode.props['name'] as string : '';
                    if (!group.namespaceSpecifier) {
                        group.namespaceSpecifier = specNode;
                        group.namespaceSpecifierName = localName;
                    }
                } else if (specNode.type === 'ImportSpecifier') {
                    const importedRef = specNode.props['imported'];
                    const localRef = specNode.props['local'] || importedRef;
                    const localNode = specNode.children.find((c: any) => c.irNodeId === localRef?.irNodeId);
                    const localName = localNode ? localNode.props['name'] as string : '';
                    
                    if (localName && !group.namedSpecifiers.has(localName)) {
                        group.namedSpecifiers.set(localName, specNode);
                    }
                }
            }
        }

        // 2. 代表定義を元にインポート文をマージ再構築
        const generateIrId = () => context.getDeterministicId('ir_id');

        for (const [sourcePath, group] of Array.from(mergedImports.entries()).reverse()) {
            const newSpecifiers: any[] = [];
            const newChildren: IRNode[] = [];
            
            const sourceRef = group.originalDeclNode.props['source'];
            const sourceNode = group.originalDeclNode.children.find((c: any) => c.irNodeId === sourceRef.irNodeId)!;
            newChildren.push(sourceNode);

            if (group.defaultSpecifier) {
                const localRef = group.defaultSpecifier.props['local'];
                const localNode = group.defaultSpecifier.children.find((c: any) => c.irNodeId === localRef?.irNodeId);
                let safeSpecifier = group.defaultSpecifier;
                
                if (localNode && localNode.type === 'Identifier') {
                    const actualDeclId = context.extImportRedirects.get(localNode.irNodeId) || localNode.irNodeId;
                    const finalName = context.renameJobs.get(actualDeclId) || localNode.props['name'];
                    
                    const newLocalNode: IRNode = {
                        ...localNode,
                        irNodeId: actualDeclId,
                        props: { ...localNode.props, name: finalName, _declId: actualDeclId }
                    };
                    safeSpecifier = {
                        ...group.defaultSpecifier,
                        props: { ...group.defaultSpecifier.props, local: { type: 'ref', irNodeId: actualDeclId } },
                        children: group.defaultSpecifier.children.map(c => c.irNodeId === localNode.irNodeId ? newLocalNode : c)
                    };
                }
                newSpecifiers.push({ type: 'ref', irNodeId: safeSpecifier.irNodeId });
                newChildren.push(safeSpecifier);
            }

            let createNamespaceInteropDecl: (() => IRNode) | null = null;
            if (group.namespaceSpecifier) {
                const nsLocalRef = group.namespaceSpecifier.props['local'];
                const nsLocalNode = group.namespaceSpecifier.children.find((c: any) => c.irNodeId === nsLocalRef?.irNodeId);
                
                if (nsLocalNode && nsLocalNode.type === 'Identifier') {
                    const localDeclId = nsLocalNode.irNodeId;
                    const originalName = nsLocalNode.props['name'] as string;
                    
                    const actualDeclId = context.extImportRedirects.get(localDeclId) || localDeclId;
                    const finalName = context.renameJobs.get(actualDeclId) || originalName;

                    const tempName = `__ns_${originalName}_interop`;
                    const nsInteropDeclId = generateIrId();
                    
                    const newNsLocalNode: IRNode = {
                        ...nsLocalNode,
                        irNodeId: nsInteropDeclId,
                        props: { ...nsLocalNode.props, name: tempName, _declId: actualDeclId }
                    };
                    const safeNsSpecifier: IRNode = {
                        ...group.namespaceSpecifier,
                        props: { ...group.namespaceSpecifier.props, local: { type: 'ref', irNodeId: newNsLocalNode.irNodeId } },
                        children: group.namespaceSpecifier.children.map(c => c.irNodeId === nsLocalNode.irNodeId ? newNsLocalNode : c)
                    };

                    newSpecifiers.push({ type: 'ref', irNodeId: safeNsSpecifier.irNodeId });
                    newChildren.push(safeNsSpecifier);

                    createNamespaceInteropDecl = () => {
                        const genId = () => context.getDeterministicId('ir_interop');
                        
                        const objExpr: IRNode = { type: 'ObjectExpression', irNodeId: genId(), props: { properties: [] }, children: [] };
                        const argNode: IRNode = { type: 'Identifier', irNodeId: genId(), props: { name: tempName, _declId: nsInteropDeclId }, children: [] };
                        
                        const objectIdent: IRNode = { type: 'Identifier', irNodeId: genId(), props: { name: 'Object' }, children: [] };
                        const assignIdent: IRNode = { type: 'Identifier', irNodeId: genId(), props: { name: 'assign' }, children: [] };
                        const memberExpr: IRNode = { 
                            type: 'MemberExpression', 
                            irNodeId: genId(), 
                            props: { object: { type: 'ref', irNodeId: objectIdent.irNodeId }, property: { type: 'ref', irNodeId: assignIdent.irNodeId }, computed: false }, 
                            children: [objectIdent, assignIdent] 
                        };
                        const callExpr: IRNode = {
                            type: 'CallExpression',
                            irNodeId: genId(),
                            props: { callee: { type: 'ref', irNodeId: memberExpr.irNodeId }, arguments: [{ type: 'ref', irNodeId: objExpr.irNodeId }, { type: 'ref', irNodeId: argNode.irNodeId }] },
                            children: [memberExpr, objExpr, argNode]
                        };

                        const origIdent: IRNode = { type: 'Identifier', irNodeId: actualDeclId, props: { name: finalName, _declId: actualDeclId }, children: [] };
                        const decltor: IRNode = {
                            type: 'VariableDeclarator',
                            irNodeId: genId(),
                            props: { id: { type: 'ref', irNodeId: origIdent.irNodeId }, init: { type: 'ref', irNodeId: callExpr.irNodeId } },
                            children: [origIdent, callExpr]
                        };

                        return {
                            type: 'VariableDeclaration',
                            irNodeId: genId(),
                            props: { kind: 'const', declarations: [{ type: 'ref', irNodeId: decltor.irNodeId }] },
                            children: [decltor]
                        };
                    };
                } else {
                    newSpecifiers.push({ type: 'ref', irNodeId: group.namespaceSpecifier.irNodeId });
                    newChildren.push(group.namespaceSpecifier);
                }
            }
            
            for (const spec of group.namedSpecifiers.values()) {
                let safeSpecifier = spec;
                const localRef = spec.props['local'] || spec.props['imported'];
                const localNode = spec.children.find((c: any) => c.irNodeId === localRef?.irNodeId);

                if (localNode && localNode.type === 'Identifier') {
                    const actualDeclId = context.extImportRedirects.get(localNode.irNodeId) || localNode.irNodeId;
                    const finalName = context.renameJobs.get(actualDeclId) || localNode.props['name'];
                    
                    const newLocalNode: IRNode = {
                        ...localNode,
                        irNodeId: actualDeclId,
                        props: { ...localNode.props, name: finalName, _declId: actualDeclId }
                    };
                    
                    const newProps = { ...spec.props };
                    if (!newProps['imported']) {
                        newProps['imported'] = spec.props['local'];
                    }
                    newProps['local'] = { type: 'ref', irNodeId: actualDeclId };

                    safeSpecifier = {
                        ...spec,
                        props: newProps,
                        children: spec.children.map(c => c.irNodeId === localNode.irNodeId ? newLocalNode : c)
                    };
                }

                newSpecifiers.push({ type: 'ref', irNodeId: safeSpecifier.irNodeId });
                newChildren.push(safeSpecifier);
            }

            const mergedImportNode: IRNode = {
                type: 'ImportDeclaration',
                irNodeId: `ir_merged_import_${sourcePath.replace(/[^a-zA-Z0-9]/g, '_')}`,
                props: { source: sourceRef, specifiers: newSpecifiers },
                children: newChildren
            };

            // 3. マージしたインポート文の依存ブランチ（Main/Worker）決定
            let hasVariables = false;
            const allOrigins = new Set<string>();
            for (const specRef of newSpecifiers) {
                const sNode = mergedImportNode.children.find(c => c.irNodeId === specRef.irNodeId);
                if (sNode) {
                    const localRef = sNode.props['local'];
                    if (localRef && localRef.type === 'ref') {
                        hasVariables = true;
                        const localId = localRef.irNodeId;
                        const localNode = sNode.children.find(c => c.irNodeId === localId);
                        const actualId = localNode?.props['_declId'] || localId;
                        
                        const relatedIds = [actualId];
                        for (const [origId, redirectId] of context.extImportRedirects.entries()) {
                            if (redirectId === actualId) {
                                relatedIds.push(origId);
                            }
                        }

                        for (const rId of relatedIds) {
                            const origins = context.reachabilityMap?.get(rId);
                            if (origins) {
                                for (const o of origins) {
                                    allOrigins.add(o);
                                }
                            }
                        }
                    }
                }
            }

            let targetOrigins = Array.from(allOrigins);
            if (targetOrigins.length === 0) {
                if (context.logger) {
                    context.logger({ 
                        type: 'error', 
                        msg: `[ChunkMerger] -> Warning: "${sourcePath}" has NO active origins. Falling back to Main branch dynamically.` 
                    });
                }
                targetOrigins = ['main'];
            }

            if (context.logger) {
                const originList = targetOrigins.join(',');
                context.logger({ 
                    type: 'info', 
                    msg: `[ChunkMerger] External Import "${sourcePath}" - Origins: [${originList}]` 
                });
            }

            // 4. 動的インポート文へ変換のうえ、各バッファに挿入
            for (const origin of targetOrigins) {
                const isWorker = origin !== 'main';
                let stmtNode: IRNode;

                if (hasVariables) {
                    stmtNode = this.convertToDynamicImport(mergedImportNode, context.renameJobs, isWorker, context);
                } else {
                    const genId = () => context.getDeterministicId('ir_dyn_sideeffect');
                    const importIdent: IRNode = { type: 'Import', irNodeId: genId(), props: {}, children: [] };
                    const sourceRef = mergedImportNode.props['source'];
                    const sourceNode = mergedImportNode.children.find(c => c.irNodeId === sourceRef.irNodeId)!;
                    const sourceVal = sourceNode.props['value'] as string;
                    const argStrNode: IRNode = { type: 'StringLiteral', irNodeId: genId(), props: { value: sourceVal, _isWorkerImport: isWorker }, children: [] };
                    
                    const importCallNode: IRNode = {
                        type: 'CallExpression', irNodeId: genId(),
                        props: { callee: { type: 'ref', irNodeId: importIdent.irNodeId }, arguments: [{ type: 'ref', irNodeId: argStrNode.irNodeId }] },
                        children: [importIdent, argStrNode]
                    };
                    const awaitNode: IRNode = {
                        type: 'AwaitExpression', irNodeId: genId(),
                        props: { argument: { type: 'ref', irNodeId: importCallNode.irNodeId } },
                        children: [importCallNode]
                    };
                    stmtNode = {
                        type: 'ExpressionStatement', irNodeId: genId(),
                        props: { expression: { type: 'ref', irNodeId: awaitNode.irNodeId } },
                        children: [awaitNode]
                    };
                }

                if (context.logger) {
                    context.logger({ 
                        type: 'info', 
                        msg: `[ChunkMerger] -> Placing "${sourcePath}" as DYNAMIC into ${isWorker ? 'Worker' : 'Main'} branch. (Origin: ${origin})` 
                    });
                }

                if (origin === 'main') {
                    if (createNamespaceInteropDecl) {
                        context.mainStatements.unshift(createNamespaceInteropDecl());
                    }
                    context.mainStatements.unshift(stmtNode);
                } else {
                    let arr = context.workerStatementsMap.get(origin);
                    if (!arr) {
                        arr = [];
                        context.workerStatementsMap.set(origin, arr);
                    }
                    if (createNamespaceInteropDecl) {
                        arr.unshift(createNamespaceInteropDecl());
                    }
                    arr.unshift(stmtNode);
                }
            }
        }
    }

    private convertToDynamicImport(
        importDecl: IRNode,
        renameJobs: Map<string, string>,
        isWorkerImport: boolean,
        context: MergeContext
    ): IRNode {
        const sourceRef = importDecl.props['source'];
        const sourceNode = importDecl.children.find((c: any) => c.irNodeId === sourceRef.irNodeId)!;
        const sourceVal = sourceNode.props['value'] as string;

        const genId = () => context.getDeterministicId('ir_dyn_conv');

        const properties: IRNode[] = [];
        const propertyRefs: any[] = [];
        
        let hasNamespace = false;
        let namespaceLocalId = '';
        let namespaceLocalName = '';

        const specifiers = importDecl.props['specifiers'] || [];
        for (const specRef of specifiers) {
            const specNode = importDecl.children.find((c: any) => c.irNodeId === specRef.irNodeId);
            if (!specNode) continue;

            let importedName = 'default';
            let localDeclId = '';
            let localName = '';

            const localRef = specNode.props['local'];
            const localNode = localRef ? specNode.children.find((c: any) => c.irNodeId === localRef.irNodeId) : null;
            if (localNode) {
                localDeclId = localNode.irNodeId;
                localName = renameJobs.get(localDeclId) || localNode.props['name'];
            }

            if (specNode.type === 'ImportNamespaceSpecifier') {
                hasNamespace = true;
                namespaceLocalId = localDeclId;
                namespaceLocalName = localName;
                break; 
            }

            if (specNode.type === 'ImportDefaultSpecifier') {
                importedName = 'default';
            } else if (specNode.type === 'ImportSpecifier') {
                const importedRef = specNode.props['imported'];
                const importedNode = importedRef ? specNode.children.find((c: any) => c.irNodeId === importedRef.irNodeId) : null;
                importedName = importedNode ? importedNode.props['name'] : localName;
            }

            if (localDeclId) {
                const keyNode: IRNode = { type: 'Identifier', irNodeId: genId(), props: { name: importedName }, children: [] };
                const valNode: IRNode = { type: 'Identifier', irNodeId: localDeclId, props: { name: localName, _declId: localDeclId }, children: [] };
                const propNode: IRNode = {
                    type: 'ObjectProperty',
                    irNodeId: genId(),
                    props: { key: { type: 'ref', irNodeId: keyNode.irNodeId }, value: { type: 'ref', irNodeId: valNode.irNodeId }, computed: false, shorthand: false },
                    children: [keyNode, valNode]
                };
                properties.push(propNode);
                propertyRefs.push({ type: 'ref', irNodeId: propNode.irNodeId });
            }
        }

        let declaratorIdNode: IRNode;
        if (hasNamespace) {
            declaratorIdNode = {
                type: 'Identifier',
                irNodeId: namespaceLocalId,
                props: { name: namespaceLocalName, _declId: namespaceLocalId },
                children: []
            };
        } else {
            declaratorIdNode = {
                type: 'ObjectPattern',
                irNodeId: genId(),
                props: { properties: propertyRefs },
                children: properties
            };
        }

        const importIdent: IRNode = { type: 'Import', irNodeId: genId(), props: {}, children: [] };
        const argStrNode: IRNode = { type: 'StringLiteral', irNodeId: genId(), props: { value: sourceVal, _isWorkerImport: isWorkerImport }, children: [] };
        const importCallNode: IRNode = {
            type: 'CallExpression',
            irNodeId: genId(),
            props: { callee: { type: 'ref', irNodeId: importIdent.irNodeId }, arguments: [{ type: 'ref', irNodeId: argStrNode.irNodeId }] },
            children: [importIdent, argStrNode]
        };

        const awaitNode: IRNode = {
            type: 'AwaitExpression',
            irNodeId: genId(),
            props: { argument: { type: 'ref', irNodeId: importCallNode.irNodeId } },
            children: [importCallNode]
        };

        const declaratorNode: IRNode = {
            type: 'VariableDeclarator',
            irNodeId: genId(),
            props: { id: { type: 'ref', irNodeId: declaratorIdNode.irNodeId }, init: { type: 'ref', irNodeId: awaitNode.irNodeId } },
            children: [declaratorIdNode, awaitNode] 
        };

        return {
            type: 'VariableDeclaration',
            irNodeId: importDecl.irNodeId,
            props: { kind: 'const', declarations: [{ type: 'ref', irNodeId: declaratorNode.irNodeId }] },
            children: [declaratorNode]
        };
    }
}
