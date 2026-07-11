import { IRRoot, IRNode } from '../../source_analyzer/ir_converter/ASTtoIRConverter';

export interface StatementInfo {
    irNodeId: string;
    type: 'Declaration' | 'SideEffect';
    defines: Set<string>;      // 定義している変数のASTノードID (irNodeId)
    references: Set<string>;   // この文の内部で参照している変数の宣言ASTノードID (declId)
    node: IRNode;              // 実際の AST ノード
    chunkReferences?: Set<string>; // この文が参照している「別チャンク（Workerなど）」のパス
    sideEffectImportPath?: string; // 副作用インポート用のソースパス
    classicImports?: string[]; // クラシックスクリプト同期インポートパス
    dynamicImports?: string[]; // 動的インポート（import()）の依存パス追跡用
}

export interface ImportInfo {
    sourcePath: string;        // インポート元のモジュールパス
    importedName: string;      // 'default', '*', または名前付きエクスポート名
    localName: string;         // ローカルの変数名
    localDeclId: string;       // ローカルの Identifier IRNodeId
}

export interface ModuleInfo {
    filePath: string;
    basePath: string;
    statements: Map<string, StatementInfo>; // irNodeId -> StatementInfo
    exports: Map<string, string>;           // 公開名 -> 実体の irNodeId (declId)
    imports: Map<string, ImportInfo>;       // ローカルの Identifier IRNodeId -> 依存先情報
    isEntry: boolean;
    tree: IRRoot;                           // 元の IRRoot
}
