import { IRNode } from '../../../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { PipelineStage } from '../../../../../infra/Pipeline';
import { MergeContext } from '../MergeContext';

export class ExtractTopLevelDeclarationsStage implements PipelineStage<MergeContext> {
    public readonly name = 'ExtractTopLevelDeclarationsStage';

    execute(context: MergeContext): void {
        for (const mod of context.modules.values()) {
            const fileProgram = mod.tree.children[0]?.children?.find(c => c.type === 'Program');
            if (!fileProgram) continue;

            const bodyRefs = fileProgram.props['body'];
            if (!Array.isArray(bodyRefs)) continue;

            const extractFromDecl = (declNode: IRNode) => {
                if (declNode.type === 'VariableDeclaration') {
                    for (const decltorRef of declNode.props.declarations || []) {
                        if (decltorRef && decltorRef.type === 'ref') {
                            const decltorNode = declNode.children.find(c => c.irNodeId === decltorRef.irNodeId);
                            if (decltorNode && decltorNode.props.id && decltorNode.props.id.type === 'ref') {
                                const idNode = decltorNode.children.find(c => c.irNodeId === decltorNode.props.id.irNodeId);
                                if (idNode && idNode.type === 'Identifier') {
                                    context.allTopLevelDecls.set(idNode.irNodeId, { 
                                        varName: idNode.props.name as string, 
                                        declId: idNode.irNodeId, 
                                        filePath: mod.filePath 
                                    });
                                }
                            }
                        }
                    }
                } else if (declNode.type === 'FunctionDeclaration' || declNode.type === 'ClassDeclaration') {
                    if (declNode.props.id && declNode.props.id.type === 'ref') {
                        const idNode = declNode.children.find(c => c.irNodeId === declNode.props.id.irNodeId);
                        if (idNode && idNode.type === 'Identifier') {
                            context.allTopLevelDecls.set(idNode.irNodeId, { 
                                varName: idNode.props.name as string, 
                                declId: idNode.irNodeId, 
                                filePath: mod.filePath 
                            });
                        }
                    }
                }
            };

            for (const ref of bodyRefs) {
                if (!ref || ref.type !== 'ref') continue;
                const child = fileProgram.children.find(c => c.irNodeId === ref.irNodeId);
                if (!child) continue;

                extractFromDecl(child);

                if (child.type === 'ExportNamedDeclaration' || child.type === 'ExportDefaultDeclaration') {
                    const declRef = child.props['declaration'];
                    if (declRef && declRef.type === 'ref') {
                        const declNode = child.children.find(c => c.irNodeId === declRef.irNodeId);
                        if (declNode) extractFromDecl(declNode);
                    }
                }
            }
        }
    }
}
