import { IRNode, IdentifierIR, VariableDeclaratorIR, AssignmentExpressionIR, UpdateExpressionIR, MemberExpressionIR, NumericLiteralIR, StringLiteralIR, BooleanLiteralIR } from '../../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../../../1_domain/state/CompilationState';
import { TransformRule } from '../../../interface/TransformRule';


type LiteralIR = NumericLiteralIR | StringLiteralIR | BooleanLiteralIR;

export const ConstantPropagationRule: TransformRule = {
    id: 'micro:constant-propagation',
    type: 'micro',
    name: '定数伝播 (Constant Propagation)',
    description: '不変な定数の参照を、直接そのリテラル値に書き換えて展開します。',
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

        if (!sourceNode) return false;
        if (sourceNode.type !== 'NumericLiteral' && sourceNode.type !== 'StringLiteral' && sourceNode.type !== 'BooleanLiteral') {
            return false;
        }

        return true;
    },
    candidates: (node: IRNode, state: CompilationState) => {
        const genId = () => state.services.generateId!('ir_cst');
        const snapshot = state.analysisSnapshot!;
        const identNode = node as IdentifierIR;
        const a_decl = snapshot.refToDeclMap.get(identNode.irNodeId)!;
        const a_defs = snapshot.getReachingDefinitions(identNode.irNodeId, a_decl);
        const defId = Array.from(a_defs)[0];
        const defNode = snapshot.nodeMap.get(defId)!;
        
        let sourceNode: LiteralIR | null = null;
        if (defNode.type === 'VariableDeclarator') {
            sourceNode = defNode.children.find(c => c.irNodeId === (defNode as VariableDeclaratorIR).props.init?.irNodeId) as LiteralIR;
        } else {
            sourceNode = defNode.children.find(c => c.irNodeId === (defNode as AssignmentExpressionIR).props.right?.irNodeId) as LiteralIR;
        }

        const newNode: LiteralIR = {
            ...sourceNode,
            irNodeId: genId(),
            children: []
        };
        console.debug(`[TransformRule] ${ConstantPropagationRule.id} matched on Identifier. Propagating constant ${String(newNode.props.value)} into ${identNode.props.name}.`);
        return [newNode];
    }
};
