import { IRNode, BinaryExpressionIR, NumericLiteralIR, StringLiteralIR, BooleanLiteralIR } from '../../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../../../1_domain/state/CompilationState';
import { TransformRule } from '../../../interface/TransformRule';


export const ConstantFoldingRule: TransformRule = {
    id: 'micro:constant-folding',
    type: 'micro',
    name: '定数畳み込み (Constant Folding)',
    description: '静的に確定する計算（例: 1 + 2）を事前に行い、リテラル（3）に置換します。',
    defaultEnabled: true,
    match: (node: IRNode, state: CompilationState): node is BinaryExpressionIR => {
        // ここで型ガード。以降 node は確実に BinaryExpressionIR として推論される
        if (node.type !== 'BinaryExpression') return false;
        
        // TypeScriptの型システムにより、node.props.left の存在が保証される
        const leftRef = node.props.left;
        const rightRef = node.props.right;
        if (!leftRef || !rightRef) return false;
        
        const left = node.children.find(c => c.irNodeId === leftRef.irNodeId);
        const right = node.children.find(c => c.irNodeId === rightRef.irNodeId);
        
        if (!left || !right) return false;
        
        const isLiteral = (n: IRNode) => n.type === 'NumericLiteral' || n.type === 'StringLiteral' || n.type === 'BooleanLiteral';
        
        return isLiteral(left) && isLiteral(right);
    },
    candidates: (node: IRNode, state: CompilationState) => {
        const genId = () => state.services.generateId!('ir_cf');
        // matchで保証されているため、ここでは安全に BinaryExpressionIR としてキャストして扱える
        const binNode = node as BinaryExpressionIR;
        
        const left = binNode.children.find(c => c.irNodeId === binNode.props.left.irNodeId)!;
        const right = binNode.children.find(c => c.irNodeId === binNode.props.right.irNodeId)!;
        
        const op = binNode.props.operator;
        type LiteralIR = NumericLiteralIR | StringLiteralIR | BooleanLiteralIR;
        const lVal = (left as LiteralIR).props.value as any;
        const rVal = (right as LiteralIR).props.value as any;
        
        let result: any;
        try {
            switch (op) {
                case '+': result = lVal + rVal; break;
                case '-': result = lVal - rVal; break;
                case '*': result = lVal * rVal; break;
                case '/': result = lVal / rVal; break;
                case '%': result = lVal % rVal; break;
                case '==': result = lVal == rVal; break;
                case '===': result = lVal === rVal; break;
                case '!=': result = lVal != rVal; break;
                case '!==': result = lVal !== rVal; break;
                case '<': result = lVal < rVal; break;
                case '<=': result = lVal <= rVal; break;
                case '>': result = lVal > rVal; break;
                case '>=': result = lVal >= rVal; break;
                case '&': result = lVal & rVal; break;
                case '|': result = lVal | rVal; break;
                case '^': result = lVal ^ rVal; break;
                case '<<': result = lVal << rVal; break;
                case '>>': result = lVal >> rVal; break;
                case '>>>': result = lVal >>> rVal; break;
                default:
                    return [];
            }
        } catch (e: any) {
            // 定数式の評価中に例外が発生した場合は警告を出力し、適用対象外とする
            console.warn(`[ConstantFoldingRule] Failed to evaluate constant expression (Op: ${op}, L: ${lVal}, R: ${rVal}):`, e.message);
            return [];
        }
        
        if (typeof result === 'number') {
             if (isNaN(result) || !isFinite(result)) return [];
             const newNode: NumericLiteralIR = {
                 type: 'NumericLiteral',
                 irNodeId: genId(),
                 props: { value: result },
                 children: []
             };
             return [newNode];
        } else if (typeof result === 'boolean') {
             const newNode: BooleanLiteralIR = {
                 type: 'BooleanLiteral',
                 irNodeId: genId(),
                 props: { value: result },
                 children: []
             };
             return [newNode];
        } else if (typeof result === 'string') {
             const newNode: StringLiteralIR = {
                 type: 'StringLiteral',
                 irNodeId: genId(),
                 props: { value: result },
                 children: []
             };
             return [newNode];
        }

        return [];
    }
};
