import { fetchTransaction, fetchOutspends } from '../api/mempool';
import { useGlobalState } from '../hooks/useGlobalState';
import { parsePsbtBase64, normalizePsbtBase64, enrichPrevoutsFromGraph } from './psbt';
import type { SlimState } from './stateFile';
import type { StoredTransaction } from '../types';

export type LoadProgress = { done: number; total: number } | null;

export async function loadSlimState(
  slim: SlimState,
  onProgress?: (progress: LoadProgress) => void
): Promise<void> {
  const { mergeState } = useGlobalState.getState();

  if (Object.keys(slim.addresses).length > 0) {
    mergeState({ addresses: slim.addresses });
  }

  const txids = Object.keys(slim.transactions);
  const total = txids.length;

  if (total === 0) {
    onProgress?.(null);
    if (slim.autoLayout !== undefined) {
      await useGlobalState.getState().setAutoLayout(slim.autoLayout);
    }
    return;
  }

  onProgress?.({ done: 0, total });

  const fetched: Record<string, StoredTransaction> = {};

  for (let i = 0; i < txids.length; i++) {
    const txid = txids[i];
    const meta = slim.transactions[txid];
    try {
      if (meta.isPsbt && meta.psbtBase64) {
        const normalized = normalizePsbtBase64(meta.psbtBase64);
        const parsed = parsePsbtBase64(normalized);
        fetched[parsed.txid] = {
          coordinates: meta.coordinates,
          data: parsed.data,
          outspends: parsed.outspends,
          isPsbt: true,
          psbtBase64: normalized,
          ...(meta.name && { name: meta.name }),
          ...(meta.color && { color: meta.color }),
        };
      } else {
        const [data, outspends] = await Promise.all([
          fetchTransaction(txid),
          fetchOutspends(txid),
        ]);
        fetched[txid] = {
          coordinates: meta.coordinates,
          data,
          outspends,
          ...(meta.name && { name: meta.name }),
          ...(meta.color && { color: meta.color }),
        };
      }
    } catch {
      // Skip failed transactions silently
    }
    onProgress?.({ done: i + 1, total });
  }

  mergeState({ transactions: fetched });

  const merged = useGlobalState.getState().transactions;
  const enriched = enrichPrevoutsFromGraph(merged);
  if (enriched) {
    mergeState({ transactions: enriched });
  }

  if (slim.autoLayout !== undefined) {
    await useGlobalState.getState().setAutoLayout(slim.autoLayout);
  } else if (useGlobalState.getState().autoLayout) {
    await useGlobalState.getState().runLayout();
  }

  onProgress?.(null);
}
