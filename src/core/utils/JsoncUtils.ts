export class JsoncUtils {
    public static parse<T = any>(content: string): T {
        const cleaned = content
            .replace(/("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/.*$/gm, (match, strLiteral) => strLiteral ? match : '')
            .replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(cleaned);
    }
}
