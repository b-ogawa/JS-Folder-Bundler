import { IRRoot, IRNode } from '../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { StatementInfo } from '../types';
import { IRTraverser } from '../../../source_analyzer/ir_converter/IRTraverser';
import { COMPILER_CONSTANTS } from '../../../utils/Constants';
import { ConstantResolver } from '../../../source_analyzer/scope_analyzer/ConstantResolver';
import { WorkerDetector } from '../../dependency_extractor/WorkerDetector';

export class TopLevelAnalyzer {
    /**
     * 無名 export default を変数宣言に正規化します。
     * 例: export default function() {} -> const _default_anon_xxx = function() {}; export default _default_anon_xxx;
     * 参照一貫性を保つため、リンキング前の事前抽出段階でこれを完了させておきます。
     */
    public static normalizeAnonymousExports(tree: IRRoot, getBase: (p: string) => string): void {
        const fileProgram = tree.children[0]?.children?.find(c => c.type === 'Program');
        if (!fileProgram) return;

        const bodyRefs = fileProgram.props['body'];
        if (!Array.isArray(bodyRefs)) return;

        const moduleBase = getBase(tree.filePath);

        for (let i = 0; i < bodyRefs.length; i++) {
            const ref = bodyRefs[i];
            if (!ref || ref.type !== 'ref') continue;
            const child = fileProgram.children.find(c => c.irNodeId === ref.irNodeId);
            if (!child) continue;

            if (child.type === 'ExportDefaultDeclaration') {
                const declRef = child.props['declaration'];
                if (declRef && declRef.type === 'ref') {
                    const declNode = child.children.find(c => c.irNodeId === declRef.irNodeId);
                    if (declNode) {
                        let isAnonymous = false;
                        let idNode: IRNode | undefined;

                        if (declNode.type === 'Identifier') {
                            isAnonymous = false;
                            idNode = declNode;
                        } else if (declNode.type === 'FunctionDeclaration' || declNode.type === 'ClassDeclaration') {
                            if (declNode.props.id && declNode.props.id.type === 'ref') {
                                idNode = declNode.children.find(c => c.irNodeId === declNode.props.id.irNodeId);
                            }
                            if (!idNode) isAnonymous = true;
                        } else {
                            isAnonymous = true;
                        }

                        if (isAnonymous) {
                            const suffix = `_module_${moduleBase.replace(/[^a-zA-Z0-9_]/g, '_')}`;
                            const virtualVarId = `virtual_decl_default_${suffix}`;
                            const virtualIdNodeId = `virtual_id_default_${suffix}`;
                            const virtualDecltorId = `virtual_decltor_default_${suffix}`;

                            if (declNode.type === 'FunctionDeclaration') declNode.type = 'FunctionExpression';
                            else if (declNode.type === 'ClassDeclaration') declNode.type = 'ClassExpression';

                            const virtualIdNode: IRNode = { type: 'Identifier', irNodeId: virtualIdNodeId, props: { name: `_default_anon${suffix}` }, children: [] };
                            const virtualDeclarator: IRNode = {
                                type: 'VariableDeclarator', irNodeId: virtualDecltorId,
                                props: { id: { type: 'ref', irNodeId: virtualIdNodeId }, init: { type: 'ref', irNodeId: declNode.irNodeId } },
                                children: [virtualIdNode, declNode]
                            };
                            const virtualVarDecl: IRNode = {
                                type: 'VariableDeclaration', irNodeId: virtualVarId,
                                props: { kind: 'const', declarations: [{ type: 'ref', irNodeId: virtualDecltorId }] },
                                children: [virtualDeclarator]
                            };

                            fileProgram.children.push(virtualVarDecl);
                            bodyRefs[i] = { type: 'ref', irNodeId: virtualVarId };

                            if (tree.scopeInfo) {
                                tree.scopeInfo.bindings.set(virtualIdNodeId, { name: `_default_anon${suffix}`, scopeId: 'root', references: [] });
                            }
                        }
                    }
                }
            }
        }
    }

    public static analyze(
        tree: IRRoot,
        refToDeclMap: Map<string, string>
    ): Map<string, StatementInfo> {
        const statements = new Map<string, StatementInfo>();
        const fileProgram = tree.children[0]?.children?.find(c => c.type === 'Program');
        if (!fileProgram) return statements;

        const bodyRefs = fileProgram.props['body'];
        if (!Array.isArray(bodyRefs)) return statements;

        const collectReferencesInNode = (node: IRNode, refs: Set<string>, defines: Set<string>) => {
            if (node.type === 'Identifier') {
                const declId = refToDeclMap.get(node.irNodeId);
                if (declId && declId !== node.irNodeId && !defines.has(declId)) {
                    refs.add(declId);
                }
            }
            if (node.children) {
                for (const child of node.children) {
                    collectReferencesInNode(child, refs, defines);
                }
            }
        };

        const extractIdentifiersFromPattern = (n: IRNode, defines: Set<string>) => {
            if (!n) return;
            if (n.type === 'Identifier') {
                defines.add(n.irNodeId);
                return;
            }
            if (n.type === 'ObjectPattern') {
                const properties = n.props.properties || [];
                for (const propRef of properties) {
                    if (propRef && propRef.type === 'ref') {
                        const propNode = n.children.find(c => c.irNodeId === propRef.irNodeId);
                        if (propNode) {
                            if (propNode.type === 'Property' || propNode.type === 'ObjectProperty') {
                                const valRef = propNode.props.value;
                                if (valRef && valRef.type === 'ref') {
                                    const valNode = propNode.children.find(c => c.irNodeId === valRef.irNodeId);
                                    if (valNode) {
                                        extractIdentifiersFromPattern(valNode, defines);
                                    }
                                }
                            } else if (propNode.type === 'RestElement') {
                                const argRef = propNode.props.argument;
                                if (argRef && argRef.type === 'ref') {
                                    const argNode = propNode.children.find(c => c.irNodeId === argRef.irNodeId);
                                    if (argNode) {
                                        extractIdentifiersFromPattern(argNode, defines);
                                    }
                                }
                            }
                        }
                    }
                }
            } else if (n.type === 'ArrayPattern') {
                const elements = n.props.elements || [];
                for (const elRef of elements) {
                    if (elRef && elRef.type === 'ref') {
                        const elNode = n.children.find(c => c.irNodeId === elRef.irNodeId);
                        if (elNode) {
                            extractIdentifiersFromPattern(elNode, defines);
                        }
                    }
                }
            } else if (n.type === 'AssignmentPattern') {
                const leftRef = n.props.left;
                if (leftRef && leftRef.type === 'ref') {
                    const leftNode = n.children.find(c => c.irNodeId === leftRef.irNodeId);
                    if (leftNode) {
                        extractIdentifiersFromPattern(leftNode, defines);
                    }
                }
            } else if (n.type === 'RestElement') {
                const argRef = n.props.argument;
                if (argRef && argRef.type === 'ref') {
                    const argNode = n.children.find(c => c.irNodeId === argRef.irNodeId);
                    if (argNode) {
                        extractIdentifiersFromPattern(argNode, defines);
                    }
                }
            }
        };

        const collectDefinesInNode = (node: IRNode, defines: Set<string>) => {
            if (node.type === 'VariableDeclaration') {
                for (const decltorRef of node.props.declarations || []) {
                    if (decltorRef && decltorRef.type === 'ref') {
                        const decltorNode = node.children.find(c => c.irNodeId === decltorRef.irNodeId);
                        if (decltorNode && decltorNode.props.id && decltorNode.props.id.type === 'ref') {
                            const idNode = decltorNode.children.find(c => c.irNodeId === decltorNode.props.id.irNodeId);
                            if (idNode) {
                                extractIdentifiersFromPattern(idNode, defines);
                            }
                        }
                    }
                }
            } else if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
                if (node.props.id && node.props.id.type === 'ref') {
                    const idNode = node.children.find(c => c.irNodeId === node.props.id.irNodeId);
                    if (idNode && idNode.type === 'Identifier') {
                        defines.add(idNode.irNodeId);
                    }
                }
            } else if (node.type === 'ImportDeclaration') {
                const specifiers = node.props.specifiers || [];
                for (const specRef of specifiers) {
                    if (specRef && specRef.type === 'ref') {
                        const specNode = node.children.find(c => c.irNodeId === specRef.irNodeId);
                        if (specNode) {
                            const localRef = specNode.props.local;
                            if (localRef && localRef.type === 'ref') {
                                defines.add(localRef.irNodeId);
                            }
                        }
                    }
                }
            }
        };

        for (const ref of bodyRefs) {
            if (!ref || ref.type !== 'ref') continue;
            const child = fileProgram.children.find(c => c.irNodeId === ref.irNodeId);
            if (!child) continue;

            let actualNode = child;
            let type: 'Declaration' | 'SideEffect' = 'SideEffect';
            const defines = new Set<string>();

            if (child.type === 'ExportNamedDeclaration' || child.type === 'ExportDefaultDeclaration') {
                const declRef = child.props['declaration'];
                if (declRef && declRef.type === 'ref') {
                    const declNode = child.children.find(c => c.irNodeId === declRef.irNodeId);
                    if (declNode) {
                        actualNode = declNode;
                    }
                }
            }

            if (child.type === 'ExpressionStatement') {
                const exprRef = child.props['expression'];
                if (exprRef && exprRef.type === 'ref') {
                    const exprNode = child.children.find(c => c.irNodeId === exprRef.irNodeId);
                    if (exprNode && (exprNode.type === 'StringLiteral' || exprNode.type === 'Literal')) {
                        continue;
                    }
                }
            }

            let sideEffectImportPath: string | undefined;

            let hasSideEffectInit = false;
            if (actualNode.type === 'VariableDeclaration') {
                const checkSideEffect = (n: IRNode): boolean => {
                    if (!n) return false;
                    if (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' || n.type === 'ClassExpression') {
                        return false;
                    }
                    if (COMPILER_CONSTANTS.SIDE_EFFECT_NODE_TYPES.has(n.type)) {
                        return true;
                    }
                    if (n.children) {
                        for (const c of n.children) {
                            if (checkSideEffect(c)) return true;
                        }
                    }
                    return false;
                };

                for (const declRef of actualNode.props.declarations || []) {
                    if (declRef && declRef.type === 'ref') {
                        const declNode = actualNode.children.find(c => c.irNodeId === declRef.irNodeId);
                        if (declNode && declNode.type === 'VariableDeclarator') {
                            const initRef = declNode.props.init;
                            if (initRef && initRef.type === 'ref') {
                                const initNode = declNode.children.find(c => c.irNodeId === initRef.irNodeId);
                                if (initNode && checkSideEffect(initNode)) {
                                    hasSideEffectInit = true;
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            if (child.type === 'ImportDeclaration') {
                const specifiers = child.props.specifiers || [];
                if (specifiers.length === 0) {
                    type = 'SideEffect';
                    const sourceRef = child.props['source'];
                    if (sourceRef && sourceRef.type === 'ref') {
                        const sourceNode = child.children.find(c => c.irNodeId === sourceRef.irNodeId);
                        if (sourceNode) {
                            sideEffectImportPath = sourceNode.props['value'] as string;
                        }
                    }
                } else {
                    type = 'Declaration';
                    collectDefinesInNode(child, defines);
                }
            } else if (child.type === 'ExportNamedDeclaration' && !child.props['declaration']) {
                type = 'Declaration';
            } else if (
                actualNode.type === 'FunctionDeclaration' ||
                actualNode.type === 'ClassDeclaration'
            ) {
                type = 'Declaration';
                collectDefinesInNode(actualNode, defines);
            } else if (actualNode.type === 'VariableDeclaration') {
                type = hasSideEffectInit ? 'SideEffect' : 'Declaration';
                collectDefinesInNode(actualNode, defines);
            }

            const references = new Set<string>();
            collectReferencesInNode(child, references, defines);

            const chunkReferences = new Set<string>();
            const classicImports: string[] = [];
            const dynamicImports: string[] = [];
            
            const resolver = new ConstantResolver(tree, refToDeclMap);

            IRTraverser.traverse(child, {
                ImportExpression: (n: IRNode) => {
                    const sourceRef = n.props['source'];
                    if (sourceRef && sourceRef.type === 'ref') {
                        const argNode = n.children.find(c => c.irNodeId === sourceRef.irNodeId);
                        if (argNode) {
                            const resolvedArg = resolver.resolve(argNode);
                            if (resolvedArg.type === 'StringLiteral' || resolvedArg.type === 'Literal') {
                                const pathVal = resolvedArg.props['value'] as string;
                                if (pathVal && !/^(https?:)?\/\//i.test(pathVal)) dynamicImports.push(pathVal);
                            }
                        }
                    }
                },
                NewExpression: (n: IRNode) => {
                    const ref = WorkerDetector.detectWorkerPattern(n, resolver);
                    if (ref && ref.rawPath && !/^(https?:)?\/\//i.test(ref.rawPath)) {
                        chunkReferences.add(ref.rawPath);
                    }
                },
                CallExpression: (n: IRNode) => {
                    const workerRef = WorkerDetector.detectWorkerPattern(n, resolver);
                    if (workerRef) {
                        if (workerRef.rawPath && !/^(https?:)?\/\//i.test(workerRef.rawPath)) {
                            chunkReferences.add(workerRef.rawPath);
                        }
                        return;
                    }

                    const calleeRef = n.props['callee'];
                    if (calleeRef && calleeRef.type === 'ref') {
                        const calleeNode = n.children.find(c => c.irNodeId === calleeRef.irNodeId);
                        if (calleeNode && calleeNode.type === 'Import') {
                            const args = n.props['arguments'] || [];
                            if (args.length > 0 && args[0].type === 'ref') {
                                const argNode = n.children.find(c => c.irNodeId === args[0].irNodeId);
                                if (argNode) {
                                    const resolvedArg = resolver.resolve(argNode);
                                    if (resolvedArg.type === 'StringLiteral' || resolvedArg.type === 'Literal') {
                                        const pathVal = resolvedArg.props['value'] as string;
                                        if (pathVal && !/^(https?:)?\/\//i.test(pathVal)) dynamicImports.push(pathVal);
                                    }
                                }
                            }
                        } else if (calleeNode && calleeNode.type === 'Identifier' && calleeNode.props['name'] === 'importScripts') {
                            for (const argRef of n.props['arguments'] || []) {
                                if (argRef && argRef.type === 'ref') {
                                    const argNode = n.children.find(c => c.irNodeId === argRef.irNodeId);
                                    if (argNode) {
                                        const resolvedArg = resolver.resolve(argNode);
                                        if (resolvedArg.type === 'StringLiteral' || resolvedArg.type === 'Literal') {
                                            const pathVal = resolvedArg.props['value'] as string;
                                            if (pathVal && !/^(https?:)?\/\//i.test(pathVal)) classicImports.push(pathVal);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            statements.set(child.irNodeId, {
                irNodeId: child.irNodeId,
                type,
                defines,
                references,
                node: child,
                chunkReferences,
                sideEffectImportPath,
                classicImports,
                dynamicImports
            });
        }

        return statements;
    }
}
