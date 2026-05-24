import type { StoredTransaction } from '../types';
import { inputTxidMatchesNodeRef, resolveParentNodeId } from './psbt';

/**
 * Compute a sub_index for each transaction so that within the same block-height
 * bucket, if A's output is spent by B (on-chain outspend or in-graph vin, incl. PSBTs),
 * B gets a higher sub_index than A (further right on the X axis).
 */
export function computeSubIndexes(
  transactions: Record<string, StoredTransaction>
): Record<string, number> {
  const subIndexes: Record<string, number> = {};
  const workQueue: string[] = [];
  const inputsLeft: Record<string, number> = {};
  for (const [txid, tx] of Object.entries(transactions)) {
    const expectedInputs = tx.data.vin.filter(
      vin => vin.txid && resolveParentNodeId(transactions, vin.txid)
    ).length;
    if (expectedInputs === 0) {
      workQueue.push(txid);
    } else {
      inputsLeft[txid] = expectedInputs;
    }
  }
  while (workQueue.length > 0) {
    const txid = workQueue.shift()!;
    const tx = transactions[txid];
    const parentSubIndexes = tx.data.vin
      .filter(vin => vin.txid && resolveParentNodeId(transactions, vin.txid))
      .map(vin => subIndexes[resolveParentNodeId(transactions, vin.txid!)!] || 0);
    subIndexes[txid] = (parentSubIndexes.length > 0 ? Math.max(...parentSubIndexes) : 0) + 1;

    // Release children that spend this tx (mempool outspends and PSBT vin links).
    for (const [childTxid, child] of Object.entries(transactions)) {
      const waiting = inputsLeft[childTxid];
      if (waiting === undefined) continue;

      const vinsFromParent = child.data.vin.filter(
        vin => vin.txid && inputTxidMatchesNodeRef(vin.txid, txid)
      ).length;
      if (vinsFromParent === 0) continue;

      const newInputsLeft = waiting - vinsFromParent;
      if (newInputsLeft < 0) continue;
      if (newInputsLeft === 0) {
        workQueue.push(childTxid);
        delete inputsLeft[childTxid];
      } else {
        inputsLeft[childTxid] = newInputsLeft;
      }
    }
  }
  return subIndexes;
}

export function sortTxids(
  transactions: Record<string, StoredTransaction>
): string[] {
  const subIndexes = computeSubIndexes(transactions);
  return Object.keys(transactions).sort((a, b) => {
    const ha = transactions[a].data.status.block_height ?? Infinity;
    const hb = transactions[b].data.status.block_height ?? Infinity;
    if (ha !== hb) return ha - hb;
    const ia = subIndexes[a] ?? 0;
    const ib = subIndexes[b] ?? 0;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });
}
