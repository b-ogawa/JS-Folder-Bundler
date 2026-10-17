export class CssMinifier {
    static minify(css: string): string {
        if (!css) return '';

        const placeholders: string[] = [];
        // 1パスで文字列・url()を保護しつつコメント(/* ... */)を先に除去する
        let minified = css.replace(
            /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\([^)]+\))|\/\*[\s\S]*?\*\//gi,
            (match, protectedToken) => {
                if (protectedToken) {
                    const id = `___CSS_STR_${placeholders.length}___`;
                    placeholders.push(protectedToken);
                    return id;
                }
                return '';
            }
        );

        // 2. 改行や連続スペースを単一スペースに
        minified = minified.replace(/\s+/g, ' ');
        // 3. { } ; , の前後のスペースを削除（コロンはここでは除外）
        minified = minified.replace(/\s*([{};,])\s*/g, '$1');
        // 4. コロンの後ろのスペースのみ削除（.btn :hover などの疑似クラス保護のため）
        minified = minified.replace(/:\s+/g, ':');
        // 5. 不要なセミコロンの削除
        minified = minified.replace(/;\}/g, '}');

        for (let i = placeholders.length - 1; i >= 0; i--) {
            minified = minified.replace(`___CSS_STR_${i}___`, () => placeholders[i]);
        }

        return minified.trim();
    }
}