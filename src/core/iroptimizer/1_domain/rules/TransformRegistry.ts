import { TransformRule } from '../../interface/TransformRule';
import { ConstantFoldingRule } from './micro/ConstantFoldingRule';
import { IfToTernaryRule } from './micro/IfToTernaryRule';
import { StatementMergeRule } from './micro/StatementMergeRule';
import { VariableDeclarationMergeRule } from './micro/VariableDeclarationMergeRule';
import { DeadStoreEliminationRule } from './micro/DeadStoreEliminationRule';
import { CopyPropagationRule } from './micro/CopyPropagationRule';
import { ConstantPropagationRule } from './micro/ConstantPropagationRule';
import { ObjectPropertyPropagationRule } from './micro/ObjectPropertyPropagationRule';
import { LogicalSimplificationRule } from './micro/LogicalSimplificationRule';
import { PureFunctionEvaluationRule } from './micro/PureFunctionEvaluationRule';
import { UnreachableCodeEliminationRule } from './micro/UnreachableCodeEliminationRule';
import { DeadCodeEliminationRule } from './macro/DeadCodeEliminationRule';
import { GlobalAliasingRule } from './macro/GlobalAliasingRule';
import { TailDuplicationRule } from './macro/TailDuplicationRule';
import { ClassToTupleRule } from './macro/ClassToTupleRule';
import { FunctionInliningRule } from './macro/FunctionInliningRule';

export class TransformRegistry {
    /**
     * Get all registered micro rules.
     */
    static getMicroRules(): TransformRule[] {
        return [
            ConstantFoldingRule,
            IfToTernaryRule,
            StatementMergeRule,
            VariableDeclarationMergeRule,
            DeadStoreEliminationRule,
            CopyPropagationRule,
            ConstantPropagationRule,
            ObjectPropertyPropagationRule,
            LogicalSimplificationRule,
            PureFunctionEvaluationRule,
            UnreachableCodeEliminationRule
        ];
    }

    /**
     * Get all registered macro rules.
     */
    static getMacroRules(): TransformRule[] {
        return [
            DeadCodeEliminationRule,
            GlobalAliasingRule,
            TailDuplicationRule,
            ClassToTupleRule,
            FunctionInliningRule
        ];
    }

    /**
     * Get all registered rules (micro and macro).
     */
    static getAllRules(): TransformRule[] {
        return [
            ...this.getMicroRules(),
            ...this.getMacroRules()
        ];
    }
}
