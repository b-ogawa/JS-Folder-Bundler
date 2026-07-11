import { IRNode } from '../../../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { PipelineStage } from '../../../../../infra/Pipeline';
import { MergeContext } from '../MergeContext';

export class ReplaceDynamicImportsStage implements PipelineStage<MergeContext> {
    public readonly name = 'ReplaceDynamicImportsStage';

    execute(context: MergeContext): void {
        for (const mod of context.modules.values()) {
            const refToDeclMap = context.refToDeclMaps.get(mod.filePath) || new Map<string, string>();
            const state = { counter: 0 };
            this.replaceDynamicImports(
                mod.tree,
                refToDeclMap,
                mod.filePath,
                context,
                state
            );
        }
    }

    private replaceDynamicImports(
        node: IRNode,
        refToDeclMap: Map<string, string>,
        currentFilePath: string,
        context: MergeContext,
        state: { counter: number }
    ) {
        if (!node.children) return;

        for (let i = 0; i < node.children.length; i++) {
            const child = node.children[i];
            const argNode = this.getDynamicImportArg(child);

            if (argNode) {
                const modulePath = argNode.props['value'] as string;
                if (modulePath && !context.isExternalModule(modulePath, currentFilePath)) {
                    const resolvedPath = context.resolvePath(currentFilePath, modulePath);
                    const targetBase = context.getBase(resolvedPath);
                    context.dynamicImportedBases.add(targetBase);

                    const thunkName = `__dynamic_import_${targetBase.replace(/[^a-zA-Z0-9_]/g, '_')}`;
                    
                    let thunkDeclId = context.thunkDeclIdMap.get(thunkName);
                    if (!thunkDeclId) {
                        thunkDeclId = `thunk_decl_id_${targetBase.replace(/[^a-zA-Z0-9_]/g, '_')}`;
                        context.thunkDeclIdMap.set(thunkName, thunkDeclId);
                    }

                    const replacementNode = this.createPromiseThenDynamicImport(
                        thunkName,
                        state.counter++,
                        thunkDeclId,
                        context.parseTemplate
                    );
                    node.children[i] = replacementNode;

                    // 親のpropsの参照も置き換える
                    for (const key of Object.keys(node.props)) {
                        const prop = node.props[key];
                        if (prop && prop.type === 'ref' && prop.irNodeId === child.irNodeId) {
                            node.props[key] = { type: 'ref', irNodeId: replacementNode.irNodeId };
                        } else if (Array.isArray(prop)) {
                            for (let pIdx = 0; pIdx < prop.length; pIdx++) {
                                if (prop[pIdx] && prop[pIdx].type === 'ref' && prop[pIdx].irNodeId === child.irNodeId) {
                                    prop[pIdx] = { type: 'ref', irNodeId: replacementNode.irNodeId };
                                }
                            }
                        }
                    }
                }
            }

            const targetNode = node.children[i];
            this.replaceDynamicImports(targetNode, refToDeclMap, currentFilePath, context, state);
        }
    }

    private getDynamicImportArg(child: IRNode): IRNode | undefined {
        // 1. Babelの新しい ImportExpression 仕様への対応
        if (child.type === 'ImportExpression') {
            const sourceRef = child.props['source'];
            if (sourceRef && sourceRef.type === 'ref') {
                const arg = child.children.find(c => c.irNodeId === sourceRef.irNodeId);
                if (arg && (arg.type === 'StringLiteral' || arg.type === 'Literal')) {
                    return arg;
                }
            }
        } 
        // 2. 従来の CallExpression (callee: Import) 仕様への対応
        else if (child.type === 'CallExpression') {
            const calleeRef = child.props['callee'];
            if (calleeRef && calleeRef.type === 'ref') {
                const calleeNode = child.children.find(c => c.irNodeId === calleeRef.irNodeId);
                if (calleeNode && calleeNode.type === 'Import') {
                    const args = child.props['arguments'] || [];
                    if (args.length > 0 && args[0].type === 'ref') {
                        const arg = child.children.find(c => c.irNodeId === args[0].irNodeId);
                        if (arg && (arg.type === 'StringLiteral' || arg.type === 'Literal')) {
                            return arg;
                        }
                    }
                }
            }
        }
        return undefined;
    }

    private createPromiseThenDynamicImport(
        thunkName: string,
        counter: number,
        thunkDeclId: string,
        parseTemplate: (code: string) => IRNode[]
    ): IRNode {
        const code = `Promise.resolve().then(() => ${thunkName}());`;
        const astList = parseTemplate(code);
        const exprStmt = astList[0]; // ExpressionStatement
        
        const walk = (node: IRNode) => {
            if (node.type === 'Identifier' && node.props['name'] === thunkName) {
                node.props['_declId'] = thunkDeclId;
            }
            if (node.children) node.children.forEach(walk);
        };
        walk(exprStmt);

        const exprRef = exprStmt.props['expression'];
        return exprStmt.children.find(c => c.irNodeId === exprRef.irNodeId)!;
    }
}
