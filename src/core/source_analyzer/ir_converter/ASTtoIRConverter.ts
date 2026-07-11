import { ScopeInfo, IRBinding, IRScope } from '../scope_analyzer/ScopeAnalyzer';
import { IRNode as TypedIRNode, IRNodeRef } from './IRNodeTypes';

export type { IRNodeRef };
export type IRNode = TypedIRNode;

export type IRScopeInfo = {
    bindings: Map<string, IRBinding>;
    scopes: Map<string, IRScope>;
    escapedVars: Set<string>;
    errors: string[];
};

export interface IRRoot {
    type: 'IRRoot';
    irNodeId: string;
    props: Record<string, any>;
    children: IRNode[];
    filePath: string;
    scopeInfo: IRScopeInfo;
}

let _irDeterministicCounter = 0;
function generateIrId(): string {
    return `ir_${(++_irDeterministicCounter).toString(36)}`;
}

export class ASTtoIRConverter {
    public static resetCounter() {
        _irDeterministicCounter = 0;
    }

    static convert(ast: any, scopeInfo: ScopeInfo, filePath: string): IRRoot {
        const astToIrIdMap = new Map<string, string>();

        function convertNode(node: any): IRNode | null {
            if (!node || typeof node !== 'object' || !node.type) {
                return null;
            }

            const irNodeId = generateIrId();
            if (node._astNodeId) astToIrIdMap.set(node._astNodeId, irNodeId);

            const children: IRNode[] = [];

            const convertChild = (childAst: any): IRNodeRef | null => {
                if (!childAst) return null;
                const childIr = convertNode(childAst);
                if (childIr) {
                    children.push(childIr);
                    return { type: 'ref', irNodeId: childIr.irNodeId };
                }
                return null;
            };

            const convertChildArray = (childAstArray: any): any[] => {
                if (!Array.isArray(childAstArray)) return [];
                const refs: any[] = [];
                for (const childAst of childAstArray) {
                    if (childAst && typeof childAst === 'object' && childAst.type) {
                        const ref = convertChild(childAst);
                        if (ref) refs.push(ref);
                    } else {
                        refs.push(childAst);
                    }
                }
                return refs;
            };

            let props: Record<string, any> = {};

            // 1. ホワイトリストによる主要プロパティの抽出
            switch (node.type) {
                case 'Identifier':
                    props = { name: String(node.name || '') };
                    break;
                case 'NumericLiteral':
                case 'BooleanLiteral':
                case 'StringLiteral':
                    props = { value: node.value };
                    break;
                case 'BinaryExpression':
                case 'LogicalExpression':
                case 'AssignmentExpression':
                    props = { operator: String(node.operator || ''), left: convertChild(node.left), right: convertChild(node.right) };
                    break;
                case 'UpdateExpression':
                    props = { operator: String(node.operator || ''), prefix: Boolean(node.prefix), argument: convertChild(node.argument) };
                    break;
                case 'MemberExpression':
                    props = { computed: Boolean(node.computed), object: convertChild(node.object), property: convertChild(node.property) };
                    break;
                case 'IfStatement':
                case 'ConditionalExpression':
                    props = { test: convertChild(node.test), consequent: convertChild(node.consequent), alternate: convertChild(node.alternate) };
                    break;
                case 'VariableDeclaration':
                    props = { kind: String(node.kind || ''), declarations: convertChildArray(node.declarations) };
                    break;
                case 'VariableDeclarator':
                    props = { id: convertChild(node.id), init: convertChild(node.init) };
                    break;
                case 'ArrowFunctionExpression':
                    props = { params: convertChildArray(node.params), body: convertChild(node.body), async: Boolean(node.async), generator: Boolean(node.generator) };
                    break;
                case 'CallExpression':
                    props = { callee: convertChild(node.callee), arguments: convertChildArray(node.arguments) };
                    break;
                case 'ReturnStatement':
                    props = { argument: convertChild(node.argument) };
                    break;
                case 'ExpressionStatement':
                    props = { expression: convertChild(node.expression) };
                    break;
                case 'BlockStatement':
                case 'Program':
                    props = { body: convertChildArray(node.body) };
                    if (node.type === 'Program') props.sourceType = String(node.sourceType || 'script');
                    break;
                case 'ImportDeclaration':
                    props = { specifiers: convertChildArray(node.specifiers), source: convertChild(node.source) };
                    break;
                case 'ImportDefaultSpecifier':
                case 'ImportNamespaceSpecifier':
                    props = { local: convertChild(node.local) };
                    break;
                case 'ImportSpecifier':
                    props = { imported: convertChild(node.imported), local: convertChild(node.local) };
                    break;
                case 'ImportExpression':
                    props = { source: convertChild(node.source) };
                    break;
                case 'ExportNamedDeclaration':
                    props = { 
                        declaration: convertChild(node.declaration), 
                        specifiers: convertChildArray(node.specifiers), 
                        source: convertChild(node.source) 
                    };
                    break;
                case 'ExportDefaultDeclaration':
                    props = { declaration: convertChild(node.declaration) };
                    break;
                case 'ExportAllDeclaration':
                    props = { source: convertChild(node.source) };
                    break;
                case 'ExportSpecifier':
                    props = { 
                        local: convertChild(node.local), 
                        exported: convertChild(node.exported) 
                    };
                    break;
            }

            // 2. フォールバックマージ（可逆性の保証）
            // ホワイトリストで処理済みのノードであっても、Babel特有の未知のプロパティ(extra等)を失わないように補完する
            for (const key of Object.keys(node)) {
                if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key.startsWith('_')) continue;
                if (props[key] !== undefined) continue; // すでにホワイトリストで抽出済みなら上書きしない

                const value = node[key];
                if (Array.isArray(value)) {
                    props[key] = convertChildArray(value);
                } else if (value && typeof value === 'object' && value.type) {
                    props[key] = convertChild(value);
                } else {
                    props[key] = value;
                }
            }

            return {
                type: node.type,
                irNodeId,
                props,
                children
            } as IRNode;
        }

        const rootNode = convertNode(ast);
        
        const irScopeInfo: IRScopeInfo = {
            bindings: new Map(),
            scopes: new Map(scopeInfo.scopes),
            escapedVars: new Set(),
            errors: [...scopeInfo.errors]
        };

        for (const [astNodeId, binding] of scopeInfo.bindings.entries()) {
            const irId = astToIrIdMap.get(astNodeId);
            if (irId) {
                const translatedReferences = binding.references
                    .map(astId => astToIrIdMap.get(astId))
                    .filter(id => id !== undefined) as string[];

                irScopeInfo.bindings.set(irId, {
                    name: binding.name,
                    scopeId: binding.scopeId,
                    references: translatedReferences
                });
            }
        }

        for (const astNodeId of scopeInfo.escapedVars) {
            const irId = astToIrIdMap.get(astNodeId);
            if (irId) irScopeInfo.escapedVars.add(irId);
        }

        return {
            type: 'IRRoot',
            irNodeId: generateIrId(),
            filePath,
            props: {},
            children: rootNode ? [rootNode] : [],
            scopeInfo: irScopeInfo
        };
    }
}
