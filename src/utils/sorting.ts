import type { StoredTransaction } from '../types';

/**
 * Compute a sub_index for each transaction so that within the same block,
 * if transaction A has an output spent by transaction B, B gets a higher
 * sub_index than A. This gives a topological order within a block.
 *
 * Algorithm:
 * 1. Initialise every sub_index to 0.
 * 2. Put all txids in a work-set.
 * 3. Pop a txid from the set; for each of its outspends that points to
 *    another transaction in global state at the same block height:
 *      - if that transaction's sub_index <= current sub_index,
 *        bump it to current + 1 and re-add it to the work-set.
 * 4. Repeat until the work-set is empty.
 */
export function computeSubIndexes(
  transactions: Record<string, StoredTransaction>
): Record<string, number> {
  const subIndexes: Record<string, number> = {};
  const workQueue: string[] = [];
  const inputsLeft: Record<string, number> = {};
  for (const [txid, tx] of Object.entries(transactions)) {
    const expectedInputs = tx.data.vin.filter(vin => vin.txid && transactions[vin.txid]).length;
    if (expectedInputs === 0) {
      workQueue.push(txid);
    } else {
      inputsLeft[txid] = expectedInputs;
    }
  }
  while (workQueue.length > 0) {
    const txid = workQueue.shift()!;
    const tx = transactions[txid];
    subIndexes[txid] = Math.max(...tx.data.vin.map((vin) => subIndexes[vin.txid] || 0)) + 1;
    for (const outspend of tx.outspends) {
      if (!outspend.spent || !outspend.txid) continue;
      const outTx = transactions[outspend.txid];
      if (!outTx) continue;
      const newInputsLeft = (inputsLeft[outspend.txid] ?? 0) - 1;
      if (newInputsLeft < 0) continue; // This should never happen, but just in case.
      if (newInputsLeft === 0) {
        workQueue.push(outspend.txid);
        delete inputsLeft[outspend.txid];
      }
      if (newInputsLeft > 0) {
        inputsLeft[outspend.txid] = newInputsLeft;
        continue;
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
