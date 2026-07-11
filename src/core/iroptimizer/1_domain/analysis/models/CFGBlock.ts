import { IRNode } from '../../../../source_analyzer/ir_converter/ASTtoIRConverter';

export interface CFGBlock {
    id: string;
    nodes: IRNode[];
    predecessors: string[];
    successors: string[];
}
