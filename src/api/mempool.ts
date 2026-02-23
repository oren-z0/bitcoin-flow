import type { MempoolTx, MempoolOutspend } from '../types';

export interface MempoolAddressInfo {
  chain_stats: { tx_count: number };
  mempool_stats: { tx_count: number };
}

const BASE = 'https://mempool.space/api';

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    if (res.status === 400) {
      try {
        const body = (await res.text()).trim().toLowerCase();
        if (body === 'invalid hex string' || body === 'invalid bitcoin address') {
          throw new InvalidInputError(body);
        }
      } catch {
        // Ignore
      }
    }
    throw new Error(`API error ${res.status}: ${path}`);
  }
  return res.json();
}

export function fetchTransaction(txid: string): Promise<MempoolTx> {
  return apiFetch<MempoolTx>(`/tx/${txid}`);
}

export function fetchOutspends(txid: string): Promise<MempoolOutspend[]> {
  return apiFetch<MempoolOutspend[]>(`/tx/${txid}/outspends`);
}

export function fetchAddressInfo(address: string): Promise<MempoolAddressInfo> {
  return apiFetch<MempoolAddressInfo>(`/address/${address}`);
}

// Returns all mempool txs + first 25 confirmed txs for the address
export function fetchAddressTxs(address: string): Promise<MempoolTx[]> {
  return apiFetch<MempoolTx[]>(`/address/${address}/txs`);
}

// Returns the next page of 25 confirmed txs after lastSeenTxid
export function fetchAddressTxsChain(address: string, lastSeenTxid: string): Promise<MempoolTx[]> {
  return apiFetch<MempoolTx[]>(`/address/${address}/txs/chain/${lastSeenTxid}`);
}
