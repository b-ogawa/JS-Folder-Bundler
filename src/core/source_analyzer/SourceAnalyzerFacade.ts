import { ASTBuilder } from './ast_builder/ASTBuilder';
import { ASTtoIRConverter, IRRoot } from './ir_converter/ASTtoIRConverter';
import { TokenExtractor } from './token_extractor/TokenExtractor';
import { IRtoASTConverter } from './ir_converter/IRtoASTConverter';
import { ScopeAnalyzer } from './scope_analyzer/ScopeAnalyzer';
import { VirtualFileSystem } from '../asset_extractor/VirtualFileSystem';
import { AssetFilter, FilterOptions } from '../utils/AssetFilter';

export class SourceAnalyzerFacade {
    /**
     * Parse multiple files from VFS
     */
    static analyzeAll(vfs: VirtualFileSystem, options?: FilterOptions): IRRoot[] {
        ASTtoIRConverter.resetCounter();
        ScopeAnalyzer.resetCounters();
        const roots: IRRoot[] = [];
        for (const [filePath, content] of vfs.getAll()) {
            // AssetFilter を用いて、tsconfig.json などを加味したデータ駆動判定を行う
            if (AssetFilter.isTargetJS(filePath, vfs, options)) {
                roots.push(this.analyzeToIR(content, filePath, vfs));
            }
        }
        return roots;
    }

    /**
     * Source code to IR translation
     */
    static analyzeToIR(sourceCode: string, filePath: string, vfs?: VirtualFileSystem): IRRoot {
        try {
            // 1. AST構築 (filePathとvfsを渡して自動判定させる)
            const ast = ASTBuilder.build(sourceCode, filePath, vfs);
            
            // 2. 意味解析 (スコープとバインディングの抽出、AST ID付与)
            const scopeInfo = ScopeAnalyzer.analyze(ast);

            // 3. IR変換
            const irRoot = ASTtoIRConverter.convert(ast, scopeInfo, filePath);
            
            return irRoot;
        } catch (e: any) {
            throw new Error(`Failed to analyze file ${filePath}:\n${e.message}`);
        }
    }

    /**
     * IR to Source code reconstruction
     */
    static generateFromIR(irRoot: IRRoot): string {
        try {
            if (irRoot.children.length === 0) return '';
            
            const rootNode = irRoot.children[0];
            const ast = IRtoASTConverter.convert(rootNode);
            
            const Babel = (globalThis as any).Babel;
            if (!Babel) {
                throw new Error("Babel is not loaded on globalThis.");
            }

            // コメント二重出力バグの根本解決 (参照の重複マージ)
            if (Babel.traverse) {
                const commentMap = new Map<string, any>();
                Babel.traverse(ast, {
                    enter(path: any) {
                        const keys = ['leadingComments', 'trailingComments', 'innerComments'];
                        keys.forEach(key => {
                            if (path.node[key] && Array.isArray(path.node[key])) {
                                path.node[key] = path.node[key].map((c: any) => {
                                    // start/end はIR化で消滅しているため、種類と内容でIDを生成する
                                    const id = `${c.type}-${c.value}`;
                                    if (!commentMap.has(id)) {
                                        commentMap.set(id, c);
                                    }
                                    return commentMap.get(id); // 常に同一のオブジェクト参照を返す
                                });
                            }
                        });
                    }
                });
            }

            
            const result = Babel.transformFromAstSync 
                ? Babel.transformFromAstSync(ast, undefined, { code: true, ast: false, minified: false })
                : Babel.transformFromAst(ast, undefined, { code: true, ast: false, minified: false });
            
            return result.code || '';
        } catch (e: any) {
            throw new Error(`Failed to generate code from IR:\n${e.message}`);
        }
    }

    /**
     * (Optional) direct token extraction
     */
    static extractTokens(sourceCode: string) {
        return TokenExtractor.extract(sourceCode);
    }
}
