import { IRNode, AssignmentExpressionIR, VariableDeclaratorIR } from '../../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../../../1_domain/state/CompilationState';
import { TransformRule } from '../../../interface/TransformRule';


// 副作用を持たない安全なノードかどうかを判定
function isSimple(node: IRNode): boolean {
    return node.type === 'Identifier' || 
           node.type === 'NumericLiteral' || 
           node.type === 'StringLiteral' || 
           node.type === 'BooleanLiteral';
}

export const DeadStoreEliminationRule: TransformRule = {
    id: 'micro:dead-store-elimination',
    type: 'micro',
    name: '不要代入の削除 (Dead Store Elimination)',
    description: '再代入などで上書きされて一度も読み取られない無駄な代入や初期化コードを削除します。',
    defaultEnabled: true,
    match: (node: IRNode, state: CompilationState): boolean => {
        if (!state.analysisSnapshot) return false;

        if (node.type === 'AssignmentExpression') {
            const assignNode = node as AssignmentExpressionIR;
            const leftRef = assignNode.props.left;
            if (!leftRef) return false;

            const leftNode = assignNode.children.find(c => c.irNodeId === leftRef.irNodeId);
            if (!leftNode || leftNode.type !== 'Identifier') return false;

            const declId = state.analysisSnapshot.refToDeclMap.get(leftNode.irNodeId);
            if (!declId) return false;

            const isLive = state.analysisSnapshot.isVariableLiveAfter(declId, assignNode.irNodeId);
            return !isLive;
        } else if (node.type === 'VariableDeclarator') {
            const declNode = node as VariableDeclaratorIR;
            const idRef = declNode.props.id;
            if (!idRef) return false;
            
            const idNode = declNode.children.find(c => c.irNodeId === idRef.irNodeId);
            if (!idNode || idNode.type !== 'Identifier') return false;

            if (!declNode.props.init) return false;

            // const宣言における初期化子の削除は構文エラーとなるため最適化対象から除外
            const parentId = state.analysisSnapshot.parentMap.get(declNode.irNodeId);
            if (parentId) {
                const parentNode = state.analysisSnapshot.nodeMap.get(parentId);
                if (parentNode && parentNode.type === 'VariableDeclaration' && parentNode.props.kind === 'const') {
                    return false;
                }
            }

            // 初期化子が副作用を伴う可能性（関数呼び出し等）がある場合は削除対象から除外
            const initNode = declNode.children.find(c => c.irNodeId === declNode.props.init!.irNodeId);
            if (!initNode || !isSimple(initNode)) return false;

            const declId = idNode.irNodeId; 
            const isLive = state.analysisSnapshot.isVariableLiveAfter(declId, declNode.irNodeId);
            
            return !isLive;
        }

        return false;
    },
    candidates: (node: IRNode, state: CompilationState) => {
        const genId = () => state.services.generateId!('ir_ds');
        if (node.type === 'AssignmentExpression') {
            const assignNode = node as AssignmentExpressionIR;
            const rightRef = assignNode.props.right;
            if (!rightRef) return [];
            
            const rightNode = assignNode.children.find(c => c.irNodeId === rightRef.irNodeId);
            if (!rightNode) return [];

            console.debug(`[TransformRule] ${DeadStoreEliminationRule.id} matched on AssignmentExpression. Generated 1 candidate (replace with RHS).`);
            return [rightNode];
        } else if (node.type === 'VariableDeclarator') {
            const declNode = node as VariableDeclaratorIR;
            const newNode: VariableDeclaratorIR = {
                ...declNode,
                irNodeId: genId(),
                props: { ...declNode.props, init: null }
            };
            console.debug(`[TransformRule] ${DeadStoreEliminationRule.id} matched on VariableDeclarator. Generated 1 candidate (removed init).`);
            return [newNode];
        }
        
        return [];
    }
};
