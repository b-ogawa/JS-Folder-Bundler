export interface RuleMetadata {
    id: string;
    type: 'macro' | 'micro';
    name: string;
    description: string;
    defaultEnabled: boolean;
}

/**
 * UIや設定が参照するための「純粋なデータ（メタデータ）」。
 * コンパイラエンジンへの依存（import）を一切持たないため、UI側に引きずり込まれても安全。
 */
export const RULE_DEFINITIONS: Record<string, RuleMetadata> = {
    'micro:constant-folding': {
        id: 'micro:constant-folding',
        type: 'micro',
        name: '定数畳み込み (Constant Folding)',
        description: '静的に確定する計算（例: 1 + 2）を事前に行い、リテラル（3）に置換します。',
        defaultEnabled: false
    },
    'micro:if-to-ternary': {
        id: 'micro:if-to-ternary',
        type: 'micro',
        name: 'If文の三項演算子化 (If to Ternary)',
        description: 'シンプルなif/else代入やif/else式を、より短い三項演算子に変換します。',
        defaultEnabled: false
    },
    'micro:statement-merge': {
        id: 'micro:statement-merge',
        type: 'micro',
        name: '連続式文のカンマ結合 (Statement Merge)',
        description: '連続する式文をカンマ演算子で1つに結合し、IfToTernaryRuleの連鎖発動を誘発します。',
        defaultEnabled: true
    },
    'micro:var-decl-merge': {
        id: 'micro:var-decl-merge',
        type: 'micro',
        name: '変数宣言の結合 (Variable Declaration Merge)',
        description: '連続する同じ種類(let/const)の変数宣言をカンマで結合します。',
        defaultEnabled: true
    },
    'micro:dead-store-elimination': {
        id: 'micro:dead-store-elimination',
        type: 'micro',
        name: '不要代入の削除 (Dead Store Elimination)',
        description: '再代入などで上書きされて一度も読み取られない無駄な代入や初期化コードを削除します。',
        defaultEnabled: false
    },
    'micro:copy-propagation': {
        id: 'micro:copy-propagation',
        type: 'micro',
        name: 'コピー伝播 (Copy Propagation)',
        description: '変数から変数への単純コピー（例: a = b）がある場合、直接元の変数に書き換えます。',
        defaultEnabled: false
    },
    'micro:constant-propagation': {
        id: 'micro:constant-propagation',
        type: 'micro',
        name: '定数伝播 (Constant Propagation)',
        description: '不変な定数の参照を、直接そのリテラル値に書き換えて展開します。',
        defaultEnabled: false
    },
    'micro:object-property-propagation': {
        id: 'micro:object-property-propagation',
        type: 'micro',
        name: 'オブジェクト・プロパティの定数伝播',
        description: 'オブジェクトリテラルとして定義され、ミューテーションを受けていないオブジェクトのプロパティアクセスをリテラル値に展開します。',
        defaultEnabled: false
    },
    'micro:logical-simplification': {
        id: 'micro:logical-simplification',
        type: 'micro',
        name: '論理式の代数的単純化',
        description: '論理式（&&, ||, == など）に対してブール代数の法則を適用し、不要なキャストや比較を削減します。',
        defaultEnabled: false
    },
    'micro:pure-function-evaluation': {
        id: 'micro:pure-function-evaluation',
        type: 'micro',
        name: 'Pure関数（純粋関数）の評価と消去',
        description: '引数がすべて定数で、副作用のない関数呼び出しをコンパイル時に計算して結果の定数に置き換えます。',
        defaultEnabled: false
    },
    'micro:unreachable-code-elimination': {
        id: 'micro:unreachable-code-elimination',
        type: 'micro',
        name: '到達不能コード削除 (Unreachable Code Elimination)',
        description: 'if (true) や if (false) の分岐を静的に判定し、通らない方のコードブロックを除去します。',
        defaultEnabled: false
    },
    'macro:dead-code-elimination': {
        id: 'macro:dead-code-elimination',
        type: 'macro',
        name: 'デッドコード削除 (DCE)',
        description: 'どこからも参照されていない、あるいは実行されることのない不要な変数や関数宣言を削除します。',
        defaultEnabled: true
    },
    'macro:global-aliasing': {
        id: 'macro:global-aliasing',
        type: 'macro',
        name: 'グローバル参照のエイリアス抽出',
        description: '頻出するグローバルオブジェクトへの参照をエイリアス変数にまとめます。',
        defaultEnabled: false
    },
    'macro:tail-duplication': {
        id: 'macro:tail-duplication',
        type: 'macro',
        name: '末尾展開 (Tail Duplication)',
        description: 'if文やswitch文 of 直後の合流点を複製して分解し、状態マージによる情報の喪失を防ぎます。',
        defaultEnabled: false
    },
    'macro:class-to-tuple': {
        id: 'macro:class-to-tuple',
        type: 'macro',
        name: 'クラスの配列（タプル）化',
        description: '完全に隠蔽されたデータ用クラス（DTO）を通常の配列へと変換し、高効率・低フットプリント化します。',
        defaultEnabled: false
    },
    'macro:function-inlining': {
        id: 'macro:function-inlining',
        type: 'macro',
        name: '完全関数インライン展開 (Full Inlining)',
        description: '関数の呼び出し先を解析し、安全な引数を内部に直接埋め込んで展開します。',
        defaultEnabled: false
    }
};

export const ALL_RULES_METADATA: RuleMetadata[] = Object.values(RULE_DEFINITIONS);
