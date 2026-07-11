let nextAstId = 1;
let nextScopeId = 1;

export interface IRScope {
    scopeId: string;
    parentScopeId: string | null;
    isBlockScope: boolean;
    hasEval: boolean;
}

export interface IRBinding {
    name: string;
    scopeId: string;
    references: string[];
}

export type ScopeInfo = {
    bindings: Map<string, IRBinding>;  // astNodeId -> IRBinding
    scopes: Map<string, IRScope>;      // scopeId -> IRScope
    escapedVars: Set<string>;          // astNodeId
    errors: string[];
};

export class ScopeAnalyzer {
    public static resetCounters() {
        nextAstId = 1;
        nextScopeId = 1;
    }

    static analyze(ast: any): ScopeInfo {
        const traverse = (globalThis as any).Babel?.traverse;
        if (!traverse) {
            throw new Error('Babel.traverse is not initialized on globalThis.Babel');
        }

        const scopeInfo: ScopeInfo = {
            bindings: new Map(),
            scopes: new Map(),
            escapedVars: new Set(),
            errors: []
        };
        
        const scopeMap = new Map<any, string>();
        
        function getOrCreateScopeId(babelScope: any): string {
            if (!babelScope) return null as any;
            if (scopeMap.has(babelScope)) {
                return scopeMap.get(babelScope)!;
            }
            const scopeId = `scope_${nextScopeId++}`;
            scopeMap.set(babelScope, scopeId);
            
            const parentScopeId = babelScope.parent ? getOrCreateScopeId(babelScope.parent) : null;
            
            scopeInfo.scopes.set(scopeId, {
                scopeId,
                parentScopeId,
                isBlockScope: !!(babelScope.path && babelScope.path.isBlockStatement()),
                hasEval: !!babelScope.hasEval,
            });
            
            return scopeId;
        }

        try {
            // 第1パス：IDの付与とスコープの収集
            traverse(ast, {
                enter(path: any) {
                    if (!path.node._astNodeId) {
                        path.node._astNodeId = `ast_${nextAstId++}`;
                    }
                    if (path.scope) {
                        getOrCreateScopeId(path.scope);
                    }
                }
            });

            // バインディングとリファレンスの抽出
            for (const [babelScope, scopeId] of scopeMap.entries()) {
                for (const [name, binding] of Object.entries(babelScope.bindings)) {
                    const b = binding as any;
                    if (!b.identifier._astNodeId) { 
                        b.identifier._astNodeId = `ast_${nextAstId++}`;
                    }
                    const astNodeId = b.identifier._astNodeId;
                    
                    const references = new Set<string>();
                    
                    for (const refPath of b.referencePaths) {
                        if (refPath.node && refPath.node._astNodeId) {
                            references.add(refPath.node._astNodeId);
                        }
                    }
                    
                    for (const cvPath of b.constantViolations) { 
                         const ids = cvPath.getBindingIdentifiers(); 
                         for (const id of Object.values(ids) as any[]) {
                              if (id.name === name && id._astNodeId) {
                                  references.add(id._astNodeId);
                              }
                         }
                    }
                    
                    scopeInfo.bindings.set(astNodeId, {
                        name,
                        scopeId,
                        references: Array.from(references)
                    });
                }
            }

            // エスケープ変数の検知
            traverse(ast, {
                Identifier(path: any) {
                    const name = path.node.name;
                    if (path.scope.hasBinding(name, true)) {
                        const binding = path.scope.getBinding(name);
                        if (binding && binding.scope !== path.scope) {
                            const bindingFn = binding.scope.getFunctionParent() || binding.scope.getProgramParent();
                            const pathFn = path.scope.getFunctionParent() || path.scope.getProgramParent();
                            if (bindingFn !== pathFn) {
                                if (binding.identifier._astNodeId) {
                                    scopeInfo.escapedVars.add(binding.identifier._astNodeId);
                                }
                            }
                        }
                    } else {
                        scopeInfo.escapedVars.add(path.node._astNodeId);
                    }
                }
            });
        } catch (e: any) {
            console.error("[ScopeAnalyzer] 意味解析エラー:", e.message);
            scopeInfo.errors.push(e.message);
        }

        return scopeInfo;
    }
}
