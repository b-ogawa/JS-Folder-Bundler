import { IRNode, ProgramIR, VariableDeclarationIR, VariableDeclaratorIR, IdentifierIR } from '../../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../../../1_domain/state/CompilationState';
import { TransformRule } from '../../../interface/TransformRule';


export const GlobalAliasingRule: TransformRule = {
    id: 'macro:global-aliasing',
    type: 'macro',
    name: 'グローバル参照のエイリアス抽出',
    description: '頻出するグローバルオブジェクトへの参照をエイリアス変数にまとめます。',
    defaultEnabled: true,
    match: (node: IRNode, state: CompilationState): node is ProgramIR => {
        if (node.type !== 'Program') return false;
        
        const snapshot = state.analysisSnapshot;
        if (!snapshot) return false;

        const globalCounts = new Map<string, number>();
        for (const [id, irNode] of snapshot.nodeMap.entries()) {
            if (irNode.type === 'Identifier') {
                const name = irNode.props.name;
                if (snapshot.escapedVars.has(id) && !snapshot.refToDeclMap.has(id)) {
                    if (name.length > 2) {
                        globalCounts.set(name, (globalCounts.get(name) || 0) + 1);
                    }
                }
            }
        }

        let canAlias = false;
        for (const [name, count] of globalCounts.entries()) {
            const L = name.length;
            if (count * (L - 1) > L + 4) {
                canAlias = true;
                break;
            }
        }
        
        return canAlias;
    },
    candidates: (node: IRNode, state: CompilationState) => {
        const genId = () => state.services.generateId!('ir_alias');
        const prog = node as ProgramIR;
        const snapshot = state.analysisSnapshot!;

        const globalCounts = new Map<string, { count: number; ids: Set<string> }>();
        for (const [id, irNode] of snapshot.nodeMap.entries()) {
            if (irNode.type === 'Identifier') {
                const name = irNode.props.name;
                if (snapshot.escapedVars.has(id) && !snapshot.refToDeclMap.has(id) && name.length > 2) {
                    if (!globalCounts.has(name)) globalCounts.set(name, { count: 0, ids: new Set() });
                    globalCounts.get(name)!.count++;
                    globalCounts.get(name)!.ids.add(id);
                }
            }
        }

        const targets = new Map<string, { alias: string; declId: string }>();
        let aliasIndex = 0;
        const genAlias = () => `_gAlias_${aliasIndex++}`;

        const targetIds = new Map<string, { alias: string; declId: string }>();

        for (const [name, data] of globalCounts.entries()) {
            const L = name.length;
            if (data.count * (L - 1) > L + 4) {
                const alias = genAlias();
                const declId = genId();
                targets.set(name, { alias, declId });
                for (const id of data.ids) {
                    targetIds.set(id, { alias, declId });
                }
            }
        }

        if (targets.size === 0) return [];

        // 元のNode IDを維持したまま、安全にツリーをディープクローンする
        const cloneNode = (n: IRNode): IRNode => {
            const newChildren: IRNode[] = [];
            for (const child of n.children) {
                newChildren.push(cloneNode(child));
            }

            let newProps = { ...n.props };
            // 配列（bodyやargumentsなど）の浅いコピー
            for (const [key, val] of Object.entries(newProps)) {
                if (Array.isArray(val)) {
                    newProps[key] = [...val];
                }
            }

            if (n.type === 'Identifier' && targetIds.has(n.irNodeId)) {
                const info = targetIds.get(n.irNodeId)!;
                newProps.name = info.alias;
                newProps._declId = info.declId; // DCEに参照されていることを認識させる
            }

            return {
                type: n.type,
                irNodeId: n.irNodeId, // IDを維持
                props: newProps,
                children: newChildren
            };
        };

        const newProgBase = cloneNode(prog) as ProgramIR;
        
        const decls: IRNode[] = [];
        const declRefs: any[] = [];
        
        for (const [name, data] of targets.entries()) {
            const aliasIdNode: IdentifierIR = {
                type: 'Identifier',
                irNodeId: data.declId,
                props: { name: data.alias },
                children: []
            };
            const initNode: IdentifierIR = {
                type: 'Identifier',
                irNodeId: genId(),
                props: { name: name },
                children: []
            };
            const declaratorNode: VariableDeclaratorIR = {
                type: 'VariableDeclarator',
                irNodeId: genId(),
                props: {
                    id: { type: 'ref', irNodeId: aliasIdNode.irNodeId },
                    init: { type: 'ref', irNodeId: initNode.irNodeId }
                },
                children: [aliasIdNode, initNode]
            };
            decls.push(declaratorNode);
            declRefs.push({ type: 'ref', irNodeId: declaratorNode.irNodeId });
        }

        const varDeclNode: VariableDeclarationIR = {
            type: 'VariableDeclaration',
            irNodeId: genId(),
            props: {
                kind: 'const',
                declarations: declRefs
            },
            children: decls
        };

        newProgBase.children.unshift(varDeclNode);
        newProgBase.props.body.unshift({ type: 'ref', irNodeId: varDeclNode.irNodeId });

        console.debug(`[TransformRule] ${GlobalAliasingRule.id} matched. Hoisted ${targets.size} globals.`);
        return [newProgBase];
    }
};
