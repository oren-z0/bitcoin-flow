import type { Node } from 'reactflow';
import type { StoredTransaction } from '../types';
import { pinnedUtxoVoutsKey } from './handleGrouping';

export type TransactionNodeData = {
  txid: string;
  stored: StoredTransaction;
  isSelected: boolean;
};

function storedTransactionDisplayEqual(a: StoredTransaction, b: StoredTransaction): boolean {
  return (
    a === b ||
    (a.name === b.name &&
      a.description === b.description &&
      a.color === b.color &&
      a.data === b.data &&
      a.outspends === b.outspends &&
      a.isPsbt === b.isPsbt &&
      pinnedUtxoVoutsKey(a.pinnedUtxoVouts) === pinnedUtxoVoutsKey(b.pinnedUtxoVouts))
  );
}

function transactionNodeDataEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const da = a as TransactionNodeData;
  const db = b as TransactionNodeData;
  return (
    da.txid === db.txid &&
    da.isSelected === db.isSelected &&
    storedTransactionDisplayEqual(da.stored, db.stored)
  );
}

/** Keep React Flow node object identity when underlying transaction data is unchanged. */
export function reconcileFlowNodes(prev: Node[], next: Node[]): Node[] {
  const prevById = new Map(prev.map(n => [n.id, n]));
  return next.map(n => {
    const p = prevById.get(n.id);
    if (
      p &&
      transactionNodeDataEqual(p.data, n.data) &&
      p.position.x === n.position.x &&
      p.position.y === n.position.y &&
      p.type === n.type
    ) {
      return p;
    }
    return n;
  });
}

/** During layout animation: refresh node data without resetting animated positions. */
export function mergeFlowNodeDataDuringAnimation(prev: Node[], next: Node[]): Node[] {
  const nextById = new Map(next.map(n => [n.id, n]));
  return prev.map(p => {
    const n = nextById.get(p.id);
    if (!n) return p;
    if (transactionNodeDataEqual(p.data, n.data) && p.type === n.type) {
      return p;
    }
    return { ...p, data: n.data, type: n.type };
  });
}
