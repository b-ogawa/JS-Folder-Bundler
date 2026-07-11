export const COMPILER_CONSTANTS = {
    // ブラウザ特有のグローバル変数（Tree Shakingやスコープ保護の判定に使用）
    BROWSER_GLOBALS: new Set(['window', 'document', 'screen', 'history', 'navigator', 'localStorage', 'sessionStorage']),
    
    // 変数初期化時などに「副作用」とみなすノードタイプ
    SIDE_EFFECT_NODE_TYPES: new Set([
        'CallExpression', 
        'NewExpression', 
        'AssignmentExpression', 
        'UpdateExpression', 
        'AwaitExpression', 
        'YieldExpression'
    ])
};
