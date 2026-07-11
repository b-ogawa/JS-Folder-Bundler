import { VirtualFileSystem } from './VirtualFileSystem';

export interface ExtractorConfig {
    inputCode: string;
    mode: string;
    htmlEntry?: string;
    files: Map<string, string>;
}

export class AssetExtractorFacade {
    /**
     * Extracts JS, CSS and pure HTML from the input sources.
     * Leaves external CDN links (http://, https://, //) untouched.
     */
    static extract(config: ExtractorConfig): VirtualFileSystem {
        const vfs = new VirtualFileSystem();
        
        if (config.mode === 'direct') {
            const code = config.inputCode.trim();
            // 先頭付近にHTML特有のタグが含まれているかを判定
            const isHtml = /^\s*(<!doctype|<html|<head|<body|<div|<main|<section|<article|<span|<p|<style|<script)/i.test(code);
            
            if (isHtml) {
                // HTMLと判定されたら、モードとファイル名を自動で上書きし、HTML抽出ルートへ進ませる
                config.mode = 'html';
                config.htmlEntry = 'input.html';
                vfs.write('input.html', config.inputCode);
            } else {
                // JS/TSと判定されたら、従来通りJSとして保存して終了
                vfs.write('input.js', config.inputCode);
                return vfs;
            }
        } else {
            // Add files from state
            config.files.forEach((content, path) => {
                vfs.write(path, content);
            });
        }
        
        // Complete extraction for HTML if it's the entry
        if (config.mode === 'html' && config.htmlEntry) {
            const html = vfs.read(config.htmlEntry) || '';
            if (html) {
                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(html, 'text/html');
                    
                    const jsEntries: string[] = [];
                    const cssEntries: string[] = [];
                    
                    // 1. Extract script tags
                    const scripts = doc.querySelectorAll('script');
                    scripts.forEach((script, idx) => {
                        const src = script.getAttribute('src');
                        const typeAttr = (script.getAttribute('type') || '').toLowerCase().trim();

                        if (src) {
                            if (/^(https?:)?\/\//i.test(src)) return;
                            const normalized = src.replace(/^\.\//, '');
                            jsEntries.push(normalized);
                            script.remove();
                        } else {
                            const content = script.textContent || '';
                            if (content.trim()) {
                                // 古い importmap は抽出せずに消去してリセットする
                                if (typeAttr === 'importmap') {
                                    script.remove();
                                    return;
                                }
                                
                                // JSONデータなどの非JSコードはコンパイルすると壊れるので除外
                                if (typeAttr === 'application/json' || typeAttr === 'application/ld+json') {
                                    return;
                                }

                                const isTS = typeAttr.includes('ts') || typeAttr.includes('typescript') || content.includes(': number') || content.includes(': string') || content.includes('interface ') || content.includes('type ');
                                const isJSX = content.includes('React.') || /<[A-Z][A-Za-z0-9]*\s*\/?>/.test(content);
                                                                let ext = '.js';
                                if (isTS) ext = isJSX ? '.tsx' : '.ts';
                                else if (isJSX) ext = '.jsx';

                                const namespace = config.htmlEntry.replace(/[^a-zA-Z0-9_]/g, '_');
                                const inlinePath = `_inline_script_${namespace}_${idx}${ext}`;
                                vfs.write(inlinePath, content);
                                
                                // タグを消さずにプレースホルダーをセットする（定位置を記憶）
                                const placeholder = `___INLINE_SCRIPT_${namespace}_${idx}___`;
                                script.textContent = placeholder;
                                
                                const metaStr = vfs.read('_meta_inline_scripts.json');
                                const inlineList = metaStr ? JSON.parse(metaStr) : [];
                                inlineList.push({ id: `${namespace}_${idx}`, placeholder, path: inlinePath });
                                vfs.write('_meta_inline_scripts.json', JSON.stringify(inlineList));
                            }
                        }
                    });
                    
                    // 2. Extract stylesheet link tags
                    const links = doc.querySelectorAll('link[rel="stylesheet"]');
                    links.forEach(link => {
                        const href = link.getAttribute('href');
                        if (href) {
                            // 外部のCSSリンク（Google Fontsなど）は保護する
                            if (/^(https?:)?\/\//i.test(href)) {
                                return;
                            }
                            
                            const normalized = href.replace(/^\.\//, '');
                            cssEntries.push(normalized);
                            link.remove();
                        }
                    });
                    
                    // Prepend <!DOCTYPE html> if original started with it
                    let cleanedHtml = doc.documentElement.outerHTML;
                    if (html.trim().toLowerCase().startsWith('<!doctype')) {
                        cleanedHtml = '<!DOCTYPE html>\n' + cleanedHtml;
                    }
                    
                    // Write back the cleaned HTML (without the extracted tags) and the metadata
                    vfs.write(config.htmlEntry, cleanedHtml);
                    vfs.write('_meta_extracted_js.json', JSON.stringify(jsEntries));
                    
                    console.log(`[AssetExtractorFacade] Successfully parsed HTML entry '${config.htmlEntry}':`, {
                        jsEntries,
                        cssEntries
                    });
                } catch (e: any) {
                    console.error('[AssetExtractorFacade] Failed to parse HTML entry:', e.message);
                }
            }
        }

        return vfs;
    }
}