import { RehydrateBuilder, ElementBuilder, Environment, Cursor } from '@glimmer/runtime';
import { Simple } from '@glimmer/interfaces';

export class DebugRehydrationBuilder extends RehydrateBuilder {
  clearedBlocks: string[] = [];
  clearedNodes: Simple.Node[] = [];
  clearBlock(count: number) {
    this.clearedBlocks.push(`block:${count}`);
    super.clearBlock(count);
  }

  remove(node: Simple.Node) {
    let next = super.remove(node);
    if (node.nodeType !== 8) {
      // Only push nodes that effect the UI
      this.clearedNodes.push(node);
    }
    return next;
  }
}

export function debugRehydration(env: Environment, cursor: Cursor): ElementBuilder {
  return DebugRehydrationBuilder.forInitialRender(env, cursor);
}