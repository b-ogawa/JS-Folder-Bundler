import { IRNode, VariableDeclarationIR, VariableDeclaratorIR, IdentifierIR } from '../../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../../../1_domain/state/CompilationState';
import { TransformRule } from '../../../interface/TransformRule';

// 副作用のないノード判定
function isSimple(node: IRNode): boolean {
    return node.type === 'Identifier' || 
           node.type === 'NumericLiteral' || 
           node.type === 'StringLiteral' || 
           node.type === 'BooleanLiteral' ||
           node.type === 'ArrowFunctionExpression' ||
           node.type === 'FunctionExpression';
}

export const DeadCodeEliminationRule: TransformRule = {
    id: 'macro:dead-code-elimination',
    type: 'macro',
    name: 'デッドコード削除 (DCE)',
    description: 'どこからも参照されていない、あるいは実行されることのない不要な変数、関数、クラス、インポート宣言を削除します。',
    defaultEnabled: true,
    match: (node: IRNode, state: CompilationState): boolean => {
        if (!state.analysisSnapshot) return false;
        const snapshot = state.analysisSnapshot;

        // 変数宣言のデッドコード判定
        if (node.type === 'VariableDeclaration') {
            const varNode = node as VariableDeclarationIR;
            const declarations = varNode.props.declarations;
            if (!Array.isArray(declarations) || declarations.length === 0) return false;

            const parentId = snapshot.parentMap.get(varNode.irNodeId);
            if (parentId) {
                const parentNode = snapshot.nodeMap.get(parentId);
                if (parentNode && (parentNode.type === 'ForOfStatement' || parentNode.type === 'ForInStatement' || parentNode.type === 'ForStatement')) {
                    return false;
                }
            }

            let allUnused = true;
            for (const declRef of declarations) {
                let declNode = snapshot.nodeMap.get(declRef.irNodeId) as VariableDeclaratorIR | undefined;
                if (!declNode && varNode.children) {
                    declNode = varNode.children.find(c => c.irNodeId === declRef.irNodeId) as VariableDeclaratorIR | undefined;
                }
                if (!declNode || declNode.type !== 'VariableDeclarator') {
                    allUnused = false;
                    break;
                }

                const idRef = declNode.props.id;
                if (!idRef) {
                    allUnused = false;
                    break;
                }

                let identNode = snapshot.nodeMap.get(idRef.irNodeId) as IdentifierIR | undefined;
                if (!identNode && declNode.children) {
                    identNode = declNode.children.find(c => c.irNodeId === idRef.irNodeId) as IdentifierIR | undefined;
                }
                if (!identNode || identNode.type !== 'Identifier') {
                    allUnused = false;
                    break;
                }

                const declId = identNode.irNodeId;

                if ((snapshot.referenceCounts.get(declId) || 0) > 0 || snapshot.escapedVars.has(declId)) {
                    allUnused = false;
                    break;
                }

                if (declNode.props.init) {
                    let initNode = snapshot.nodeMap.get(declNode.props.init.irNodeId);
                    if (!initNode && declNode.children) {
                        initNode = declNode.children.find(c => c.irNodeId === declNode.props.init!.irNodeId);
                    }
                    if (initNode && !isSimple(initNode)) {
                        allUnused = false;
                        break;
                    }
                }
            }
            return allUnused;
        }

        // クラス宣言・関数宣言のデッドコード判定
        if (node.type === 'ClassDeclaration' || node.type === 'FunctionDeclaration') {
            const idRef = node.props.id;
            if (!idRef) return false;

            let idNode = snapshot.nodeMap.get(idRef.irNodeId);
            if (!idNode && node.children) {
                idNode = node.children.find(c => c.irNodeId === idRef.irNodeId);
            }
            if (!idNode || idNode.type !== 'Identifier') return false;

            const declId = idNode.irNodeId;

            if (snapshot.escapedVars.has(declId) || (snapshot.referenceCounts.get(declId) || 0) > 0) {
                return false;
            }
            return true;
        }

        // 不要なインポート宣言のデッドコード判定
        if (node.type === 'ImportDeclaration') {
            const specifiers = node.props.specifiers;
            if (!Array.isArray(specifiers) || specifiers.length === 0) return false;

            let allUnused = true;
            for (const specRef of specifiers) {
                let specNode = snapshot.nodeMap.get(specRef.irNodeId);
                if (!specNode && node.children) {
                    specNode = node.children.find(c => c.irNodeId === specRef.irNodeId);
                }
                if (!specNode) {
                    allUnused = false;
                    break;
                }

                const localRef = specNode.props.local;
                if (!localRef) {
                    allUnused = false;
                    break;
                }

                let localNode = snapshot.nodeMap.get(localRef.irNodeId);
                if (!localNode && specNode.children) {
                    localNode = specNode.children.find(c => c.irNodeId === localRef.irNodeId);
                }
                if (localNode && localNode.type === 'Identifier') {
                    const declId = localNode.irNodeId;
                    if ((snapshot.referenceCounts.get(declId) || 0) > 0 || snapshot.escapedVars.has(declId)) {
                        allUnused = false;
                        break;
                    }
                } else {
                    allUnused = false;
                    break;
                }
            }
            return allUnused;
        }

        return false;
    },
    candidates: (node: IRNode, state: CompilationState) => {
        console.debug(`[TransformRule] ${DeadCodeEliminationRule.id} matched on ${node.type}. Generated 1 candidate (deletion).`);
        return [null];
    }
};
