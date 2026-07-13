import { IRNode } from '../../../source_analyzer/ir_converter/IRNodeTypes';

export class CostEstimator {
    private static warnedTypes = new Set<string>();

    /**
     * 文字列を実際に生成することなく、IRツリーから最終的なJavaScript出力時の文字数（バイト数）をO(N)で推測計算します。
     * isTerserEnabled = true の場合、TerserによるPeephole変換（代入の短縮など）を先読みした見積もりを行います。
     */
    static estimate(node: IRNode, isTerserEnabled: boolean = false, logger?: (log: any) => void): number {
        if (!node) return 0;

        const nodeMap = new Map<string, IRNode>();
        const buildMap = (n: IRNode) => {
            nodeMap.set(n.irNodeId, n);
            if (n.children) n.children.forEach(buildMap);
        };
        buildMap(node);

        const calc = (n: IRNode): number => {
            if (!n) return 0;
            
            switch (n.type) {
                // --- プログラム・ブロック構造 ---
                case 'IRRoot':
                case 'File':
                case 'Program':
                case 'BlockStatement':
                case 'ClassBody':
                    return n.children.reduce((acc, c) => acc + calc(c) + 1, 0); 
                
                // --- 宣言 ---
                case 'VariableDeclaration':
                    return (isTerserEnabled ? 4 : 6) + n.children.reduce((acc, c) => acc + calc(c) + 1, 0);
                case 'VariableDeclarator':
                    return calcChild(n.props['id'], nodeMap, calc) + (isTerserEnabled ? 1 : 3) + calcChild(n.props['init'], nodeMap, calc);
                case 'AssignmentPattern':
                    return calcChild(n.props['left'], nodeMap, calc) + (isTerserEnabled ? 1 : 3) + calcChild(n.props['right'], nodeMap, calc);
                
                // --- 識別子・リテラル ---
                case 'Identifier':
                case 'JSXIdentifier':
                    if (isTerserEnabled && n.props['name'] === 'undefined') return 6; // Terser converts undefined to "void 0"
                    return n.props['name'] ? String(n.props['name']).length : 0;
                case 'NumericLiteral':
                    return n.props['value'] !== undefined ? String(n.props['value']).length : 0;
                case 'BooleanLiteral':
                    if (isTerserEnabled) return 2; // Terser converts true/false to !0 / !1
                    return n.props['value'] !== undefined ? String(n.props['value']).length : 0;
                case 'StringLiteral':
                case 'DirectiveLiteral':
                    return n.props['value'] ? String(n.props['value']).length + 2 : 2;
                case 'RegExpLiteral':
                    return n.props['pattern'] ? String(n.props['pattern']).length + 2 : 2;
                case 'NullLiteral':
                    return 4;
                case 'ThisExpression':
                    return 4;
                case 'Super':
                    return 5;
                case 'Import':
                    return 6;
                
                // --- 式・演算 ---
                case 'SequenceExpression': {
                    const exprs = n.props['expressions'] || [];
                    let seqCost = 0;
                    if (Array.isArray(exprs) && exprs.length > 0) {
                        seqCost = exprs.reduce((acc: number, e: any) => acc + calcChild(e, nodeMap, calc), 0);
                        seqCost += exprs.length - 1; // 要素間のカンマ(,)の数
                    }
                    return seqCost;
                }
                case 'BinaryExpression':
                case 'LogicalExpression':
                    const opLen = n.props['operator'] ? String(n.props['operator']).length : 0;
                    return calcChild(n.props['left'], nodeMap, calc) + opLen + (isTerserEnabled ? 0 : 2) + calcChild(n.props['right'], nodeMap, calc);
                
                case 'AssignmentExpression': {
                    const assignOpStr = String(n.props['operator'] || '=');
                    const leftCost = calcChild(n.props['left'], nodeMap, calc);
                    let rightCost = calcChild(n.props['right'], nodeMap, calc);
                    
                    let opCost = assignOpStr.length + (isTerserEnabled ? 0 : 2); // 空白削減

                    // Terserによる複合代入とインクリメントの先読み最適化予測
                    if (isTerserEnabled && assignOpStr === '=' && n.props['right'] && n.props['right'].type === 'ref') {
                        const rightNode = nodeMap.get(n.props['right'].irNodeId);
                        if (rightNode && rightNode.type === 'BinaryExpression') {
                            const binLeftNode = nodeMap.get(rightNode.props['left']?.irNodeId);
                            const binRightNode = nodeMap.get(rightNode.props['right']?.irNodeId);
                            const leftNode = nodeMap.get(n.props['left']?.irNodeId);
                            
                            if (leftNode && leftNode.type === 'Identifier') {
                                const leftName = leftNode.props['name'];
                                const isLeftMatch = binLeftNode?.type === 'Identifier' && binLeftNode.props['name'] === leftName;
                                const isRightMatch = binRightNode?.type === 'Identifier' && binRightNode.props['name'] === leftName;
                                
                                if (isLeftMatch || isRightMatch) {
                                    const otherNode = isLeftMatch ? binRightNode : binLeftNode;
                                    const binOpStr = String(rightNode.props['operator']);
                                    
                                    // x = x + 1 => x++ (2 chars)
                                    if ((binOpStr === '+' || binOpStr === '-') && otherNode?.type === 'NumericLiteral' && otherNode.props['value'] === 1) {
                                        return leftCost + 2; 
                                    }
                                    
                                    // x = x * 2 => x*=2
                                    opCost = binOpStr.length + 1; // e.g. "*="
                                    rightCost = otherNode ? calc(otherNode) : rightCost;
                                }
                            }
                        }
                    }
                    return leftCost + opCost + rightCost;
                }
                
                case 'UnaryExpression':
                    const uOp = n.props['operator'] ? String(n.props['operator']) : '';
                    return uOp.length + (uOp.match(/[a-z]/i) && !isTerserEnabled ? 1 : 0) + calcChild(n.props['argument'], nodeMap, calc);
                case 'AwaitExpression':
                    return 6 + calcChild(n.props['argument'], nodeMap, calc);
                case 'YieldExpression':
                    return 6 + (n.props['delegate'] ? 1 : 0) + calcChild(n.props['argument'], nodeMap, calc);
                case 'UpdateExpression':
                    return calcChild(n.props['argument'], nodeMap, calc) + 2;
                case 'ExpressionStatement':
                    return calcChild(n.props['expression'], nodeMap, calc) + (isTerserEnabled ? 0 : 1);
                case 'EmptyStatement':
                    return isTerserEnabled ? 0 : 1;
                
                // --- 関数・メソッド呼び出し ---
                case 'CallExpression':
                    let argsCost = 0;
                    const args = n.props['arguments'];
                    if (Array.isArray(args)) {
                        for (const arg of args) argsCost += calcChild(arg, nodeMap, calc) + 1;
                    }
                    return calcChild(n.props['callee'], nodeMap, calc) + 2 + argsCost;
                case 'OptionalCallExpression':
                    let optCallArgsCost = 0;
                    const optCallArgs = n.props['arguments'];
                    if (Array.isArray(optCallArgs)) {
                        for (const arg of optCallArgs) optCallArgsCost += calcChild(arg, nodeMap, calc) + 1;
                    }
                    return calcChild(n.props['callee'], nodeMap, calc) + 3 + optCallArgsCost;
                case 'NewExpression':
                    let newArgsCost = 0;
                    const newArgs = n.props['arguments'];
                    if (Array.isArray(newArgs)) {
                        for (const arg of newArgs) newArgsCost += calcChild(arg, nodeMap, calc) + 1;
                    }
                    return 4 + calcChild(n.props['callee'], nodeMap, calc) + 2 + newArgsCost;
                case 'MemberExpression':
                    const isComputed = n.props['computed'];
                    return calcChild(n.props['object'], nodeMap, calc) + (isComputed ? 2 : 1) + calcChild(n.props['property'], nodeMap, calc);
                case 'OptionalMemberExpression':
                    const isComputedOpt = n.props['computed'];
                    return calcChild(n.props['object'], nodeMap, calc) + (isComputedOpt ? 3 : 2) + calcChild(n.props['property'], nodeMap, calc);
                case 'ImportExpression':
                    return 7 + calcChild(n.props['source'], nodeMap, calc);
                
                // --- 配列・オブジェクト ---
                case 'ArrayExpression':
                case 'ArrayPattern':
                    const arrEls = n.props['elements'] || [];
                    let arrCost = 2;
                    if (Array.isArray(arrEls)) {
                        for (const el of arrEls) arrCost += calcChild(el, nodeMap, calc) + 1;
                    }
                    return arrCost;
                case 'ObjectExpression':
                case 'ObjectPattern':
                    const objProps = n.props['properties'] || [];
                    let objCost = 2;
                    if (Array.isArray(objProps)) {
                        for (const prop of objProps) objCost += calcChild(prop, nodeMap, calc) + 1;
                    }
                    return objCost;
                case 'ObjectProperty':
                    return calcChild(n.props['key'], nodeMap, calc) + (isTerserEnabled ? 1 : 2) + calcChild(n.props['value'], nodeMap, calc);
                case 'SpreadElement':
                case 'RestElement':
                    return 3 + calcChild(n.props['argument'], nodeMap, calc);

                // --- 制御構文・分岐 ---
                case 'IfStatement':
                case 'ConditionalExpression':
                    return (isTerserEnabled ? 2 : 4) + calcChild(n.props['test'], nodeMap, calc) + 2 + calcChild(n.props['consequent'], nodeMap, calc) + (n.props['alternate'] ? (isTerserEnabled ? 1 : 4) + calcChild(n.props['alternate'], nodeMap, calc) : 0);
                case 'SwitchStatement':
                    let casesCost = 0;
                    const cases = n.props['cases'] || [];
                    if (Array.isArray(cases)) {
                        for (const c of cases) casesCost += calcChild(c, nodeMap, calc);
                    }
                    return (isTerserEnabled ? 6 : 8) + calcChild(n.props['discriminant'], nodeMap, calc) + 4 + casesCost;
                case 'SwitchCase':
                    return (n.props['test'] ? (isTerserEnabled ? 4 : 5) + calcChild(n.props['test'], nodeMap, calc) : (isTerserEnabled ? 6 : 7)) + 1 + n.children.reduce((acc, c) => acc + calc(c) + 1, 0);
                case 'LabeledStatement':
                    return calcChild(n.props['label'], nodeMap, calc) + 1 + calcChild(n.props['body'], nodeMap, calc);
                
                // --- ループ ---
                case 'ForStatement':
                    return 4 + calcChild(n.props['init'], nodeMap, calc) + 1 + calcChild(n.props['test'], nodeMap, calc) + 1 + calcChild(n.props['update'], nodeMap, calc) + 2 + calcChild(n.props['body'], nodeMap, calc);
                case 'ForOfStatement':
                case 'ForInStatement':
                    return 5 + calcChild(n.props['left'], nodeMap, calc) + (isTerserEnabled ? 2 : 4) + calcChild(n.props['right'], nodeMap, calc) + 2 + calcChild(n.props['body'], nodeMap, calc);
                case 'WhileStatement':
                    return (isTerserEnabled ? 5 : 7) + calcChild(n.props['test'], nodeMap, calc) + 2 + calcChild(n.props['body'], nodeMap, calc);
                case 'DoWhileStatement':
                    return 5 + calcChild(n.props['body'], nodeMap, calc) + (isTerserEnabled ? 5 : 7) + calcChild(n.props['test'], nodeMap, calc) + 2;
                
                // --- 制御移動・例外処理 ---
                case 'ReturnStatement':
                    return (isTerserEnabled ? 6 : 7) + calcChild(n.props['argument'], nodeMap, calc);
                case 'BreakStatement':
                case 'ContinueStatement':
                    return (n.type === 'BreakStatement' ? 5 : 8) + (n.props['label'] ? 1 + calcChild(n.props['label'], nodeMap, calc) : 0) + (isTerserEnabled ? 0 : 1);
                case 'ThrowStatement':
                    return 6 + calcChild(n.props['argument'], nodeMap, calc);
                case 'TryStatement':
                    return 5 + calcChild(n.props['block'], nodeMap, calc) + calcChild(n.props['handler'], nodeMap, calc) + (n.props['finalizer'] ? 7 + calcChild(n.props['finalizer'], nodeMap, calc) : 0);
                case 'CatchClause':
                    return 5 + calcChild(n.props['param'], nodeMap, calc) + 2 + calcChild(n.props['body'], nodeMap, calc);

                // --- テンプレート文字列 ---
                case 'TemplateLiteral':
                    let tmplCost = 2;
                    if (Array.isArray(n.props['quasis'])) tmplCost += n.props['quasis'].reduce((acc: number, q: any) => acc + calcChild(q, nodeMap, calc), 0);
                    if (Array.isArray(n.props['expressions'])) tmplCost += n.props['expressions'].reduce((acc: number, e: any) => acc + 3 + calcChild(e, nodeMap, calc), 0);
                    return tmplCost;
                case 'TemplateElement':
                    return n.props['value']?.raw ? String(n.props['value'].raw).length : 0;
                
                // --- 関数・クラス定義 ---
                case 'ArrowFunctionExpression':
                case 'FunctionDeclaration':
                case 'FunctionExpression':
                case 'ClassMethod':
                case 'ObjectMethod': {
                    let paramCost = 0;
                    const params = n.props['params'] || [];
                    if (Array.isArray(params)) {
                        for (const p of params) paramCost += calcChild(p, nodeMap, calc) + 1;
                    }
                    
                    let methodKeyCost = 0;
                    if (n.type === 'ClassMethod' || n.type === 'ObjectMethod') {
                        methodKeyCost = calcChild(n.props['key'], nodeMap, calc);
                        if (n.props['computed']) {
                            methodKeyCost += 2; // []
                        }
                        if (n.props['kind'] === 'get' || n.props['kind'] === 'set') {
                            methodKeyCost += 4; // 'get ' or 'set '
                        }
                    }

                    const baseCost = n.type === 'ArrowFunctionExpression' ? 4 : (isTerserEnabled ? 8 : 9);
                    const nameCost = n.type === 'ArrowFunctionExpression' 
                        ? 0 
                        : (n.type === 'ClassMethod' || n.type === 'ObjectMethod' ? methodKeyCost : calcChild(n.props['id'], nodeMap, calc));
                    
                    return baseCost + paramCost + nameCost + calcChild(n.props['body'], nodeMap, calc);
                }
                case 'ClassDeclaration':
                case 'ClassExpression':
                    return 6 + calcChild(n.props['id'], nodeMap, calc) + (n.props['superClass'] ? 9 + calcChild(n.props['superClass'], nodeMap, calc) : 0) + calcChild(n.props['body'], nodeMap, calc);
                
                case 'ClassProperty':
                case 'PropertyDefinition': {
                    let propCost = calcChild(n.props['key'], nodeMap, calc);
                    if (n.props['computed']) {
                        propCost += 2;
                    }
                    if (n.props['value']) {
                        propCost += (isTerserEnabled ? 1 : 3) + calcChild(n.props['value'], nodeMap, calc);
                    }
                    if (n.props['static']) {
                        propCost += 7;
                    }
                    return propCost;
                }
                case 'StaticBlock':
                    return 7 + n.children.reduce((acc, c) => acc + calc(c) + 1, 0); // static { ... }
                
                case 'ImportDeclaration':
                case 'ExportNamedDeclaration':
                case 'ExportDefaultDeclaration':
                case 'ExportAllDeclaration':
                    return 15 + n.children.reduce((acc, c) => acc + calc(c) + 1, 0);

                case 'ImportSpecifier':
                    return calcChild(n.props['imported'], nodeMap, calc) + (n.props['local'] ? calcChild(n.props['local'], nodeMap, calc) + (isTerserEnabled ? 2 : 4) : 0);

                case 'ImportDefaultSpecifier':
                    return calcChild(n.props['local'], nodeMap, calc);

                case 'ImportNamespaceSpecifier':
                    return calcChild(n.props['local'], nodeMap, calc) + (isTerserEnabled ? 2 : 4);

                case 'ExportSpecifier':
                    return calcChild(n.props['local'], nodeMap, calc) + (n.props['exported'] ? calcChild(n.props['exported'], nodeMap, calc) + (isTerserEnabled ? 2 : 4) : 0);

                case 'CommentLine':
                case 'CommentBlock':
                    return 0; 
                
                default:
                    if (!CostEstimator.warnedTypes.has(n.type)) {
                        CostEstimator.warnedTypes.add(n.type);
                        const msg = `[CostEstimator] Unknown node type encountered: '${n.type}' (NodeID: ${n.irNodeId}). Using fallback estimation.`;
                        if (logger) {
                            logger({ type: 'error', msg }); // UIのログパネルへ転送
                        } else {
                            console.warn(msg);
                        }
                    }
                    return n.children.reduce((acc, c) => acc + calc(c) + 1, 0) + 2;
            }
        };

        return calc(node);
    }
}

function calcChild(ref: any, nodeMap: Map<string, IRNode>, calcFn: (n: IRNode) => number): number {
    if (ref && ref.type === 'ref') {
        const child = nodeMap.get(ref.irNodeId);
        return child ? calcFn(child) : 0;
    }
    return 0;
}