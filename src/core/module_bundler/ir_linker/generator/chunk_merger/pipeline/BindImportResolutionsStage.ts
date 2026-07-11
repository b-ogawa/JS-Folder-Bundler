import { IRNode } from '../../../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { PipelineStage } from '../../../../../infra/Pipeline';
import { MergeContext } from '../MergeContext';

export class BindImportResolutionsStage implements PipelineStage<MergeContext> {
    public readonly name = 'BindImportResolutionsStage';

    execute(context: MergeContext): void {
        for (const mod of context.modules.values()) {
            const refToDeclMap = context.refToDeclMaps.get(mod.filePath);
            if (!refToDeclMap) continue;

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
                    if (sourceNode && !context.isExternalModule(sourceNode.props['value'], mod.filePath)) {
                        const fromBase = context.getBase(context.resolvePath(mod.filePath, sourceNode.props['value']));
                        const fromExports = context.modules.get(fromBase)?.exports || context.modules.get(fromBase + '/index')?.exports;
                        if (fromExports) {
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
                                        }
                                        if (localNode && localNode.type === 'Identifier') {
                                            const targetDeclId = fromExports.get(importedName);
                                            if (targetDeclId) {
                                                for (const [rId, dId] of refToDeclMap.entries()) {
                                                    if (dId === localNode.irNodeId) refToDeclMap.set(rId, targetDeclId);
                                                }
                                            } else {
                                                const sourceVal = sourceNode.props['value'] as string;
                                                const msg = `[Linker Error] "${importedName}" is not exported by "${sourceVal}" (imported from "${mod.filePath}").`;
                                                if (context.logger) context.logger({ type: 'error', msg });
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
