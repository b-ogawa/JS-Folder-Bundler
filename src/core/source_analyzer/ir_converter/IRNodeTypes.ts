
export interface IRNodeRef {
    type: 'ref';
    irNodeId: string;
}

// Base interface for strongly-typed IR nodes
export interface IRNodeBase<TType extends string, TProps> {
    type: TType;
    irNodeId: string;
    props: TProps & { [key: string]: any };
    children: IRNode[];
}

export interface IdentifierIR extends IRNodeBase<'Identifier', {
    name: string;
    _declId?: string;
}> {}

export interface BinaryExpressionIR extends IRNodeBase<'BinaryExpression', {
    operator: string;
    left: IRNodeRef;
    right: IRNodeRef;
}> {}

export interface IfStatementIR extends IRNodeBase<'IfStatement', {
    test: IRNodeRef;
    consequent: IRNodeRef;
    alternate?: IRNodeRef | null;
}> {}

export interface VariableDeclaratorIR extends IRNodeBase<'VariableDeclarator', {
    id: IRNodeRef;
    init?: IRNodeRef | null;
}> {}

export interface ProgramIR extends IRNodeBase<'Program', {
    body: IRNodeRef[];
    sourceType: string;
}> {}

export interface ImportDeclarationIR extends IRNodeBase<'ImportDeclaration', {
    specifiers: IRNodeRef[];
    source: IRNodeRef;
}> {}

export interface ImportDefaultSpecifierIR extends IRNodeBase<'ImportDefaultSpecifier', {
    local: IRNodeRef;
}> {}

export interface ImportNamespaceSpecifierIR extends IRNodeBase<'ImportNamespaceSpecifier', {
    local: IRNodeRef;
}> {}

export interface ImportSpecifierIR extends IRNodeBase<'ImportSpecifier', {
    imported: IRNodeRef;
    local: IRNodeRef;
}> {}

export interface ImportExpressionIR extends IRNodeBase<'ImportExpression', {
    source: IRNodeRef;
}> {}

export interface ExpressionStatementIR extends IRNodeBase<'ExpressionStatement', {
    expression: IRNodeRef;
}> {}

export interface BlockStatementIR extends IRNodeBase<'BlockStatement', {
    body: IRNodeRef[];
}> {}

export interface ConditionalExpressionIR extends IRNodeBase<'ConditionalExpression', {
    test: IRNodeRef;
    consequent: IRNodeRef;
    alternate: IRNodeRef;
}> {}

export interface LogicalExpressionIR extends IRNodeBase<'LogicalExpression', {
    operator: string;
    left: IRNodeRef;
    right: IRNodeRef;
}> {}

export interface NumericLiteralIR extends IRNodeBase<'NumericLiteral', {
    value: number;
}> {}

export interface StringLiteralIR extends IRNodeBase<'StringLiteral', {
    value: string;
}> {}

export interface BooleanLiteralIR extends IRNodeBase<'BooleanLiteral', {
    value: boolean;
}> {}

export interface AssignmentExpressionIR extends IRNodeBase<'AssignmentExpression', {
    operator: string;
    left: IRNodeRef;
    right: IRNodeRef;
}> {}

export interface UnaryExpressionIR extends IRNodeBase<'UnaryExpression', {
    operator: string;
    prefix: boolean;
    argument: IRNodeRef;
}> {}

export interface UpdateExpressionIR extends IRNodeBase<'UpdateExpression', {
    operator: string;
    argument: IRNodeRef;
    prefix: boolean;
}> {}

export interface MemberExpressionIR extends IRNodeBase<'MemberExpression', {
    object: IRNodeRef;
    property: IRNodeRef;
    computed: boolean;
}> {}

export interface ExportNamedDeclarationIR extends IRNodeBase<'ExportNamedDeclaration', {
    declaration?: IRNodeRef | null;
    specifiers?: IRNodeRef[];
    source?: IRNodeRef | null;
}> {}

export interface ExportDefaultDeclarationIR extends IRNodeBase<'ExportDefaultDeclaration', {
    declaration: IRNodeRef;
}> {}

export interface VariableDeclarationIR extends IRNodeBase<'VariableDeclaration', {
    kind: 'var' | 'let' | 'const';
    declarations: IRNodeRef[];
}> {}

export interface ArrowFunctionExpressionIR extends IRNodeBase<'ArrowFunctionExpression', {
    params: IRNodeRef[];
    body: IRNodeRef;
    async: boolean;
    generator: boolean;
}> {}

export interface CallExpressionIR extends IRNodeBase<'CallExpression', {
    callee: IRNodeRef;
    arguments: IRNodeRef[];
}> {}

export interface ReturnStatementIR extends IRNodeBase<'ReturnStatement', {
    argument?: IRNodeRef | null;
}> {}

export interface ObjectExpressionIR extends IRNodeBase<'ObjectExpression', {
    properties: IRNodeRef[];
}> {}

export interface ObjectPropertyIR extends IRNodeBase<'ObjectProperty', {
    key: IRNodeRef;
    value: IRNodeRef;
    kind: 'init' | 'get' | 'set';
    method: boolean;
    shorthand: boolean;
    computed: boolean;
}> {}

export interface GenericIRNode {
    type: string;
    irNodeId: string;
    props: Record<string, any>;
    children: IRNode[];
}

export type IRNode =
    | IdentifierIR
    | BinaryExpressionIR
    | IfStatementIR
    | VariableDeclaratorIR
    | VariableDeclarationIR
    | ProgramIR
    | ImportDeclarationIR
    | ImportDefaultSpecifierIR
    | ImportNamespaceSpecifierIR
    | ImportSpecifierIR
    | ImportExpressionIR
    | ExpressionStatementIR
    | BlockStatementIR
    | ConditionalExpressionIR
    | LogicalExpressionIR
    | NumericLiteralIR
    | StringLiteralIR
    | BooleanLiteralIR
    | AssignmentExpressionIR
    | UnaryExpressionIR
    | UpdateExpressionIR
    | MemberExpressionIR
    | ExportNamedDeclarationIR
    | ExportDefaultDeclarationIR
    | ArrowFunctionExpressionIR
    | CallExpressionIR
    | ReturnStatementIR
    | ObjectExpressionIR
    | ObjectPropertyIR
    | GenericIRNode;
