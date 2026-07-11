import { IRNode, BlockStatementIR, ExpressionStatementIR, GenericIRNode } from '../../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../../../1_domain/state/CompilationState';
import { TransformRule } from '../../../interface/TransformRule';

export const StatementMergeRule: TransformRule = {
    id: 'micro:statement-merge',
    type: 'micro',
    name: '連続式文のカンマ結合 (Statement Merge)',
    description: '連続する式文（ExpressionStatement）をカンマ演算子（SequenceExpression）で1つに結合し、ブロックを圧縮します。',
    defaultEnabled: true,
    match: (node: IRNode, state: CompilationState): node is BlockStatementIR => {
        if (node.type !== 'BlockStatement' && node.type !== 'Program') return false;
        
        const bodyRefs = node.props['body'];
        if (!Array.isArray(bodyRefs) || bodyRefs.length < 2) return false;

        // 連続する ExpressionStatement が2つ以上ある箇所が存在するかをチェック
        let consecutiveCount = 0;
        for (const ref of bodyRefs) {
            if (!ref || ref.type !== 'ref') continue;
            const child = node.children.find(c => c.irNodeId === ref.irNodeId);
            if (child && child.type === 'ExpressionStatement') {
                consecutiveCount++;
                if (consecutiveCount >= 2) return true;
            } else {
                consecutiveCount = 0;
            }
        }

        return false;
    },
    candidates: (node: IRNode, state: CompilationState) => {
        const genId = () => state.services.generateId!('ir_merge');
        const blockNode = node as BlockStatementIR;
        const bodyRefs = blockNode.props['body'] as any[];
        
        const newBodyRefs: any[] = [];
        const newChildren: IRNode[] = [];
        
        let currentSequence: IRNode[] = [];

        // 溜まった ExpressionStatement を 1つの SequenceExpression に結合してフラッシュする関数
        const flushSequence = () => {
            if (currentSequence.length === 0) return;
            
            if (currentSequence.length === 1) {
                newBodyRefs.push({ type: 'ref', irNodeId: currentSequence[0].irNodeId });
                newChildren.push(currentSequence[0]);
            } else {
                // SequenceExpression (カンマ結合) を作成
                const expressions = currentSequence.map(stmt => {
                    const exprRef = stmt.props['expression'];
                    return stmt.children.find(c => c.irNodeId === exprRef.irNodeId)!;
                });
                
                const sequenceNode: GenericIRNode = {
                    type: 'SequenceExpression',
                    irNodeId: genId(),
                    props: {
                        expressions: expressions.map(e => ({ type: 'ref', irNodeId: e.irNodeId }))
                    },
                    children: expressions
                };
                
                const mergedStmtNode: ExpressionStatementIR = {
                    type: 'ExpressionStatement',
                    irNodeId: genId(),
                    props: {
                        expression: { type: 'ref', irNodeId: sequenceNode.irNodeId }
                    },
                    children: [sequenceNode]
                };
                
                newBodyRefs.push({ type: 'ref', irNodeId: mergedStmtNode.irNodeId });
                newChildren.push(mergedStmtNode);
            }
            currentSequence = [];
        };

        for (const ref of bodyRefs) {
            if (!ref || ref.type !== 'ref') continue;
            const child = blockNode.children.find(c => c.irNodeId === ref.irNodeId);
            if (!child) continue;

            // ExpressionStatement ならバッファに溜める
            // （変数宣言や if 文などが来たら、そこで安全に結合を打ち切る）
            if (child.type === 'ExpressionStatement') {
                currentSequence.push(child);
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

        console.debug(`[TransformRule] ${StatementMergeRule.id} matched. Compressed consecutive statements.`);
        return [newNode];
    }
};
