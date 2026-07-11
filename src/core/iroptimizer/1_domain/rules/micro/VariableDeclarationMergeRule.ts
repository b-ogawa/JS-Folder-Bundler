import { IRNode, BlockStatementIR, VariableDeclarationIR } from '../../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../../../1_domain/state/CompilationState';
import { TransformRule } from '../../../interface/TransformRule';

export const VariableDeclarationMergeRule: TransformRule = {
    id: 'micro:var-decl-merge',
    type: 'micro',
    name: '変数宣言の結合 (Variable Declaration Merge)',
    description: '連続する同じ種類(let/const)の変数宣言をカンマで結合します。',
    defaultEnabled: true,
    match: (node: IRNode, state: CompilationState): node is BlockStatementIR => {
        if (node.type !== 'BlockStatement' && node.type !== 'Program') return false;
        
        const bodyRefs = node.props['body'];
        if (!Array.isArray(bodyRefs) || bodyRefs.length < 2) return false;

        let consecutiveCount = 0;
        let lastKind: string | null = null;
        for (const ref of bodyRefs) {
            if (!ref || ref.type !== 'ref') continue;
            const child = node.children.find(c => c.irNodeId === ref.irNodeId);
            if (child && child.type === 'VariableDeclaration') {
                const kind = child.props['kind'];
                if (lastKind === kind) {
                    return true;
                }
                lastKind = kind;
                consecutiveCount = 1;
            } else {
                lastKind = null;
                consecutiveCount = 0;
            }
        }
        return false;
    },
    candidates: (node: IRNode, state: CompilationState) => {
        const genId = () => state.services.generateId!('ir_vd_merge');
        const blockNode = node as BlockStatementIR;
        const bodyRefs = blockNode.props['body'] as any[];
        
        const newBodyRefs: any[] = [];
        const newChildren: IRNode[] = [];
        
        let currentSequence: IRNode[] = [];
        let currentKind: string | null = null;

        const flushSequence = () => {
            if (currentSequence.length === 0) return;
            
            if (currentSequence.length === 1) {
                newBodyRefs.push({ type: 'ref', irNodeId: currentSequence[0].irNodeId });
                newChildren.push(currentSequence[0]);
            } else {
                // 複数の VariableDeclaration を 1つにまとめる
                const mergedDeclarations: any[] = [];
                const mergedChildren: IRNode[] = [];
                for (const decl of currentSequence) {
                    const declRefs = decl.props['declarations'] || [];
                    for (const dRef of declRefs) {
                        mergedDeclarations.push(dRef);
                        const dNode = decl.children.find(c => c.irNodeId === dRef.irNodeId);
                        if (dNode) mergedChildren.push(dNode);
                    }
                }
                
                const mergedVarDeclNode: VariableDeclarationIR = {
                    type: 'VariableDeclaration',
                    irNodeId: genId(),
                    props: {
                        kind: currentKind as any,
                        declarations: mergedDeclarations
                    },
                    children: mergedChildren
                };
                
                newBodyRefs.push({ type: 'ref', irNodeId: mergedVarDeclNode.irNodeId });
                newChildren.push(mergedVarDeclNode);
            }
            currentSequence = [];
            currentKind = null;
        };

        for (const ref of bodyRefs) {
            if (!ref || ref.type !== 'ref') continue;
            const child = blockNode.children.find(c => c.irNodeId === ref.irNodeId);
            if (!child) continue;

            if (child.type === 'VariableDeclaration') {
                const kind = child.props['kind'];
                if (currentKind === null || currentKind === kind) {
                    currentKind = kind;
                    currentSequence.push(child);
                } else {
                    flushSequence();
                    currentKind = kind;
                    currentSequence.push(child);
                }
            } else {
                flushSequence();
                newBodyRefs.push(ref);
                newChildren.push(child);
            }
        }
        flushSequence();

        const newNode: IRNode = {
            ...blockNode,
            irNodeId: genId(),
            props: { ...blockNode.props, body: newBodyRefs },
            children: newChildren
        };

        console.debug(`[TransformRule] ${VariableDeclarationMergeRule.id} matched. Compressed consecutive variable declarations.`);
        return [newNode];
    }
};
