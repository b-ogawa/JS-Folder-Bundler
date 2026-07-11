import { PipelineStage } from '../../../../../infra/Pipeline';
import { MergeContext } from '../MergeContext';

export class ResolveExternalImportsStage implements PipelineStage<MergeContext> {
    public readonly name = 'ResolveExternalImportsStage';

    execute(context: MergeContext): void {
        for (const mod of context.modules.values()) {
            const fileProgram = mod.tree.children[0]?.children?.find(c => c.type === 'Program');
            if (!fileProgram) continue;

            const bodyRefs = fileProgram.props['body'];
            if (!Array.isArray(bodyRefs)) continue;

            for (const ref of bodyRefs) {
                if (!ref || ref.type !== 'ref') continue;
                const child = fileProgram.children.find(c => c.irNodeId === ref.irNodeId);
                if (!child || child.type !== 'ImportDeclaration') continue;

                const sourceRef = child.props['source'];
                if (sourceRef && sourceRef.type === 'ref') {
                    const sourceNode = child.children.find(c => c.irNodeId === sourceRef.irNodeId);
                    if (sourceNode && context.isExternalModule(sourceNode.props['value'], mod.filePath)) {
                        const sourceVal = sourceNode.props['value'] as string;
                        
                        const resolvedPath = context.resolvePath(mod.filePath, sourceVal);
                        const isAssetFlag = context.isAsset(resolvedPath);

                        if (!isAssetFlag) {
                            if (!context.extImportAdoptedDecls.has(sourceVal)) {
                                context.extImportAdoptedDecls.set(sourceVal, { namedDeclIds: new Map() });
                            }
                            const adopted = context.extImportAdoptedDecls.get(sourceVal)!;

                            const specifiers = child.props['specifiers'] || [];
                            for (const specRef of specifiers) {
                                if (specRef && specRef.type === 'ref') {
                                    const specNode = child.children.find(c => c.irNodeId === specRef.irNodeId);
                                    if (specNode && specNode.props['local'] && specNode.props['local'].type === 'ref') {
                                        const localNode = specNode.children.find(c => c.irNodeId === specNode.props['local'].irNodeId);
                                        if (localNode && localNode.type === 'Identifier') {
                                            const localDeclId = localNode.irNodeId;
                                            const localName = localNode.props.name as string;

                                            if (specNode.type === 'ImportDefaultSpecifier') {
                                                if (adopted.defaultDeclId) {
                                                    context.extImportRedirects.set(localDeclId, adopted.defaultDeclId);
                                                } else {
                                                    adopted.defaultDeclId = localDeclId;
                                                    context.allTopLevelDecls.set(localDeclId, { varName: localName, declId: localDeclId, filePath: mod.filePath });
                                                }
                                            } else if (specNode.type === 'ImportNamespaceSpecifier') {
                                                if (adopted.namespaceDeclId) {
                                                    context.extImportRedirects.set(localDeclId, adopted.namespaceDeclId);
                                                } else {
                                                    adopted.namespaceDeclId = localDeclId;
                                                    context.allTopLevelDecls.set(localDeclId, { varName: localName, declId: localDeclId, filePath: mod.filePath });
                                                }
                                            } else if (specNode.type === 'ImportSpecifier') {
                                                const importedRef = specNode.props['imported'];
                                                let importedName = localName;
                                                if (importedRef && importedRef.type === 'ref') {
                                                    const importedNode = specNode.children.find(c => c.irNodeId === importedRef.irNodeId);
                                                    if (importedNode) importedName = importedNode.props['name'] as string;
                                                }
                                                
                                                if (adopted.namedDeclIds.has(importedName)) {
                                                    context.extImportRedirects.set(localDeclId, adopted.namedDeclIds.get(importedName)!);
                                                } else {
                                                    adopted.namedDeclIds.set(importedName, localDeclId);
                                                    context.allTopLevelDecls.set(localDeclId, { varName: localName, declId: localDeclId, filePath: mod.filePath });
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
