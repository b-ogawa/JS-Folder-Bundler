import { IRNode, IfStatementIR, ConditionalExpressionIR, NumericLiteralIR, StringLiteralIR, BooleanLiteralIR, GenericIRNode } from '../../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../../../1_domain/state/CompilationState';
import { TransformRule } from '../../../interface/TransformRule';


type LiteralIR = NumericLiteralIR | StringLiteralIR | BooleanLiteralIR;

export const UnreachableCodeEliminationRule: TransformRule = {
    id: 'micro:unreachable-code-elimination',
    type: 'micro',
    name: '到達不能コード削除 (Unreachable Code Elimination)',
    description: 'if (true) や if (false) の分岐を静的に判定し、通らない方のコードブロックを除去します。',
    defaultEnabled: true,
    match: (node: IRNode, state: CompilationState): boolean => {
        if (node.type !== 'IfStatement' && node.type !== 'ConditionalExpression') return false;

        const ifNode = node as IfStatementIR | ConditionalExpressionIR;
        const testRef = ifNode.props.test;
        if (!testRef) return false;

        const testNode = ifNode.children.find(c => c.irNodeId === testRef.irNodeId);
        if (!testNode) return false;

        if (testNode.type === 'NumericLiteral' || testNode.type === 'StringLiteral' || testNode.type === 'BooleanLiteral') {
            return true;
        }

        return false;
    },
    candidates: (node: IRNode, state: CompilationState) => {
        const genId = () => state.services.generateId!('ir_uce');
        const ifNode = node as (IfStatementIR | ConditionalExpressionIR);
        const testNode = ifNode.children.find(c => c.irNodeId === ifNode.props.test.irNodeId) as LiteralIR;
        
        const isTruthy = Boolean(testNode.props.value);
        
        if (isTruthy) {
            const consequentRef = ifNode.props.consequent;
            if (consequentRef) {
                const consequent = ifNode.children.find(c => c.irNodeId === consequentRef.irNodeId);
                if (consequent) {
                    console.debug(`[TransformRule] ${UnreachableCodeEliminationRule.id} matched on ${node.type}. Evaluated to true, replacing with consequent.`);
                    return [consequent];
                }
            }
        } else {
            const alternateRef = ifNode.props.alternate;
            if (alternateRef) {
                const alternate = ifNode.children.find(c => c.irNodeId === alternateRef.irNodeId);
                if (alternate) {
                    console.debug(`[TransformRule] ${UnreachableCodeEliminationRule.id} matched on ${node.type}. Evaluated to false, replacing with alternate.`);
                    return [alternate];
                }
            }
            
            // Evaluated to false and no alternate
            if (node.type === 'IfStatement') {
                console.debug(`[TransformRule] ${UnreachableCodeEliminationRule.id} matched on IfStatement without alternate. Evaluated to false, removing.`);
                const emptyNode: GenericIRNode = {
                    type: 'EmptyStatement',
                    irNodeId: genId(),
                    props: {},
                    children: []
                };
                return [emptyNode];
            } else if (node.type === 'ConditionalExpression') {
                // Should not happen as Ternary requires alternate, but just in case
                const emptyNode: GenericIRNode = {
                    type: 'Identifier', // Using Identifier 'undefined' as fallback for expression
                    irNodeId: genId(),
                    props: { name: 'undefined' },
                    children: []
                };
                return [emptyNode];
            }
        }
        
        return [];
    }
};
