import type { Node } from 'reactflow';

/** Keep React Flow node object identity when underlying transaction data is unchanged. */
export function reconcileFlowNodes(prev: Node[], next: Node[]): Node[] {
  const prevById = new Map(prev.map(n => [n.id, n]));
  return next.map(n => {
    const p = prevById.get(n.id);
    if (
      p &&
      p.data === n.data &&
      p.position.x === n.position.x &&
      p.position.y === n.position.y &&
      p.type === n.type
    ) {
      return p;
    }
    return n;
  });
}
