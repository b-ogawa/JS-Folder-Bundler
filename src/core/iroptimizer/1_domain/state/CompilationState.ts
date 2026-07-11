import { IRRoot } from '../../../source_analyzer/ir_converter/ASTtoIRConverter';
import { AnalysisSnapshot } from '../analysis/AnalysisSnapshot';
import { IRNode } from '../../../source_analyzer/ir_converter/IRNodeTypes';

export interface StateMetadata {
    lastAction?: string;
    [key: string]: any;
}

// 外部から注入されるサービスのインターフェース
export interface CompilerServices {
    evaluatePureFunction?: (funcNode: IRNode, args: any[]) => any;
    generateId?: (prefix?: string) => string;
}

export class CompilationState {
    constructor(
        public readonly irRoot: IRRoot,
        public readonly metadata: Readonly<StateMetadata> = {},
        // 解析結果は外部から与えられる（未計算の場合は null）
        public readonly analysisSnapshot: AnalysisSnapshot | null = null,
        public readonly services: CompilerServices = {} 
    ) {}

    /**
     * IRRootを変更した新しい状態を返す (完全なイミュータビリティ)
     */
    public withIRRoot(newRoot: IRRoot): CompilationState {
        // ツリーが更新された際、過去のスナップショットをそのまま引き継ぐ
        return new CompilationState(newRoot, { ...this.metadata }, this.analysisSnapshot, this.services);
    }
    
    public withAnalysis(newSnapshot: AnalysisSnapshot): CompilationState {
        return new CompilationState(this.irRoot, { ...this.metadata }, newSnapshot, this.services);
    }
}
