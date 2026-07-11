import { IRNode, IdentifierIR, VariableDeclaratorIR, AssignmentExpressionIR, UpdateExpressionIR, MemberExpressionIR } from '../../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../../../1_domain/state/CompilationState';
import { TransformRule } from '../../../interface/TransformRule';


export const CopyPropagationRule: TransformRule = {
    id: 'micro:copy-propagation',
    type: 'micro',
    name: 'コピー伝播 (Copy Propagation)',
    description: '変数から変数への単純コピー（例: a = b）がある場合、直接元の変数に書き換えます。',
    defaultEnabled: true,
    match: (node: IRNode, state: CompilationState): node is IdentifierIR => {
        if (node.type !== 'Identifier') return false;
        if (!state.analysisSnapshot) return false;

        const identNode = node as IdentifierIR;
        const snapshot = state.analysisSnapshot;
        
        const parentId = snapshot.parentMap.get(identNode.irNodeId);
        if (!parentId) return false;
        const parent = snapshot.nodeMap.get(parentId);
        if (!parent) return false;
        
        if (parent.type === 'VariableDeclarator' && (parent as VariableDeclaratorIR).props.id?.irNodeId === identNode.irNodeId) return false;
        if (parent.type === 'AssignmentExpression' && (parent as AssignmentExpressionIR).props.left?.irNodeId === identNode.irNodeId) return false;
        if (parent.type === 'UpdateExpression' && (parent as UpdateExpressionIR).props.argument?.irNodeId === identNode.irNodeId) return false;
        if (parent.type === 'MemberExpression' && (parent as MemberExpressionIR).props.property?.irNodeId === identNode.irNodeId && !(parent as MemberExpressionIR).props.computed) return false;

        const a_decl = snapshot.refToDeclMap.get(identNode.irNodeId);
        if (!a_decl) return false; 

        if (snapshot.escapedVars.has(a_decl)) return false; 

        const a_defs = snapshot.getReachingDefinitions(identNode.irNodeId, a_decl);
        if (a_defs.size !== 1) return false;
        
        const defId = Array.from(a_defs)[0];
        const defNode = snapshot.nodeMap.get(defId);
        if (!defNode) return false;

        let sourceNode: IRNode | null = null;
        if (defNode.type === 'VariableDeclarator') {
            const dNode = defNode as VariableDeclaratorIR;
            const initRef = dNode.props.init;
            if (initRef) {
                sourceNode = dNode.children.find(c => c.irNodeId === initRef.irNodeId) || null;
            }
        } else if (defNode.type === 'AssignmentExpression') {
            const aNode = defNode as AssignmentExpressionIR;
            const rightRef = aNode.props.right;
            if (rightRef) {
                sourceNode = aNode.children.find(c => c.irNodeId === rightRef.irNodeId) || null;
            }
        }

        if (!sourceNode || sourceNode.type !== 'Identifier') return false;

        const b_decl = snapshot.refToDeclMap.get(sourceNode.irNodeId);
        if (!b_decl) return false;

        if (snapshot.escapedVars.has(b_decl)) return false; 

        const r_D = snapshot.getReachingDefinitions(defId, b_decl);
        const r_U = snapshot.getReachingDefinitions(identNode.irNodeId, b_decl);

        if (r_D.size !== r_U.size) return false;
        for (const item of r_D) {
            if (!r_U.has(item)) return false;
        }

        return true;
    },
    candidates: (node: IRNode, state: CompilationState) => {
        const genId = () => state.services.generateId!('ir_cp');
        const snapshot = state.analysisSnapshot!;
        const identNode = node as IdentifierIR;
        const a_decl = snapshot.refToDeclMap.get(identNode.irNodeId)!;
        const a_defs = snapshot.getReachingDefinitions(identNode.irNodeId, a_decl);
        const defId = Array.from(a_defs)[0];
        const defNode = snapshot.nodeMap.get(defId)!;
        
        let sourceNode: IdentifierIR | null = null;
        if (defNode.type === 'VariableDeclarator') {
            sourceNode = defNode.children.find(c => c.irNodeId === (defNode as VariableDeclaratorIR).props.init?.irNodeId) as IdentifierIR;
        } else {
            sourceNode = defNode.children.find(c => c.irNodeId === (defNode as AssignmentExpressionIR).props.right?.irNodeId) as IdentifierIR;
        }

        const b_decl = snapshot.refToDeclMap.get(sourceNode.irNodeId);

        const newNode: IdentifierIR = {
            type: 'Identifier',
            irNodeId: genId(),
            props: { name: sourceNode.props.name, _declId: b_decl },
            children: []
        };
        console.debug(`[TransformRule] ${CopyPropagationRule.id} matched on Identifier. Propagating ${sourceNode.props.name} into ${identNode.props.name}.`);
        return [newNode];
    }
};
