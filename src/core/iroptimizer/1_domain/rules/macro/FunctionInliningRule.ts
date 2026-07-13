import { IRNode, CallExpressionIR } from '../../../../source_analyzer/ir_converter/IRNodeTypes';
import { CompilationState } from '../../../1_domain/state/CompilationState';
import { TransformRule } from '../../../interface/TransformRule';
import { IRNodeCloner } from '../../utils/IRNodeCloner';
import { CostEstimator } from '../../utils/CostEstimator';

// 複製が安全なノードの判定
const isAlwaysSafeToDuplicate = (node: IRNode) => 
    node.type === 'Identifier' || 
    node.type === 'NumericLiteral' || 
    node.type === 'StringLiteral' || 
    node.type === 'BooleanLiteral' ||
    node.type === 'NullLiteral'; 

// 副作用を持たない式かどうか判定する（配列アクセスなどは安全）
function hasSideEffects(node: IRNode, state: CompilationState): boolean {
    if (isAlwaysSafeToDuplicate(node)) return false;
    if (node.type === 'MemberExpression') {
        const objRef = (node.props as any).object;
        const objNode = objRef ? node.children.find(c => c.irNodeId === objRef.irNodeId) : null;
        if (objNode && hasSideEffects(objNode, state)) return true;
        
        if ((node.props as any).computed) {
            const propRef = (node.props as any).property;
            const propNode = propRef ? node.children.find(c => c.irNodeId === propRef.irNodeId) : null;
            if (propNode && hasSideEffects(propNode, state)) return true;
        }
        return false;
    }
    if (node.type === 'ArrayExpression') {
        return node.children.some(c => hasSideEffects(c, state));
    }
    if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
        return node.children.some(c => hasSideEffects(c, state));
    }
    if (node.type === 'UnaryExpression') {
        // delete は副作用あり
        if ((node.props as any).operator === 'delete') return true;
        return node.children.some(c => hasSideEffects(c, state));
    }
    // CallExpression, AssignmentExpression, NewExpression, UpdateExpression(++, --) 等は副作用ありとみなす
    return true; 
}

// getFunctionNodeはAnalysisSnapshotのresolveFunctionDefinitionに移行されました

function isRecursive(funcNode: IRNode, declId: string, state: CompilationState): boolean {
    let recursive = false;
    const walk = (n: IRNode) => {
        if (recursive) return;
        if (n.type === 'Identifier' && state.analysisSnapshot!.refToDeclMap.get(n.irNodeId) === declId) {
            recursive = true;
            return;
        }
        if (n.children) n.children.forEach(walk);
    };
    walk(funcNode);
    return recursive;
}

function getLocalNames(node: IRNode): Set<string> {
    const names = new Set<string>();
    const walk = (n: IRNode) => {
        if (n.type === 'VariableDeclarator') {
            const idRef = n.props.id;
            const idNode = idRef ? n.children.find(c => c.irNodeId === (idRef as any).irNodeId) : null;
            if (idNode && idNode.type === 'Identifier') names.add(idNode.props.name as string);
        }
        if (n.children) n.children.forEach(walk);
    };
    walk(node);
    return names;
}

function countParamUsage(paramDeclId: string, bodyNode: IRNode, state: CompilationState): number {
    let count = 0;
    const walk = (n: IRNode) => {
        if (n.type === 'Identifier') {
            const declId = state.analysisSnapshot!.refToDeclMap.get(n.irNodeId) || (n.props as any)._declId || n.irNodeId;
            if (declId === paramDeclId) {
                const parentId = state.analysisSnapshot!.parentMap.get(n.irNodeId);
                let isKey = false;
                if (parentId) {
                    const parent = state.analysisSnapshot!.nodeMap.get(parentId);
                    if (parent && parent.type === 'MemberExpression' && !(parent.props as any).computed && (parent.props as any).property?.irNodeId === n.irNodeId) isKey = true;
                    if (parent && parent.type === 'ObjectProperty' && (parent.props as any).key?.irNodeId === n.irNodeId) isKey = true;
                }
                if (!isKey) count++;
            }
        }
        if (n.children) n.children.forEach(walk);
    };
    walk(bodyNode);
    return count;
}

export const FunctionInliningRule: TransformRule = {
    id: 'macro:function-inlining',
    type: 'macro',
    name: '完全関数インライン展開 (Full Inlining)',
    description: '関数の呼び出し先を解析し、安全な引数を内部に直接埋め込んで展開します。',
    defaultEnabled: true,
    match: (node: IRNode, state: CompilationState): boolean => {
        if (node.type !== 'CallExpression') return false;
        const callNode = node as CallExpressionIR;
        if (!callNode.props.callee) return false;

        const calleeNode = callNode.children.find(c => c.irNodeId === callNode.props.callee.irNodeId);
        if (!calleeNode) return false;

        const fnNode = state.analysisSnapshot!.resolveFunctionDefinition(calleeNode.irNodeId);
        if (!fnNode) return false;

        if (fnNode.props.async || fnNode.props.generator) return false;

        let usesThisOrArguments = false;
        const walkForThis = (n: IRNode) => {
            if (n.type === 'ThisExpression' || (n.type === 'Identifier' && n.props.name === 'arguments')) {
                usesThisOrArguments = true;
            }
            if (n.children) n.children.forEach(walkForThis);
        };
        walkForThis(fnNode);
        if (usesThisOrArguments) return false;

        if (calleeNode.type === 'Identifier') {
            const declId = state.analysisSnapshot!.refToDeclMap.get(calleeNode.irNodeId);
            if (declId && isRecursive(fnNode, declId, state)) return false;
        }

        let refCount = 1;
        if (calleeNode.type === 'Identifier') {
            const declId = state.analysisSnapshot!.refToDeclMap.get(calleeNode.irNodeId);
            if (declId) refCount = state.analysisSnapshot!.referenceCounts.get(declId) || 1;
        }

        if (refCount > 1) {
            const cost = CostEstimator.estimate(fnNode, false, state.services?.logger);
            if (cost > 60) return false; 
        }

        return true;
    },
    candidates: (node: IRNode, state: CompilationState) => {
        const genId = () => state.services.generateId!('ir_inlined');
        const callNode = node as CallExpressionIR;
        const calleeNode = callNode.children.find(c => c.irNodeId === callNode.props.callee.irNodeId)!;
        const fnNode = state.analysisSnapshot!.resolveFunctionDefinition(calleeNode.irNodeId)!;
        const localNames = getLocalNames(fnNode);
        
        const bodyRef = fnNode.props.body;
        if (!bodyRef) return [];
        const bodyNode = fnNode.children.find(c => c.irNodeId === (bodyRef as any).irNodeId);
        if (!bodyNode) return [];

        const paramToArgNodeMap = new Map<string, IRNode>();
        const remainingParams: any[] = [];
        const remainingArgs: any[] = [];
        const remainingParamsChildren: IRNode[] = [];
        const remainingArgsChildren: IRNode[] = [];

        const params = fnNode.props.params || [];
        const args = callNode.props.arguments || [];

        for (let i = 0; i < params.length; i++) {
            const paramRef = params[i] as any;
            const paramNode = fnNode.children.find(c => c.irNodeId === paramRef.irNodeId);
            if (!paramNode) continue;

            let actualArgNode = args[i] ? callNode.children.find(c => c.irNodeId === (args[i] as any).irNodeId) : null;
            
            let targetDeclId = paramNode.irNodeId;
            if (paramNode.type === 'AssignmentPattern') {
                const leftRef = (paramNode.props as any).left;
                if (leftRef) targetDeclId = leftRef.irNodeId;
                
                if (!actualArgNode) {
                    const rightRef = (paramNode.props as any).right;
                    if (rightRef) actualArgNode = paramNode.children.find(c => c.irNodeId === rightRef.irNodeId) || null;
                }
            }

            if (actualArgNode) {
                let isSafeToSub = false;
                const usageCount = countParamUsage(targetDeclId, bodyNode, state);

                if (usageCount <= 1 && !hasSideEffects(actualArgNode, state)) {
                    isSafeToSub = true;
                    if (actualArgNode.type === 'Identifier') {
                        if (localNames.has(actualArgNode.props.name as string)) isSafeToSub = false;
                    }
                } else if (isAlwaysSafeToDuplicate(actualArgNode)) {
                    if (actualArgNode.type === 'Identifier') {
                        if (!localNames.has(actualArgNode.props.name as string)) isSafeToSub = true;
                    } else {
                        isSafeToSub = true;
                    }
                }

                if (isSafeToSub) {
                    paramToArgNodeMap.set(targetDeclId, actualArgNode);
                } else {
                    remainingParams.push(paramRef);
                    remainingParamsChildren.push(paramNode);
                    if (args[i]) { // 引数が実際に渡されていた場合のみIIFEの引数に追加
                        remainingArgs.push(args[i]);
                        remainingArgsChildren.push(actualArgNode);
                    }
                }
            } else {
                remainingParams.push(paramRef);
                remainingParamsChildren.push(paramNode);
            }
        }

        for (let i = params.length; i < args.length; i++) {
            const argRef = args[i] as any;
            const argNode = callNode.children.find(c => c.irNodeId === argRef.irNodeId);
            if (argNode) {
                remainingArgs.push(argRef);
                remainingArgsChildren.push(argNode);
            }
        }

        let isSingleReturn = false;
        let singleReturnValue: IRNode | null = null;
        if (bodyNode.type === 'BlockStatement') {
            const stmts = (bodyNode.props as any).body || [];
            if (stmts.length === 1) {
                const stmtNode = bodyNode.children.find(c => c.irNodeId === stmts[0].irNodeId);
                if (stmtNode && stmtNode.type === 'ReturnStatement') {
                    isSingleReturn = true;
                    const argRef = (stmtNode.props as any).argument;
                    if (argRef) singleReturnValue = stmtNode.children.find(c => c.irNodeId === argRef.irNodeId) || null;
                }
            }
        } else {
            isSingleReturn = true;
            singleReturnValue = bodyNode;
        }

        const clonedBody = IRNodeCloner.clone(bodyNode, state, paramToArgNodeMap);

        // 引数がすべて完全に埋め込み（置換）完了したかを判定
        if (isSingleReturn && remainingArgs.length === 0 && remainingParams.length === 0) {
            if (!singleReturnValue) {
                return [{ type: 'Identifier', irNodeId: genId(), props: { name: 'undefined' }, children: [] }];
            }
            const extractExpr = (bNode: IRNode): IRNode => {
                if (bNode.type === 'BlockStatement') {
                    const rStmtRef = (bNode.props as any).body[0];
                    const rNode = bNode.children.find(c => c.irNodeId === rStmtRef.irNodeId)!;
                    const rArgRef = (rNode.props as any).argument;
                    return rNode.children.find(c => c.irNodeId === rArgRef.irNodeId)!;
                }
                return bNode;
            };
            console.debug(`[TransformRule] ${FunctionInliningRule.id}: Inlined directly as Expression.`);
            return [extractExpr(clonedBody)];
        }

        const iifeFnType = (fnNode.type === 'FunctionDeclaration' || fnNode.type === 'FunctionExpression') 
            ? 'FunctionExpression' : 'ArrowFunctionExpression';
        
        const arrowId = genId();
        const arrowNode: IRNode = {
            type: iifeFnType,
            irNodeId: arrowId,
            props: { id: null, params: remainingParams, body: { type: 'ref', irNodeId: clonedBody.irNodeId }, async: false, generator: false },
            children: [...remainingParamsChildren, clonedBody]
        };

        const iifeNode: CallExpressionIR = {
            type: 'CallExpression',
            irNodeId: genId(),
            props: { callee: { type: 'ref', irNodeId: arrowId }, arguments: remainingArgs },
            children: [arrowNode, ...remainingArgsChildren]
        };

        console.debug(`[TransformRule] ${FunctionInliningRule.id}: Inlined as IIFE (${iifeFnType}).`);
        return [iifeNode];
    }
};
