import { IRNode, IfStatementIR, ExpressionStatementIR, ConditionalExpressionIR, LogicalExpressionIR, IdentifierIR } from '../../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../../../1_domain/state/CompilationState';
import { TransformRule } from '../../../interface/TransformRule';


function extractSingleExpression(node: IRNode): IRNode | null {
    if (node.type === 'ExpressionStatement') {
        const exprRef = (node as ExpressionStatementIR).props.expression;
        if (!exprRef) return null;
        return node.children.find(c => c.irNodeId === exprRef.irNodeId) || null;
    }
    if (node.type === 'BlockStatement') {
        const body = (node.props as any).body;
        if (Array.isArray(body) && body.length === 1) {
            const stmtRef = body[0];
            const stmt = node.children.find(c => c.irNodeId === stmtRef.irNodeId);
            if (stmt && stmt.type === 'ExpressionStatement') {
                const exprRef = (stmt as ExpressionStatementIR).props.expression;
                if (!exprRef) return null;
                return stmt.children.find(c => c.irNodeId === exprRef.irNodeId) || null;
            }
        }
    }
    return null;
}

export const IfToTernaryRule: TransformRule = {
    id: 'micro:if-to-ternary',
    type: 'micro',
    name: 'If文の三項演算子化 (If to Ternary)',
    description: 'シンプルなif/else代入やif/else式を、より短い三項演算子に変換します。',
    defaultEnabled: true,
    match: (node: IRNode, state: CompilationState): node is IfStatementIR => {
        // ここで型ガード
        if (node.type !== 'IfStatement') return false;
        
        // props に as キャストや ['consequent'] と書く必要がなくなる
        const consequentRef = node.props.consequent;
        if (!consequentRef) return false;
        
        const consequentNode = node.children.find(c => c.irNodeId === consequentRef.irNodeId);
        if (!consequentNode) return false;

        const expr = extractSingleExpression(consequentNode);
        if (!expr) return false;

        const alternateRef = node.props.alternate;
        if (alternateRef) {
            const alternateNode = node.children.find(c => c.irNodeId === alternateRef.irNodeId);
            if (!alternateNode) return false;
            const altExpr = extractSingleExpression(alternateNode);
            if (!altExpr) return false;
        }

        return true;
    },
    candidates: (node: IRNode, state: CompilationState) => {
        const genId = () => state.services.generateId!('ir_it');
        const ifNode = node as IfStatementIR;
        
        const testRef = ifNode.props.test;
        const consequentRef = ifNode.props.consequent;
        const alternateRef = ifNode.props.alternate;

        const testNode = ifNode.children.find(c => c.irNodeId === testRef?.irNodeId);
        const consequentNode = ifNode.children.find(c => c.irNodeId === consequentRef?.irNodeId);
        const alternateNode = alternateRef ? ifNode.children.find(c => c.irNodeId === alternateRef.irNodeId) : null;

        if (!testNode || !consequentNode) return [];

        const consequentExpr = extractSingleExpression(consequentNode);
        if (!consequentExpr) return [];

        const candidates: IRNode[] = [];

        if (alternateNode) {
            const alternateExpr = extractSingleExpression(alternateNode);
            if (alternateExpr) {
                // 三項演算子への変換 (安全)
                const conditionalExpr: ConditionalExpressionIR = {
                    type: 'ConditionalExpression',
                    irNodeId: genId(),
                    props: {
                        test: { type: 'ref', irNodeId: testNode.irNodeId },
                        consequent: { type: 'ref', irNodeId: consequentExpr.irNodeId },
                        alternate: { type: 'ref', irNodeId: alternateExpr.irNodeId }
                    },
                    children: [testNode, consequentExpr, alternateExpr]
                };

                const exprStmt1: ExpressionStatementIR = {
                    type: 'ExpressionStatement',
                    irNodeId: genId(),
                    props: {
                        expression: { type: 'ref', irNodeId: conditionalExpr.irNodeId }
                    },
                    children: [conditionalExpr]
                };
                candidates.push(exprStmt1);
            }
        } else {
            // elseがない場合は AND (&&) への変換
            const logicalExpr: LogicalExpressionIR = {
                type: 'LogicalExpression',
                irNodeId: genId(),
                props: {
                    operator: '&&',
                    left: { type: 'ref', irNodeId: testNode.irNodeId },
                    right: { type: 'ref', irNodeId: consequentExpr.irNodeId }
                },
                children: [testNode, consequentExpr]
            };

            const exprStmt1: ExpressionStatementIR = {
                type: 'ExpressionStatement',
                irNodeId: genId(),
                props: {
                    expression: { type: 'ref', irNodeId: logicalExpr.irNodeId }
                },
                children: [logicalExpr]
            };
            candidates.push(exprStmt1);

            // test ? consequent : undefined
            const undefinedIdentifier: IdentifierIR = {
                type: 'Identifier',
                irNodeId: genId(),
                props: { name: 'undefined' },
                children: []
            };

            const conditionalExpr: ConditionalExpressionIR = {
                type: 'ConditionalExpression',
                irNodeId: genId(),
                props: {
                    test: { type: 'ref', irNodeId: testNode.irNodeId },
                    consequent: { type: 'ref', irNodeId: consequentExpr.irNodeId },
                    alternate: { type: 'ref', irNodeId: undefinedIdentifier.irNodeId }
                },
                children: [testNode, consequentExpr, undefinedIdentifier]
            };

            const exprStmt2: ExpressionStatementIR = {
                type: 'ExpressionStatement',
                irNodeId: genId(),
                props: {
                    expression: { type: 'ref', irNodeId: conditionalExpr.irNodeId }
                },
                children: [conditionalExpr]
            };
            candidates.push(exprStmt2);
        }

        console.debug(`[TransformRule] ${IfToTernaryRule.id} matched on IfStatement. Generated ${candidates.length} candidates.`);
        return candidates;
    }
};
