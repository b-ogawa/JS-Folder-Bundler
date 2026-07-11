import { IRNode } from '../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { ModuleInfo } from '../types';

export class TreePruner {
    /**
     * 到達可能と判定された識別子・ノードの ID 集合 (markedNodeIds) に基づき、
     * 各モジュールの AST から不要なノードを排除します。
     */
    public static prune(
        modules: Map<string, ModuleInfo>,
        markedNodeIds: Set<string>,
        logger?: (log: { type: 'info'; msg: string }) => void
    ): void {
        for (const [modName, mod] of modules.entries()) {
            const fileProgram = mod.tree.children[0]?.children?.find(c => c.type === 'Program');
            if (!fileProgram) continue;

            const bodyRefs = fileProgram.props['body'];
            if (!Array.isArray(bodyRefs)) continue;

            const newBodyRefs: any[] = [];
            const newChildren: IRNode[] = [];
            let prunedCount = 0;

            for (const ref of bodyRefs) {
                if (!ref || ref.type !== 'ref') continue;
                
                // 到達不能なトップレベル文は除外
                if (!markedNodeIds.has(ref.irNodeId)) {
                    const targetChild = fileProgram.children.find(c => c.irNodeId === ref.irNodeId);
                    if (logger && targetChild) {
                        let nameInfo = '';
                        if (targetChild.type === 'VariableDeclaration') {
                            nameInfo = ' (Variable)';
                        } else if (targetChild.type === 'FunctionDeclaration') {
                            nameInfo = ` (Function ${targetChild.children[0]?.props.name})`;
                        } else if (targetChild.type === 'ClassDeclaration') {
                            nameInfo = ` (Class ${targetChild.children[0]?.props.name})`;
                        }
                        logger({ type: 'info', msg: `[TreePruner] ✂️ Removing dead node: ${targetChild.type}${nameInfo} in ${modName}` });
                    }
                    prunedCount++;
                    continue;
                }

                const child = fileProgram.children.find(c => c.irNodeId === ref.irNodeId);
                if (!child) continue;

                // インポート宣言の場合、使用されている specifier のみ残す
                if (child.type === 'ImportDeclaration') {
                    const specifiers = child.props['specifiers'] || [];
                    const newSpecRefs: any[] = [];
                    const newSpecChildren: IRNode[] = [];

                    for (const specRef of specifiers) {
                        if (specRef && specRef.type === 'ref') {
                            const specNode = child.children.find(c => c.irNodeId === specRef.irNodeId);
                            if (specNode) {
                                const localRef = specNode.props['local'];
                                if (localRef && localRef.type === 'ref') {
                                    // ローカル変数 ID、もしくは specifier 自体の ID が到達しているか
                                    if (markedNodeIds.has(localRef.irNodeId) || markedNodeIds.has(specNode.irNodeId)) {
                                        newSpecRefs.push(specRef);
                                        newSpecChildren.push(specNode);
                                    }
                                }
                            }
                        }
                    }

                    // 使用されている specifier が一切ない場合は、このインポート宣言自体を完全に削除
                    if (newSpecRefs.length === 0 && specifiers.length > 0) {
                        if (logger) logger({ type: 'info', msg: `[TreePruner] Removing unused Import in ${modName} (No active specifiers remaining)` });
                        prunedCount++;
                        continue;
                    }

                    // 有効なspecifierが存在するインポートの存続記録
                    if (newSpecRefs.length > 0 && logger) {
                        const sourceNode = child.children.find(c => c.irNodeId === child.props['source']?.irNodeId);
                        logger({ type: 'info', msg: `[TreePruner] Kept Import in ${modName} (Source: "${sourceNode?.props.value || 'unknown'}") with ${newSpecRefs.length} active specifiers.` });
                    }

                    child.props['specifiers'] = newSpecRefs;
                    child.children = child.children.filter(c => {
                        const isSpecifier = specifiers.some((s: any) => s.irNodeId === c.irNodeId);
                        if (isSpecifier) {
                            return newSpecRefs.some((s: any) => s.irNodeId === c.irNodeId);
                        }
                        return true;
                    });
                }

                // 名前付きエクスポート宣言（再エクスポート等含む）の指定子剪定
                if (child.type === 'ExportNamedDeclaration' && !child.props['declaration']) {
                    const specifiers = child.props['specifiers'] || [];
                    const newSpecRefs: any[] = [];

                    for (const specRef of specifiers) {
                        if (specRef && specRef.type === 'ref') {
                            const specNode = child.children.find(c => c.irNodeId === specRef.irNodeId);
                            if (specNode) {
                                const exportedRef = specNode.props['exported'] || specNode.props['local'];
                                if (exportedRef && exportedRef.type === 'ref') {
                                    if (markedNodeIds.has(exportedRef.irNodeId) || markedNodeIds.has(specNode.irNodeId)) {
                                        newSpecRefs.push(specRef);
                                    }
                                }
                            }
                        }
                    }

                    if (newSpecRefs.length === 0 && specifiers.length > 0) {
                        if (logger) logger({ type: 'info', msg: `[TreePruner] ✂️ Removing unused Export in ${modName}` });
                        prunedCount++;
                        continue;
                    }

                    child.props['specifiers'] = newSpecRefs;
                    child.children = child.children.filter(c => {
                        const isSpecifier = specifiers.some((s: any) => s.irNodeId === c.irNodeId);
                        if (isSpecifier) {
                            return newSpecRefs.some((s: any) => s.irNodeId === c.irNodeId);
                        }
                        return true;
                    });
                }

                newBodyRefs.push(ref);
                newChildren.push(child);
            }

            if (logger && prunedCount > 0) {
                logger({ type: 'info', msg: `[TreePruner] File ${modName}: Pruned ${prunedCount} statements. Remaining: ${newBodyRefs.length}` });
            }

            fileProgram.props['body'] = newBodyRefs;
            fileProgram.children = newChildren;
        }
    }
}
