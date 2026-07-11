import { IRNode, IdentifierIR, MemberExpressionIR, ObjectExpressionIR, ObjectPropertyIR, VariableDeclaratorIR, AssignmentExpressionIR, UpdateExpressionIR, NumericLiteralIR, StringLiteralIR, BooleanLiteralIR } from '../../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../../../1_domain/state/CompilationState';
import { TransformRule } from '../../../interface/TransformRule';


export const ObjectPropertyPropagationRule: TransformRule = {
    id: 'micro:object-property-propagation',
    type: 'micro',
    name: 'オブジェクト・プロパティの定数伝播',
    description: 'オブジェクトリテラルとして定義され、ミューテーションを受けていないオブジェクトのプロパティアクセスをリテラル値に展開します。',
    defaultEnabled: true,
    match: (node: IRNode, state: CompilationState): node is MemberExpressionIR => {
        if (node.type !== 'MemberExpression') return false;
        if (!state.analysisSnapshot) return false;

        const memNode = node as MemberExpressionIR;
        if (memNode.props.computed) {
            // Computed properties (e.g. obj['a']) could be supported if property is StringLiteral,
            // but for simplicity let's stick to non-computed or StringLiteral computed.
            const propNode = memNode.children.find(c => c.irNodeId === memNode.props.property?.irNodeId);
            if (!propNode || propNode.type !== 'StringLiteral') {
                return false;
            }
        }
        
        const objRef = memNode.props.object;
        if (!objRef) return false;
        
        const snapshot = state.analysisSnapshot;
        const objNode = snapshot.nodeMap.get(objRef.irNodeId);
        if (!objNode || objNode.type !== 'Identifier') return false;
        
        const identNode = objNode as IdentifierIR;
        
        // 自分が代入の左辺などにいないかチェック
        const parentId = snapshot.parentMap.get(memNode.irNodeId);
        if (parentId) {
            const parent = snapshot.nodeMap.get(parentId);
            if (parent) {
                if (parent.type === 'AssignmentExpression' && (parent as AssignmentExpressionIR).props.left?.irNodeId === memNode.irNodeId) return false;
                if (parent.type === 'UpdateExpression' && (parent as UpdateExpressionIR).props.argument?.irNodeId === memNode.irNodeId) return false;
            }
        }

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

        if (!sourceNode || sourceNode.type !== 'ObjectExpression') return false;

        // ミューテーション検査: 対象のオブジェクトに対する変更がないか
        // このオブジェクト(a_decl)への全ての参照をチェックし、プロパティ変更や引数渡しなどがあれば安全のため伝播を諦める
        let isMutatedOrEscaped = false;
        for (const [refId, declId] of snapshot.refToDeclMap.entries()) {
            if (declId === a_decl) {
                const refParentId = snapshot.parentMap.get(refId);
                if (refParentId) {
                    const refParent = snapshot.nodeMap.get(refParentId);
                    if (refParent) {
                        if (refParent.type === 'VariableDeclarator' && (refParent as VariableDeclaratorIR).props.id?.irNodeId === refId) {
                            // 宣言自身なのでOK
                        } else if (refParent.type === 'MemberExpression' && (refParent as MemberExpressionIR).props.object?.irNodeId === refId) {
                            // プロパティアクセス
                            const memParentId = snapshot.parentMap.get(refParent.irNodeId);
                            if (memParentId) {
                                const memParent = snapshot.nodeMap.get(memParentId);
                                if (memParent) {
                                    if (memParent.type === 'AssignmentExpression' && (memParent as AssignmentExpressionIR).props.left?.irNodeId === refParent.irNodeId) {
                                        isMutatedOrEscaped = true; // プロパティへの代入
                                        break;
                                    }
                                    if (memParent.type === 'UpdateExpression' && (memParent as UpdateExpressionIR).props.argument?.irNodeId === refParent.irNodeId) {
                                        isMutatedOrEscaped = true; // プロパティの更新 (++, --)
                                        break;
                                    }
                                    if (memParent.type === 'CallExpression' && (memParent as any).props.callee?.irNodeId === refParent.irNodeId) {
                                        // メソッド呼び出し (thisを通して変更される可能性があるため保守的に諦める)
                                        // e.g. obj.method()
                                        isMutatedOrEscaped = true;
                                        break;
                                    }
                                }
                            }
                        } else if (refParent.type === 'AssignmentExpression' && (refParent as AssignmentExpressionIR).props.left?.irNodeId === refId) {
                            // 再代入 (a_defs.size === 1 だが、別の箇所で再代入されているなら複雑化するので保守的に諦める)
                            isMutatedOrEscaped = true;
                            break;
                        } else {
                            // 関数呼び出しの引数として渡されている(CallExpression arguments)など、その他の使われ方
                            // 保守的に諦める
                            isMutatedOrEscaped = true;
                            break;
                        }
                    }
                }
            }
        }

        if (isMutatedOrEscaped) return false;

        // プロパティ名を特定
        let propName = '';
        if (!memNode.props.computed) {
            const propNode = memNode.children.find(c => c.irNodeId === memNode.props.property?.irNodeId);
            if (propNode && propNode.type === 'Identifier') {
                propName = (propNode as IdentifierIR).props.name;
            }
        } else {
            const propNode = memNode.children.find(c => c.irNodeId === memNode.props.property?.irNodeId);
            if (propNode && propNode.type === 'StringLiteral') {
                propName = (propNode as StringLiteralIR).props.value;
            }
        }

        if (!propName) return false;

        // ObjectExpressionの中に該当するプロパティが存在し、かつ値が定数リテラルであるか
        const objExp = sourceNode as ObjectExpressionIR;
        const properties = objExp.children.filter(c => c.type === 'ObjectProperty') as ObjectPropertyIR[];
        const targetProp = properties.find(p => {
            const keyNode = p.children.find(c => c.irNodeId === p.props.key?.irNodeId);
            if (keyNode?.type === 'Identifier') return (keyNode as IdentifierIR).props.name === propName;
            if (keyNode?.type === 'StringLiteral') return (keyNode as StringLiteralIR).props.value === propName;
            return false;
        });

        if (!targetProp) return false;

        const valNode = targetProp.children.find(c => c.irNodeId === targetProp.props.value?.irNodeId);
        if (!valNode || (valNode.type !== 'NumericLiteral' && valNode.type !== 'StringLiteral' && valNode.type !== 'BooleanLiteral')) {
            return false; // 値が定数リテラルではない
        }

        return true;
    },
    candidates: (node: IRNode, state: CompilationState) => {
        const genId = () => state.services.generateId!('ir_objprop');
        const memNode = node as MemberExpressionIR;
        const snapshot = state.analysisSnapshot!;
        
        const objRef = memNode.props.object!;
        const identNode = snapshot.nodeMap.get(objRef.irNodeId) as IdentifierIR;
        
        const a_decl = snapshot.refToDeclMap.get(identNode.irNodeId)!;
        const a_defs = snapshot.getReachingDefinitions(identNode.irNodeId, a_decl);
        const defId = Array.from(a_defs)[0];
        const defNode = snapshot.nodeMap.get(defId)!;
        
        let sourceNode: ObjectExpressionIR;
        if (defNode.type === 'VariableDeclarator') {
            sourceNode = defNode.children.find(c => c.irNodeId === (defNode as VariableDeclaratorIR).props.init?.irNodeId) as ObjectExpressionIR;
        } else {
            sourceNode = defNode.children.find(c => c.irNodeId === (defNode as AssignmentExpressionIR).props.right?.irNodeId) as ObjectExpressionIR;
        }

        let propName = '';
        if (!memNode.props.computed) {
            const propNode = memNode.children.find(c => c.irNodeId === memNode.props.property?.irNodeId);
            propName = (propNode as IdentifierIR).props.name;
        } else {
            const propNode = memNode.children.find(c => c.irNodeId === memNode.props.property?.irNodeId);
            propName = (propNode as StringLiteralIR).props.value;
        }

        const properties = sourceNode.children.filter(c => c.type === 'ObjectProperty') as ObjectPropertyIR[];
        const targetProp = properties.find(p => {
            const keyNode = p.children.find(c => c.irNodeId === p.props.key?.irNodeId);
            if (keyNode?.type === 'Identifier') return (keyNode as IdentifierIR).props.name === propName;
            if (keyNode?.type === 'StringLiteral') return (keyNode as StringLiteralIR).props.value === propName;
            return false;
        });

        const valNode = targetProp!.children.find(c => c.irNodeId === targetProp!.props.value?.irNodeId)! as NumericLiteralIR | StringLiteralIR | BooleanLiteralIR;

        const newNode: NumericLiteralIR | StringLiteralIR | BooleanLiteralIR = {
            ...valNode,
            irNodeId: genId(),
            children: []
        };
        console.debug(`[TransformRule] ${ObjectPropertyPropagationRule.id} matched. Propagating property '${propName}' with value ${String(newNode.props.value)}.`);
        return [newNode];
    }
};
