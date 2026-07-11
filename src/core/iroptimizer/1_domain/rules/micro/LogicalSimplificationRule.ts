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
            
            // typeof a === 'undefined'
            if ((bin.props.operator === '===' || bin.props.operator === '==') &&
                left.type === 'UnaryExpression' && left.props.operator === 'typeof' &&
                right.type === 'StringLiteral' && right.props.value === 'undefined') {
                return true;
            }
            
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
        const genId = () => state.services.generateId!('ir_logic');
        if (node.type === 'BinaryExpression') {
            const bin = node as BinaryExpressionIR;
            const left = bin.children.find(c => c.irNodeId === bin.props.left?.irNodeId)!;
            const right = bin.children.find(c => c.irNodeId === bin.props.right?.irNodeId)!;
            
            if (left.type === 'UnaryExpression' && left.props.operator === 'typeof') {
                // typeof a === 'undefined' -> a === void 0
                const typeofArg = left.children.find(c => c.irNodeId === left.props.argument?.irNodeId);
                if (typeofArg) {
                    const voidNode: IRNode = {
                        type: 'UnaryExpression',
                        irNodeId: genId(),
                        props: {
                            operator: 'void',
                            prefix: true,
                            argument: { type: 'ref', irNodeId: genId() }
                        },
                        children: [
                            {
                                type: 'NumericLiteral',
                                irNodeId: 'tmp', // will be replaced
                                props: { value: 0 },
                                children: []
                            }
                        ]
                    };
                    voidNode.children[0].irNodeId = voidNode.props.argument.irNodeId;

                    const newBin: BinaryExpressionIR = {
                        type: 'BinaryExpression',
                        irNodeId: genId(),
                        props: {
                            operator: '===',
                            left: { type: 'ref', irNodeId: typeofArg.irNodeId },
                            right: { type: 'ref', irNodeId: voidNode.irNodeId }
                        },
                        children: [typeofArg, voidNode]
                    };
                    console.debug(`[TransformRule] ${LogicalSimplificationRule.id} matched: typeof x === 'undefined' -> x === void 0`);
                    return [newBin];
                }
            }
            
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
