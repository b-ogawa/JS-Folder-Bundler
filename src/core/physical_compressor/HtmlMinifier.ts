export class HtmlMinifier {
    static minify(html: string): string {
        if (!html) return '';

        let minified = html;
        const placeholders: string[] = [];
        const protectedTags = ['pre', 'textarea', 'code', 'script', 'style'];
        
        // 1. スクリプトやスタイルなど、内容の改変（ミニファイ処理）を行ってはいけないタグを保護(退避)する
        for (const tag of protectedTags) {
            const regex = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)<\/${tag}>`, 'gi');
            minified = minified.replace(regex, (match) => {
                // プレースホルダー自体をタグの形 (<...>) にする
                const id = `<___PROTECTED_BLOCK_${placeholders.length}___>`;
                placeholders.push(match);
                return id;
            });
        }

        // 2. その後で、安全にHTMLコメントを除去する
        const commentRegex = new RegExp('<!--([\\s\\S]*?)-->', 'g');
        minified = minified.replace(commentRegex, (match, p1) => {
            if (p1.trim().startsWith('[if') || p1.trim().startsWith('<![endif]')) {
                return match;
            }
            return '';
        });

        // 3. 空白の圧縮
        minified = minified.replace(/\s+/g, ' ');

        // 4. 保護タグを復元する
        for (let i = placeholders.length - 1; i >= 0; i--) {
            minified = minified.replace(`<___PROTECTED_BLOCK_${i}___>`, () => placeholders[i]);
        }

        return minified.trim();
    }
}