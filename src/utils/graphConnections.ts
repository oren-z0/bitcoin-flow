import type { StoredTransaction } from '../types';

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
  const loaded = new Set(Object.keys(transactions));
  const connections: GraphConnection[] = [];

  for (const [spendingTxid, stored] of Object.entries(transactions)) {
    stored.data.vin.forEach((vin, vinIdx) => {
      if (vin.is_coinbase || !vin.txid) return;
      if (!loaded.has(vin.txid)) return;

      const parentTxid = vin.txid;
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

/** Spending txids for a parent output (mempool outspend + in-graph PSBT/unconfirmed children). */
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
