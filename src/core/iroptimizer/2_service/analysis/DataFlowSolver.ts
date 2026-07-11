import { CFGBlock } from '../../1_domain/analysis/models/CFGBlock';
import { DataFlowProblem } from '../../1_domain/analysis/models/DataFlowProblem';

export class DataFlowSolver {
    public static solve<State, NodeData>(
        problem: DataFlowProblem<State, NodeData>,
        blocks: Map<string, CFGBlock>,
        nodeDataMap: Map<string, NodeData>
    ): { nodeStates: Map<string, { in: State; out: State }>; unmergedBlockStates: Map<string, Map<string, { in: State; out: State }>> } {
        const blockIn = new Map<string, State>();
        const blockOut = new Map<string, State>();

        for (const blockId of blocks.keys()) {
            blockIn.set(blockId, problem.initialState());
            blockOut.set(blockId, problem.initialState());
        }

        const worklist = Array.from(blocks.values());

        while (worklist.length > 0) {
            const block = worklist.shift()!;
            
            if (problem.direction === 'forward') {
                if (block.predecessors.length > 0) {
                    const predStates = block.predecessors.map(id => blockOut.get(id)!);
                    blockIn.set(block.id, problem.meet(predStates));
                } else {
                    blockIn.set(block.id, problem.boundaryCondition());
                }

                // Isolate blockIn state by cloning before applying in-place node transformations
                let currentState = problem.clone(blockIn.get(block.id)!);
                for (let i = 0; i < block.nodes.length; i++) {
                    const node = block.nodes[i];
                    const data = nodeDataMap.get(node.irNodeId)!;
                    currentState = problem.transferNode(data, currentState);
                }

                if (!problem.equals(currentState, blockOut.get(block.id)!)) {
                    blockOut.set(block.id, currentState);
                    for (const succId of block.successors) {
                        const succBlock = blocks.get(succId);
                        if (succBlock && !worklist.includes(succBlock)) {
                            worklist.push(succBlock);
                        }
                    }
                }
            } else { // backward
                if (block.successors.length > 0) {
                    const succStates = block.successors.map(id => blockIn.get(id)!);
                    blockOut.set(block.id, problem.meet(succStates));
                } else {
                    blockOut.set(block.id, problem.boundaryCondition());
                }

                // Isolate blockOut state by cloning before applying in-place node transformations
                let currentState = problem.clone(blockOut.get(block.id)!);
                for (let i = block.nodes.length - 1; i >= 0; i--) {
                    const node = block.nodes[i];
                    const data = nodeDataMap.get(node.irNodeId)!;
                    currentState = problem.transferNode(data, currentState);
                }

                if (!problem.equals(currentState, blockIn.get(block.id)!)) {
                    blockIn.set(block.id, currentState);
                    for (const predId of block.predecessors) {
                        const predBlock = blocks.get(predId);
                        if (predBlock && !worklist.includes(predBlock)) {
                            worklist.push(predBlock);
                        }
                    }
                }
            }
        }

        // Map results back to individual nodes with independent clones
        const nodeStates = new Map<string, { in: State; out: State }>();
        
        for (const block of blocks.values()) {
            if (problem.direction === 'forward') {
                let currentState = problem.clone(blockIn.get(block.id)!);
                for (let i = 0; i < block.nodes.length; i++) {
                    const node = block.nodes[i];
                    const data = nodeDataMap.get(node.irNodeId)!;
                    
                    const inState = problem.clone(currentState);
                    currentState = problem.transferNode(data, currentState);
                    const outState = problem.clone(currentState);
                    
                    nodeStates.set(node.irNodeId, {
                        in: inState,
                        out: outState
                    });
                }
            } else { // backward
                let currentState = problem.clone(blockOut.get(block.id)!);
                for (let i = block.nodes.length - 1; i >= 0; i--) {
                    const node = block.nodes[i];
                    const data = nodeDataMap.get(node.irNodeId)!;
                    
                    const outState = problem.clone(currentState);
                    currentState = problem.transferNode(data, currentState);
                    const inState = problem.clone(currentState);
                    
                    nodeStates.set(node.irNodeId, {
                        in: inState,
                        out: outState
                    });
                }
            }
        }

        const unmergedBlockStates = new Map<string, Map<string, { in: State; out: State }>>();
        for (const block of blocks.values()) {
            const unmergedForBlock = new Map<string, { in: State; out: State }>();
            if (problem.direction === 'forward') {
                for (const predId of block.predecessors) {
                    unmergedForBlock.set(predId, {
                        in: problem.clone(blockIn.get(predId)!),
                        out: problem.clone(blockOut.get(predId)!)
                    });
                }
            } else { // backward
                for (const succId of block.successors) {
                    unmergedForBlock.set(succId, {
                        in: problem.clone(blockIn.get(succId)!),
                        out: problem.clone(blockOut.get(succId)!)
                    });
                }
            }
            if (unmergedForBlock.size > 0) {
                unmergedBlockStates.set(block.id, unmergedForBlock);
            }
        }

        return { nodeStates, unmergedBlockStates };
    }
}
