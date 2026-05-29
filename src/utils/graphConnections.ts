import type { StoredTransaction } from '../types';
import { resolveParentNodeId } from './psbt';

export interface GraphConnection {
  parentTxid: string;
  voutIdx: number;
  spendingTxid: string;
  vinIdx: number;
  amount: number;
}

/** Edges implied by vins pointing at other transactions already on the graph (incl. PSBTs). */
export function collectGraphConnections(
  transactions: Record<string, StoredTransaction>
): GraphConnection[] {
  const connections: GraphConnection[] = [];

  for (const [spendingTxid, stored] of Object.entries(transactions)) {
    stored.data.vin.forEach((vin, vinIdx) => {
      if (vin.is_coinbase || !vin.txid) return;

      const parentTxid = resolveParentNodeId(transactions, vin.txid);
      if (!parentTxid) return;
      const voutIdx = vin.vout;
      const parentOut = transactions[parentTxid].data.vout[voutIdx];

      connections.push({
        parentTxid,
        voutIdx,
        spendingTxid,
        vinIdx,
        amount: parentOut?.value ?? vin.prevout?.value ?? 0,
      });
    });
  }

  return connections;
}

/** Spending txids for a parent output (mempool outspend + in-graph children, incl. PSBTs). Used for handle layout grouping, not red/green color. */
export function getSpendingTxidsForOutput(
  parentTxid: string,
  voutIdx: number,
  transactions: Record<string, StoredTransaction>,
  outspendTxid?: string
): string[] {
  const txids = new Set<string>();
  if (outspendTxid) txids.add(outspendTxid);

  for (const [childTxid, child] of Object.entries(transactions)) {
    for (const vin of child.data.vin) {
      if (!vin.is_coinbase && vin.txid === parentTxid && vin.vout === voutIdx) {
        txids.add(childTxid);
      }
    }
  }

  return [...txids];
}

/** Graph nodes that spend a given parent output (vin → parent on the canvas). */
export function getGraphSpendChildren(
  transactions: Record<string, StoredTransaction>,
  parentNodeId: string,
  voutIdx: number
): string[] {
  const children: string[] = [];
  for (const [childId, child] of Object.entries(transactions)) {
    for (const vin of child.data.vin) {
      if (vin.is_coinbase || !vin.txid) continue;
      const parentKey = resolveParentNodeId(transactions, vin.txid);
      if (parentKey === parentNodeId && vin.vout === voutIdx) {
        children.push(childId);
        break;
      }
    }
  }
  return children;
}

/**
 * True if adding an input to `targetNodeId` from `sourceParentId` would create a cycle:
 * following each on-graph spender of the target's outputs reaches `sourceParentId`.
 */
export function connectWouldCreateCycle(
  transactions: Record<string, StoredTransaction>,
  sourceParentId: string,
  targetNodeId: string
): boolean {
  if (sourceParentId === targetNodeId) return true;

  const visited = new Set<string>();
  const stack = [targetNodeId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === sourceParentId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const stored = transactions[current];
    if (!stored) continue;

    for (let voutIdx = 0; voutIdx < stored.data.vout.length; voutIdx++) {
      for (const childId of getGraphSpendChildren(transactions, current, voutIdx)) {
        if (!visited.has(childId)) stack.push(childId);
      }
    }
  }

  return false;
}
