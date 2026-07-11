import { IRNode } from '../../../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { PipelineStage } from '../../../../../infra/Pipeline';
import { MergeContext } from '../MergeContext';

export class AssembleFinalBundleStage implements PipelineStage<MergeContext> {
    public readonly name = 'AssembleFinalBundleStage';

    // ボイラープレート（ランタイムポリフィル）内の識別子をDCEの削除対象から保護する
    private protectFromDCE(nodes: IRNode[], context: MergeContext) {
        const walk = (node: IRNode) => {
            if (node.type === 'Identifier') {
                context.mergedScopeInfo.escapedVars.add(node.irNodeId);
                if (node.props['_declId']) {
                    context.mergedScopeInfo.escapedVars.add(node.props['_declId']);
                }
            }
            if (node.children) {
                node.children.forEach(walk);
            }
        };
        nodes.forEach(walk);
    }

    execute(context: MergeContext): void {
        const programNode = context.linkedRoot.children[0].children[0];
        programNode.children = [];
        programNode.props['body'] = [];

        // 1. Worker用のランタイムポリフィルの注入
        if (context.workerEntryBases && context.workerEntryBases.size > 0) {
            let mapEntries = '';
            for (const [wBase, safeChunkId] of context.chunkIdMap.entries()) {
                mapEntries += `"${wBase}": "${safeChunkId}", `;
            }
            const workerPolyfillCode = `
                (function() {
                    var _g = typeof globalThis !== 'undefined' ? globalThis : self;
                    if (_g.window) {
                        var chunkMap = { ${mapEntries} };
                        
                        function getInterceptedUrl(url, isShared) {
                            var urlStr = (typeof url === 'string') ? url : (url && url.href ? url.href : String(url));
                            if (urlStr.indexOf(_g.location.origin) === 0) {
                                urlStr = urlStr.substring(_g.location.origin.length);
                            }
                            if (!urlStr.startsWith('blob:') && !urlStr.startsWith('http:') && !urlStr.startsWith('https:') && !urlStr.startsWith('data:')) {
                                var cleanUrl = urlStr.split('?')[0].replace(/^\\.?\\//, '').replace(/\\.js$/, '');
                                var chunkId = chunkMap[cleanUrl] || chunkMap[urlStr];
                                if (!chunkId) {
                                    for (var mapKey in chunkMap) {
                                        if (mapKey.endsWith(cleanUrl) || cleanUrl.endsWith(mapKey)) {
                                            chunkId = chunkMap[mapKey];
                                            break;
                                        }
                                    }
                                }
                                if (chunkId) {
                                    var script = _g.document.getElementById("${context.bundleId || 'bundle_default'}") || _g.document.scripts[_g.document.scripts.length - 1];
                                    if (script) {
                                        var code = "var __chunkId = '" + chunkId + "';\\n" + script.textContent;
                                        if (isShared) {
                                            return 'data:application/javascript,' + encodeURIComponent(code);
                                        }
                                        var blob = new Blob([code], { type: 'application/javascript' });
                                        return _g.URL.createObjectURL(blob);
                                    }
                                }
                            }
                            return null;
                        }

                        if (_g.Worker) {
                            var OriginalWorker = _g.Worker;
                            _g.Worker = function(url, options) {
                                var intercepted = getInterceptedUrl(url, false);
                                return new OriginalWorker(intercepted || url, options);
                            };
                            _g.Worker.prototype = OriginalWorker.prototype;
                        }

                        if (_g.SharedWorker) {
                            var OriginalSharedWorker = _g.SharedWorker;
                            _g.SharedWorker = function(url, options) {
                                var intercepted = getInterceptedUrl(url, true);
                                return new OriginalSharedWorker(intercepted || url, options);
                            };
                            _g.SharedWorker.prototype = OriginalSharedWorker.prototype;
                        }
                    }
                })();
            `;
            const polyfillAst = context.parseTemplate(workerPolyfillCode);
            if (polyfillAst && polyfillAst.length > 0) {
                this.protectFromDCE(polyfillAst, context);
                for (const pNode of polyfillAst.reverse()) {
                    context.commonStatements.unshift(pNode);
                }
            }
        }

        // 2. 共通（Common）ステートメントを配置
        for (const stmt of context.commonStatements) {
            programNode.children.push(stmt);
            programNode.props['body'].push({ type: 'ref', irNodeId: stmt.irNodeId });
        }

        // 3. ボイラープレート関数の生成と配置
        if (context.needsChunkUrlBoilerplate) {
            const boilerplates = this.createChunkUrlBoilerplate(
                context.chunkUrlFuncName,
                context.bundleId || 'bundle_default',
                context.parseTemplate
            );
            this.protectFromDCE(boilerplates, context);
            for (const bNode of boilerplates) {
                programNode.children.push(bNode);
                programNode.props['body'].push({ type: 'ref', irNodeId: bNode.irNodeId });
            }
        }

        if (context.needsSpawnBoilerplate) {
            const boilerplates = this.createSelfSpawningBoilerplate(
                context.spawnFuncName,
                context.chunkUrlFuncName,
                context.parseTemplate
            );
            this.protectFromDCE(boilerplates, context);
            for (const bNode of boilerplates) {
                programNode.children.push(bNode);
                programNode.props['body'].push({ type: 'ref', irNodeId: bNode.irNodeId });
            }
        }

        // 4. 空になった Worker チャンクの Tree Shaking クリーンアップ
        let hasWorkers = false;
        for (const [workerId, stmts] of context.workerStatementsMap.entries()) {
            if (stmts.length === 0) {
                if (context.logger) {
                    context.logger({ 
                        type: 'info', 
                        msg: `[Tree Shaking] Chunk "${workerId}" became empty after dead code elimination. Skipping chunk generation.` 
                    });
                }
                context.workerStatementsMap.delete(workerId);
            } else {
                hasWorkers = true;
            }
        }

        // 5. 分岐構造 (Main / Worker 実行パス) の生成と AST 連結
        if (hasWorkers) {
            const branchNodes = this.createMainAndWorkerBranches(
                context.mainStatements,
                context.workerStatementsMap,
                context.chunkIdMap,
                context.parseTemplate,
                context 
            );
            for (const bNode of branchNodes) {
                programNode.children.push(bNode);
                programNode.props['body'].push({ type: 'ref', irNodeId: bNode.irNodeId });
            }
        } else {
            for (const stmt of context.mainStatements) {
                programNode.children.push(stmt);
                programNode.props['body'].push({ type: 'ref', irNodeId: stmt.irNodeId });
            }
        }
    }

    private createSelfSpawningBoilerplate(
        spawnFuncName: string,
        chunkUrlFuncName: string,
        parseTemplate: (code: string) => IRNode[]
    ): IRNode[] {
        const code = `
            function ${spawnFuncName}(workerId, workerType, options) {
                var opts = Object.assign({ type: 'module' }, options);
                var isShared = workerType === 'SharedWorker';
                var url = ${chunkUrlFuncName}(workerId, isShared);
                return isShared ? new SharedWorker(url, opts) : new Worker(url, opts);
            }
        `;
        return parseTemplate(code);
    }

    private createChunkUrlBoilerplate(
        funcName: string,
        bundleId: string,
        parseTemplate: (code: string) => IRNode[]
    ): IRNode[] {
        const code = `
            function ${funcName}(chunkId, isShared) {
                var _g = typeof globalThis !== 'undefined' ? globalThis : self;
                if (_g.document) {
                    var script = _g.document.getElementById("${bundleId}") || _g.document.scripts[_g.document.scripts.length - 1];
                    var code = "var __chunkId = '" + chunkId + "';\\n" + script.textContent;
                    if (isShared) {
                        return 'data:application/javascript,' + encodeURIComponent(code);
                    }
                    var blob = new Blob([code], { type: 'application/javascript' });
                    return _g.URL.createObjectURL(blob);
                } else {
                    var baseUrl = _g.location.href.split('#')[0].split('?')[0];
                    return baseUrl + '#__chunkId=' + chunkId;
                }
            }
        `;
        return parseTemplate(code);
    }

    private createMainAndWorkerBranches(
        mainStatements: IRNode[],
        workerStatementsMap: Map<string, IRNode[]>,
        chunkIdMap: Map<string, string>,
        parseTemplate: (code: string) => IRNode[],
        context: MergeContext 
    ): IRNode[] {
        let workerBranchesCode = '';
        const workerKeys = Array.from(workerStatementsMap.keys()).reverse();
        
        for (const workerId of workerKeys) {
            const safeChunkId = chunkIdMap.get(workerId) || `chunk_${workerId.replace(/[^a-zA-Z0-9]/g, '_')}`;
            workerBranchesCode += `
                else if (_chunkId === '${safeChunkId}') {
                    __INJECT_WORKER_${safeChunkId}__();
                }
            `;
        }

        const code = `
            var _g = typeof globalThis !== 'undefined' ? globalThis : self;
            var _chunkId = typeof __chunkId !== 'undefined' ? __chunkId : (
                (_g.location && _g.location.hash && _g.location.hash.indexOf('__chunkId=') !== -1) ? _g.location.hash.split('__chunkId=')[1].split('&')[0] : 
                ((_g.location && _g.location.search && _g.location.search.indexOf('__chunkId=') !== -1) ? new URLSearchParams(_g.location.search).get('__chunkId') : null)
            );
            var __isWorker = !_g.document;
            
            if (__isWorker) {
                var __mq = [];
                var __mo = null;
                var __hl = [];
                
                // ネイティブセッターへの横流しを削除し、二重発火を防止
                Object.defineProperty(_g, 'onmessage', {
                    configurable: true,
                    get: function() { return __mo; },
                    set: function(v) {
                        __mo = v;
                        if (v && __mq.length > 0) {
                            var q = __mq; __mq = [];
                            q.forEach(function(e) { v.call(_g, e); });
                        }
                    }
                });
                var __oal = _g.addEventListener;
                _g.addEventListener = function(type, listener, options) {
                    if (type === 'message') {
                        __hl.push(listener);
                        if (__mq.length > 0) {
                            var q = __mq; __mq = [];
                            q.forEach(function(e) {
                                if (typeof listener === 'function') listener(e);
                                else if (listener && listener.handleEvent) listener.handleEvent(e);
                            });
                        }
                    }
                    return __oal.call(_g, type, listener, options);
                };
                __oal.call(_g, 'message', function(e) {
                    if (__mo) {
                        __mo.call(_g, e);
                    } else if (__hl.length === 0) {
                        __mq.push(e);
                    }
                });
            }
            
            if (!__isWorker && (!_chunkId || _chunkId === 'main')) {
                var __boot = function() {
                    var __run = function() { setTimeout(async function() { __INJECT_MAIN__(); }, 0); };
                    if (_g.requestAnimationFrame) {
                        _g.requestAnimationFrame(__run);
                    } else {
                        __run();
                    }
                };
                if (_g.document && _g.document.readyState === 'complete') {
                    __boot();
                } else if (_g.window) {
                    _g.window.addEventListener('load', __boot);
                } else {
                    __boot();
                }
            } ${workerBranchesCode}
        `;

        const astNodes = parseTemplate(code);

        // ユーザーのコードが注入（プレースホルダー置換）される前に、ボイラープレート部分だけをDCEから保護する
        this.protectFromDCE(astNodes, context);

        const branchAst = [...astNodes].reverse().find(node => node.type === 'IfStatement');

        if (branchAst) {
            this.replacePlaceholderWithStatements(branchAst, '__INJECT_MAIN__', mainStatements);
            
            for (const workerId of workerKeys) {
                const safeChunkId = chunkIdMap.get(workerId) || `chunk_${workerId.replace(/[^a-zA-Z0-9]/g, '_')}`;
                const stmts = workerStatementsMap.get(workerId) || [];
                this.replacePlaceholderWithStatements(branchAst, `__INJECT_WORKER_${safeChunkId}__`, stmts);
            }
        }

        return astNodes;
    }

    private replacePlaceholderWithStatements(ast: IRNode, placeholderName: string, statements: IRNode[]): void {
        let replaced = false;
        const walk = (node: IRNode) => {
            if (node.type === 'BlockStatement' || node.type === 'Program') {
                const bodyRefs = node.props['body'];
                if (Array.isArray(bodyRefs)) {
                    let indexToReplace = -1;
                    for (let i = 0; i < bodyRefs.length; i++) {
                        const ref = bodyRefs[i];
                        if (ref && ref.type === 'ref') {
                            const child = node.children.find(c => c.irNodeId === ref.irNodeId);
                            if (child && child.type === 'ExpressionStatement') {
                                const exprRef = child.props['expression'];
                                if (exprRef && exprRef.type === 'ref') {
                                    const exprNode = child.children.find(c => c.irNodeId === exprRef.irNodeId);
                                    if (exprNode && exprNode.type === 'CallExpression') {
                                        const calleeRef = exprNode.props['callee'];
                                        if (calleeRef && calleeRef.type === 'ref') {
                                            const calleeNode = exprNode.children.find(c => c.irNodeId === calleeRef.irNodeId);
                                            if (calleeNode && calleeNode.type === 'Identifier' && calleeNode.props['name'] === placeholderName) {
                                                indexToReplace = i;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (indexToReplace !== -1) {
                        const targetRef = bodyRefs[indexToReplace];
                        const newRefs = statements.map(s => ({ type: 'ref', irNodeId: s.irNodeId }));
                        bodyRefs.splice(indexToReplace, 1, ...newRefs);

                        const childIndex = node.children.findIndex(c => c.irNodeId === targetRef.irNodeId);
                        if (childIndex !== -1) {
                            node.children.splice(childIndex, 1, ...statements);
                        }
                        replaced = true;
                    }
                }
            }
            if (node.children) node.children.forEach(walk);
        };
        walk(ast);

        if (!replaced) {
            throw new Error(`[Compiler Internal Error] Template injection failed. Placeholder "${placeholderName}" was not found in the AST.`);
        }
    }
}
