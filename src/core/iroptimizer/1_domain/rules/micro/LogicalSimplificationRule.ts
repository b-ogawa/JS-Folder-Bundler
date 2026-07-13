import { IRNode, BinaryExpressionIR, LogicalExpressionIR, BooleanLiteralIR, IdentifierIR } from '../../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../../../1_domain/state/CompilationState';
import { TransformRule } from '../../../interface/TransformRule';


export const LogicalSimplificationRule: TransformRule = {
    id: 'micro:logical-simplification',
    type: 'micro',
    name: '論理式の代数的単純化',
    description: '論理式（&&, ||, == など）に対してブール代数の法則を適用し、不要なキャストや比較を削減します。',
    defaultEnabled: true,
    match: (node: IRNode, state: CompilationState): boolean => {
        if (node.type === 'BinaryExpression') {
            const bin = node as BinaryExpressionIR;
            const left = bin.children.find(c => c.irNodeId === bin.props.left?.irNodeId);
            const right = bin.children.find(c => c.irNodeId === bin.props.right?.irNodeId);
            if (!left || !right) return false;
            
            // a == true -> a
            if ((bin.props.operator === '==' || bin.props.operator === '===') &&
                (right.type === 'BooleanLiteral' && right.props.value === true)) {
                return true;
            }
        }
        
        if (node.type === 'LogicalExpression') {
            const log = node as LogicalExpressionIR;
            const right = log.children.find(c => c.irNodeId === log.props.right?.irNodeId);
            if (!right) return false;
            
            // a || false -> a
            if (log.props.operator === '||' && right.type === 'BooleanLiteral' && right.props.value === false) {
                return true;
            }
            // a && true -> a
            if (log.props.operator === '&&' && right.type === 'BooleanLiteral' && right.props.value === true) {
                return true;
            }
        }
        
        return false;
    },
    candidates: (node: IRNode, state: CompilationState) => {
        if (node.type === 'BinaryExpression') {
            const bin = node as BinaryExpressionIR;
            const left = bin.children.find(c => c.irNodeId === bin.props.left?.irNodeId)!;
            const right = bin.children.find(c => c.irNodeId === bin.props.right?.irNodeId)!;
            
            if (right.type === 'BooleanLiteral' && right.props.value === true) {
                // a == true -> a
                console.debug(`[TransformRule] ${LogicalSimplificationRule.id} matched: a == true -> a`);
                return [left]; // just return left node
            }
        }
        
        if (node.type === 'LogicalExpression') {
            const log = node as LogicalExpressionIR;
            const left = log.children.find(c => c.irNodeId === log.props.left?.irNodeId)!;
            // a || false -> a
            console.debug(`[TransformRule] ${LogicalSimplificationRule.id} matched: a || false -> a or a && true -> a`);
            return [left];
        }
        
        return [];
    }
};
