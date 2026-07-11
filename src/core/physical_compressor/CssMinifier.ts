export class CssMinifier {
    static minify(css: string): string {
        if (!css) return '';

        const placeholders: string[] = [];
        const stringRegex = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\([^)]+\))/gi;
        
        let minified = css.replace(stringRegex, (match) => {
            const id = `___CSS_STR_${placeholders.length}___`;
            placeholders.push(match);
            return id;
        });

        // 1. コメント削除
        minified = minified.replace(/\/\*[\s\S]*?\*\//g, '');
        // 2. 改行や連続スペースを単一スペースに
        minified = minified.replace(/\s+/g, ' ');
        // 3. { } ; , の前後のスペースを削除（コロンはここでは除外）
        minified = minified.replace(/\s*([{};,])\s*/g, '$1');
        // 4. コロンの後ろのスペースのみ削除（.btn :hover などの疑似クラス保護のため）
        minified = minified.replace(/:\s+/g, ':');
        // 5. 不要なセミコロンの削除
        minified = minified.replace(/;\}/g, '}');

        // アロー関数で返すことで、コード内の $& や $1 による自己破壊を防ぐ
        for (let i = placeholders.length - 1; i >= 0; i--) {
            minified = minified.replace(`___CSS_STR_${i}___`, () => placeholders[i]);
        }

        return minified.trim();
    }
}