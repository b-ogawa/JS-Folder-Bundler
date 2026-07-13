import { IRNode } from '../../source_analyzer/ir_converter/ASTtoIRConverter';
import { CompilationState } from '../1_domain/state/CompilationState';

export interface TransformRule {
    id: string;
    type: 'macro' | 'micro';
    name?: string;
    description?: string;
    defaultEnabled?: boolean;
    match: (node: IRNode, state: CompilationState) => boolean;
    candidates: (node: IRNode, state: CompilationState) => (IRNode | null)[];
}
