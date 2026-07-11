import { VirtualFileSystem } from '../asset_extractor/VirtualFileSystem';
import { HtmlMinifier } from './HtmlMinifier';
import { CssMinifier } from './CssMinifier';

export interface CompressorConfig {
    golfEnabled: boolean;
    enableMangle: boolean;
    terserCompress?: boolean;
    addStrict: boolean;
    mode: string;
    htmlEntry?: string;
    htmlOptCss?: boolean;
    htmlOptJs?: boolean;
    htmlOptImg?: boolean;
    externalImports?: string[];
    cdnTemplate?: string;
    bundleId?: string;
}

interface RuntimeInjectionRule {
    id: string;
    detectCss?: RegExp;
    detectFiles?: string[];
    injectTags: (doc: Document) => void;
    fallbackTags: string;
}

const RUNTIME_RULES: RuntimeInjectionRule[] = [
    {
        id: 'tailwindcss',
        detectCss: /@import\s+['"]tailwindcss['"]\s*;?|@tailwind\s+(?:base|components|utilities)\s*;?/,
        detectFiles: ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs'],
        injectTags: (doc: Document) => {
            if (!doc.querySelector('script[src="https://cdn.tailwindcss.com"]')) {
                const script = doc.createElement('script');
                script.src = 'https://cdn.tailwindcss.com';
                if (doc.head) doc.head.appendChild(script);
            }
        },
        fallbackTags: '<script src="https://cdn.tailwindcss.com">' + String.fromCharCode(60) + '/script>\n'
    }
];

export class AssetMultiplexer {
    private static generateImportUrl(modulePath: string, vfs: VirtualFileSystem, cdnTemplate: string): string {
        if (/^(https?:)?\/\//i.test(modulePath)) {
            return modulePath;
        }

        let packageJson: any = null;
        try {
            const pjContent = vfs.read('package.json');
            if (pjContent) packageJson = JSON.parse(pjContent);
        } catch (err) {}

        let basePackage = modulePath;
        let subpath = '';
        if (modulePath.startsWith('@')) {
            const parts = modulePath.split('/');
            if (parts.length > 2) {
                basePackage = parts.slice(0, 2).join('/');
                subpath = parts.slice(2).join('/');
            } else {
                basePackage = modulePath;
            }
        } else {
            const parts = modulePath.split('/');
            if (parts.length > 1) {
                basePackage = parts[0];
                subpath = parts.slice(1).join('/');
            }
        }

        let version = '';
        if (packageJson?.dependencies?.[basePackage]) {
            version = packageJson.dependencies[basePackage];
        } else if (packageJson?.devDependencies?.[basePackage]) {
            version = packageJson.devDependencies[basePackage];
        }
        if (version) version = version.replace(/^[\^~]/, '');

        let targetUrl = cdnTemplate;
        targetUrl = targetUrl.replace('[module]', basePackage);
        
        if (version) targetUrl = targetUrl.replace('[version]', version);
        else targetUrl = targetUrl.replace('@[version]', '').replace('[version]', '');
        
        if (subpath) targetUrl = targetUrl.replace('[path]', subpath);
        else targetUrl = targetUrl.replace('/[path]', '').replace('[path]', '');

        return targetUrl;
    }

    private static buildImportMap(externalImports: string[], vfs: VirtualFileSystem, template: string): Record<string, string> {
        const imports: Record<string, string> = {};
        
        const externalModules = new Set<string>();
        for (const m of externalImports) {
            if (/^(https?:)?\/\//i.test(m)) continue;
            let base = '';
            if (m.startsWith('@')) {
                const parts = m.split('/');
                if (parts.length >= 2) base = parts[0] + '/' + parts[1];
            } else {
                base = m.split('/')[0];
            }
            if (base) externalModules.add(base);
        }
        
        for (const modulePath of externalImports) {
            let url = this.generateImportUrl(modulePath, vfs, template);
            
            let base = '';
            if (modulePath.startsWith('@')) {
                const parts = modulePath.split('/');
                if (parts.length >= 2) base = parts[0] + '/' + parts[1];
            } else {
                base = modulePath.split('/')[0];
            }
            const filteredExternal = Array.from(externalModules).filter(m => m !== base).join(',');

            if (url.includes('esm.sh') && filteredExternal && !url.includes('external=')) {
                url += (url.includes('?') ? '&' : '?') + 'external=' + filteredExternal;
            }
            imports[modulePath] = url;
        }

        for (const basePkg of externalModules) {
            if (!imports[basePkg]) {
                let url = this.generateImportUrl(basePkg, vfs, template);
                const filteredExternal = Array.from(externalModules).filter(m => m !== basePkg).join(',');
                if (url.includes('esm.sh') && filteredExternal && !url.includes('external=')) {
                    url += (url.includes('?') ? '&' : '?') + 'external=' + filteredExternal;
                }
                imports[basePkg] = url;
            }
        }

        const addImplicitSubpath = (basePkg: string, subpath: string) => {
            if (externalModules.has(basePkg) && !imports[subpath]) {
                let url = this.generateImportUrl(subpath, vfs, template);
                const filteredExternal = Array.from(externalModules).filter(m => m !== basePkg).join(',');
                if (url.includes('esm.sh') && filteredExternal && !url.includes('external=')) {
                    url += (url.includes('?') ? '&' : '?') + 'external=' + filteredExternal;
                }
                imports[subpath] = url;
            }
        };

        addImplicitSubpath('react', 'react/jsx-runtime');
        addImplicitSubpath('react', 'react/jsx-dev-runtime');
        addImplicitSubpath('preact', 'preact/jsx-runtime');
        addImplicitSubpath('preact', 'preact/jsx-dev-runtime');


        return imports;
    }

    static multiplex(jsCode: string, vfs: VirtualFileSystem, htmlEntry: string, config: CompressorConfig): string {
        let html = vfs.read(htmlEntry) || '';
        if (!html) return jsCode;
        
        const template = config.cdnTemplate || 'https://esm.sh/[module]@[version]/[path]';

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            if (config.externalImports && config.externalImports.length > 0) {
                const imports = this.buildImportMap(config.externalImports, vfs, template);
                
                const importMapScript = doc.createElement('script');
                importMapScript.setAttribute('type', 'importmap');
                importMapScript.textContent = JSON.stringify({ imports }, null, 2);
                if (doc.head) doc.head.insertBefore(importMapScript, doc.head.firstChild);
                else if (doc.body) doc.body.insertBefore(importMapScript, doc.body.firstChild);
                else doc.documentElement.insertBefore(importMapScript, doc.documentElement.firstChild);
            }

            if (config.htmlOptCss !== false) {
                let mergedCss = '';
                const importsHoisted: string[] = [];
                
                const allFiles = typeof vfs.list === 'function' ? vfs.list() : Array.from(vfs.getAll().keys());
                const cssFiles = allFiles.filter(f => f.endsWith('.css'));
                const activeRuntimes = new Set<string>();
                
                for (const cssFile of cssFiles) {
                    let content = vfs.read(cssFile) || '';
                    
                    for (const rule of RUNTIME_RULES) {
                        if (rule.detectCss && rule.detectCss.test(content)) {
                            activeRuntimes.add(rule.id);
                            content = content.replace(new RegExp(rule.detectCss.source, 'g'), '/* build directive removed */');
                        }
                        if (rule.detectFiles && rule.detectFiles.some(f => allFiles.includes(f))) {
                            activeRuntimes.add(rule.id);
                        }
                    }

                    content = content.replace(/@import\s+(?:url\()?['"]?(https?:\/\/[^'"\)]+)['"]?\)?\s*;/g, (match) => {
                        importsHoisted.push(match);
                        return '/* hoisted external import */';
                    });

                    if (content.trim()) {
                        mergedCss += `/* ${cssFile} */\n${content}\n`;
                    }
                }
                
                for (const rule of RUNTIME_RULES) {
                    if (activeRuntimes.has(rule.id)) {
                        rule.injectTags(doc);
                    }
                }
                
                const finalCss = importsHoisted.join('\n') + '\n' + mergedCss;

                if (finalCss.trim()) {
                    const styleEl = doc.createElement('style');
                    styleEl.textContent = CssMinifier.minify(finalCss);
                    if (doc.head) doc.head.appendChild(styleEl);
                    else if (doc.body) doc.body.appendChild(styleEl);
                    else doc.documentElement.appendChild(styleEl);
                }
            }

            if (config.htmlOptImg !== false) {
                const imgEls = doc.querySelectorAll('img');
                imgEls.forEach(img => {
                    const src = img.getAttribute('src');
                    if (src && !src.startsWith('data:') && !src.startsWith('http://') && !src.startsWith('https://')) {
                        const normalizedSrc = src.replace(/^\.\//, '');
                        const imageContent = vfs.read(normalizedSrc);
                        if (imageContent) {
                            if (imageContent.startsWith('data:')) {
                                img.setAttribute('src', imageContent);
                            } else {
                                let mimeType = 'image/png';
                                if (normalizedSrc.endsWith('.jpg') || normalizedSrc.endsWith('.jpeg')) mimeType = 'image/jpeg';
                                else if (normalizedSrc.endsWith('.gif')) mimeType = 'image/gif';
                                else if (normalizedSrc.endsWith('.svg')) mimeType = 'image/svg+xml';
                                else if (normalizedSrc.endsWith('.webp')) mimeType = 'image/webp';

                                let base64Data = '';
                                if (mimeType === 'image/svg+xml') {
                                    base64Data = btoa(unescape(encodeURIComponent(imageContent)));
                                } else {
                                    if (/^[A-Za-z0-9+/=]+$/.test(imageContent.trim().replace(/\s/g, ''))) {
                                        base64Data = imageContent.trim();
                                    } else {
                                        try { base64Data = btoa(unescape(encodeURIComponent(imageContent))); } 
                                        catch (e) { base64Data = btoa(imageContent); }
                                    }
                                }
                                img.setAttribute('src', `data:${mimeType};base64,${base64Data}`);
                            }
                        }
                    }
                });
            }

            let resultHtml = doc.documentElement.outerHTML;
            if (html.trim().toLowerCase().startsWith('<!doctype')) {
                resultHtml = '<!DOCTYPE html>\n' + resultHtml;
            }

            resultHtml = HtmlMinifier.minify(resultHtml);

            if (config.htmlOptJs !== false && jsCode.trim() !== '') {
                const lt = String.fromCharCode(60);
                
                // 一貫した bundleId を取得
                const bundleId = config.bundleId || 'bundle_default';
                const safeJsCode = jsCode.replace(/<\/script>/gi, lt + '\\/script>');
                
                // id="${bundleId}" を付与
                const scriptTag = `${lt}script type="module" id="${bundleId}">\n${safeJsCode}\n${lt}/script>`;
                
                const bodyMatch = resultHtml.match(/<\/body>/i);
                if (bodyMatch) {
                    resultHtml = resultHtml.replace(bodyMatch[0], () => scriptTag + bodyMatch[0]);
                } else {
                    resultHtml += scriptTag;
                }
            }

            const inlineMetaStr = vfs.read('_meta_inline_scripts.json');
            if (inlineMetaStr) {
                const inlineList = JSON.parse(inlineMetaStr);
                const lt = String.fromCharCode(60);
                for (const item of inlineList) {
                    const optCode = vfs.read(item.path) || '';
                    const safeOptCode = optCode.replace(/<\/script>/gi, lt + '\\/script>');
                    resultHtml = resultHtml.replace(item.placeholder, () => safeOptCode);
                }
            }

            return resultHtml;

        } catch (e: any) {
            console.error('[AssetMultiplexer] Failed to multiplex assets via DOMParser:', e.message);
            
            let importMapTag = '';
            if (config.externalImports && config.externalImports.length > 0) {
                const imports = this.buildImportMap(config.externalImports, vfs, template);
                const lt = String.fromCharCode(60);
                importMapTag = `${lt}script type="importmap">\n${JSON.stringify({ imports }, null, 2)}\n${lt}/script>\n`;
            }

            let styleTag = '';
            let fallbackRuntimeTags = '';
            if (config.htmlOptCss !== false) {
                let mergedCss = '';
                const importsHoisted: string[] = [];
                const activeRuntimes = new Set<string>();
                const allFiles = typeof vfs.list === 'function' ? vfs.list() : Array.from(vfs.getAll().keys());
                const cssFiles = allFiles.filter(f => f.endsWith('.css'));
                
                for (const cssFile of cssFiles) {
                    let content = vfs.read(cssFile) || '';
                    for (const rule of RUNTIME_RULES) {
                        if (rule.detectCss && rule.detectCss.test(content)) {
                            activeRuntimes.add(rule.id);
                            content = content.replace(new RegExp(rule.detectCss.source, 'g'), '/* build directive removed */');
                        }
                        if (rule.detectFiles && rule.detectFiles.some(f => allFiles.includes(f))) {
                            activeRuntimes.add(rule.id);
                        }
                    }
                    content = content.replace(/@import\s+(?:url\()?['"]?(https?:\/\/[^'"\)]+)['"]?\)?\s*;/g, (match) => {
                        importsHoisted.push(match);
                        return '/* hoisted */';
                    });
                    if (content.trim()) mergedCss += `/* ${cssFile} */\n${content}\n`;
                }

                for (const rule of RUNTIME_RULES) {
                    if (activeRuntimes.has(rule.id)) {
                        if (!html.includes(rule.fallbackTags.trim())) {
                            fallbackRuntimeTags += rule.fallbackTags;
                        }
                    }
                }

                const finalCss = importsHoisted.join('\n') + '\n' + mergedCss;
                if (finalCss.trim()) {
                    const lt = String.fromCharCode(60);
                    styleTag = `${lt}style>\n${CssMinifier.minify(finalCss)}\n${lt}/style>\n`;
                }
            }

            let modifiedHtml = html;

            const injectTags = fallbackRuntimeTags + importMapTag + styleTag;
            if (injectTags) {
                const headMatch = modifiedHtml.match(/<\/head>/i);
                if (headMatch) modifiedHtml = modifiedHtml.replace(headMatch[0], () => injectTags + headMatch[0]);
                else modifiedHtml = injectTags + modifiedHtml;
            }

            modifiedHtml = HtmlMinifier.minify(modifiedHtml);

            if (config.htmlOptJs !== false && jsCode.trim() !== '') {
                const lt = String.fromCharCode(60);
                
                // 一貫した bundleId を取得
                const bundleId = config.bundleId || 'bundle_default';
                const scriptStart = lt + `script type="module" id="${bundleId}">\n"use strict";\n`;
                const scriptEnd = '\n' + lt + "/script>";
                const bodyEndRegex = /<\/body>/i;
                
                const safeJsCode = jsCode.replace(/<\/script>/gi, lt + '\\/script>');
                const bodyMatch = modifiedHtml.match(bodyEndRegex);
                
                if (bodyMatch) {
                    modifiedHtml = modifiedHtml.replace(bodyMatch[0], () => scriptStart + safeJsCode + scriptEnd + bodyMatch[0]);
                } else {
                    modifiedHtml = modifiedHtml + scriptStart + safeJsCode + scriptEnd;
                }
            }

            const inlineMetaStr = vfs.read('_meta_inline_scripts.json');
            if (inlineMetaStr) {
                const inlineList = JSON.parse(inlineMetaStr);
                const lt = String.fromCharCode(60);
                for (const item of inlineList) {
                    const optCode = vfs.read(item.path) || '';
                    const safeOptCode = optCode.replace(/<\/script>/gi, lt + '\\/script>');
                    modifiedHtml = modifiedHtml.replace(item.placeholder, () => safeOptCode);
                }
            }

            return modifiedHtml;
        }
    }
}
