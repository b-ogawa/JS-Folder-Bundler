import { IRNode, CallExpressionIR, IdentifierIR, ArrowFunctionExpressionIR, VariableDeclaratorIR, NumericLiteralIR, StringLiteralIR, BooleanLiteralIR } from '../../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../../../1_domain/state/CompilationState';
import { TransformRule } from '../../../interface/TransformRule';


export const PureFunctionEvaluationRule: TransformRule = {
    id: 'micro:pure-function-evaluation',
    type: 'micro',
    name: 'Pure関数（純粋関数）の評価と消去',
    description: '引数がすべて定数で、副作用のない関数呼び出しをコンパイル時に計算して結果の定数に置き換えます。',
    defaultEnabled: true,
    match: (node: IRNode, state: CompilationState): node is CallExpressionIR => {
        if (node.type !== 'CallExpression') return false;
        
        const callNode = node as CallExpressionIR;
        const snapshot = state.analysisSnapshot;
        if (!snapshot) return false;

        // Check if all arguments are literals
        for (const argRef of callNode.props.arguments) {
            const argNode = callNode.children.find(c => c.irNodeId === argRef.irNodeId);
            if (!argNode) return false;
            if (argNode.type !== 'NumericLiteral' && argNode.type !== 'StringLiteral' && argNode.type !== 'BooleanLiteral') {
                return false;
            }
        }

        // Find the callee function
        const calleeNode = callNode.children.find(c => c.irNodeId === callNode.props.callee?.irNodeId);
        if (!calleeNode || calleeNode.type !== 'Identifier') return false;

        const calleeIdent = calleeNode as IdentifierIR;
        const declId = snapshot.refToDeclMap.get(calleeIdent.irNodeId);
        if (!declId) return false;

        const defs = snapshot.getReachingDefinitions(calleeIdent.irNodeId, declId);
        if (defs.size !== 1) return false;

        const defId = Array.from(defs)[0];
        const defNode = snapshot.nodeMap.get(defId);
        if (!defNode) return false;

        let funcNode: IRNode | null = null;
        if (defNode.type === 'FunctionDeclaration') {
            funcNode = defNode;
        } else if (defNode.type === 'VariableDeclarator') {
            const dNode = defNode as VariableDeclaratorIR;
            const initRef = dNode.props.init;
            if (initRef) {
                funcNode = dNode.children.find(c => c.irNodeId === initRef.irNodeId) || null;
            }
        }

        if (!funcNode || (funcNode.type !== 'FunctionDeclaration' && funcNode.type !== 'ArrowFunctionExpression' && funcNode.type !== 'FunctionExpression')) {
            return false;
        }

        // Now, check if the function is "pure".
        // A function is pure if it doesn't reference any variables declared outside its body,
        // EXCEPT for a whitelist of safe globals.
        const safeGlobals = new Set(['Math', 'Number', 'String', 'Boolean', 'Object', 'Array', 'parseInt', 'parseFloat', 'isNaN', 'isFinite']);
        
        // Collect all IDs in the function's subtree
        const funcSubtreeIds = new Set<string>();
        const traverseIds = (n: IRNode) => {
            funcSubtreeIds.add(n.irNodeId);
            if (n.children) n.children.forEach(traverseIds);
        };
        traverseIds(funcNode);

        let isPure = true;
        const checkPure = (n: IRNode) => {
            if (n.type === 'Identifier') {
                const ident = n as IdentifierIR;
                // If it's a property name, it's not a variable reference
                const parentId = snapshot.parentMap.get(ident.irNodeId);
                let isProperty = false;
                if (parentId) {
                    const parent = snapshot.nodeMap.get(parentId);
                    if (parent && parent.type === 'MemberExpression' && !(parent.props as any).computed && (parent.props as any).property?.irNodeId === ident.irNodeId) {
                        isProperty = true;
                    }
                    if (parent && parent.type === 'ObjectProperty' && (parent.props as any).key?.irNodeId === ident.irNodeId) {
                        isProperty = true;
                    }
                }

                if (!isProperty) {
                    // Check if it resolves to a declaration inside the function
                    const identDeclId = snapshot.refToDeclMap.get(ident.irNodeId);
                    if (identDeclId) {
                        if (!funcSubtreeIds.has(identDeclId)) {
                            // Reference to outside!
                            isPure = false;
                        }
                    } else if (snapshot.escapedVars.has(ident.irNodeId)) {
                        // Unbound global reference
                        if (!safeGlobals.has(ident.props.name)) {
                            isPure = false;
                        }
                    }
                }
            }
            if (isPure && n.children) {
                n.children.forEach(checkPure);
            }
        };
        checkPure(funcNode);

        return isPure;
    },
    candidates: (node: IRNode, state: CompilationState) => {
        const genId = () => state.services.generateId!('ir_pure');
        // 評価サービスが注入されていない場合はスキップ
        if (!state.services || !state.services.evaluatePureFunction) {
            return [];
        }

        const callNode = node as CallExpressionIR;
        const snapshot = state.analysisSnapshot!;

        const calleeNode = callNode.children.find(c => c.irNodeId === callNode.props.callee?.irNodeId) as IdentifierIR;
        const declId = snapshot.refToDeclMap.get(calleeNode.irNodeId)!;
        const defs = snapshot.getReachingDefinitions(calleeNode.irNodeId, declId);
        const defId = Array.from(defs)[0];
        const defNode = snapshot.nodeMap.get(defId)!;

        let funcNode: IRNode;
        if (defNode.type === 'FunctionDeclaration') {
            funcNode = defNode;
        } else {
            const dNode = defNode as VariableDeclaratorIR;
            funcNode = dNode.children.find(c => c.irNodeId === dNode.props.init?.irNodeId)!;
        }

        try {
            // 引数の値を抽出
            const args = callNode.props.arguments.map((argRef: any) => {
                const argNode = callNode.children.find(c => c.irNodeId === argRef.irNodeId) as any;
                return argNode.props.value; // リテラル値の抽出
            });

            // 外部の評価サービスに処理を委譲
            const result = state.services.evaluatePureFunction(funcNode, args);

            let resultNode: IRNode;
            if (typeof result === 'number') {
                resultNode = { type: 'NumericLiteral', irNodeId: genId(), props: { value: result }, children: [] };
            } else if (typeof result === 'string') {
                resultNode = { type: 'StringLiteral', irNodeId: genId(), props: { value: result }, children: [] };
            } else if (typeof result === 'boolean') {
                resultNode = { type: 'BooleanLiteral', irNodeId: genId(), props: { value: result }, children: [] };
            } else {
                return []; 
            }

            return [resultNode];
        } catch (e: any) {
            console.warn(`[TransformRule] ${PureFunctionEvaluationRule.id} evaluation failed: ${e.message}`);
            return [];
        }
    }
};
