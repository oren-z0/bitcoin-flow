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

export class MempoolApiError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string) {
    super(`API error ${status}: ${path}`);
    this.name = 'MempoolApiError';
    this.status = status;
    this.path = path;
  }
}

export type MempoolFetchOptions = {
  /** When true, failures are not reported to the global error handler. */
  silent?: boolean;
};

let onApiError: ((message: string) => void) | null = null;

export function setMempoolApiErrorHandler(handler: ((message: string) => void) | null) {
  onApiError = handler;
}

function reportApiError(error: unknown) {
  if (!onApiError) return;

  if (error instanceof InvalidInputError) {
    onApiError(
      error.message === 'invalid hex string'
        ? 'Invalid transaction ID'
        : error.message === 'invalid bitcoin address'
          ? 'Invalid Bitcoin address'
          : error.message
    );
    return;
  }

  if (error instanceof MempoolApiError) {
    onApiError('mempool.space request failed');
    return;
  }

  onApiError('Could not reach mempool.space');
}

async function apiFetch<T>(path: string, options?: MempoolFetchOptions): Promise<T> {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) {
      if (res.status === 400) {
        const body = (await res.text()).trim().toLowerCase();
        if (body === 'invalid hex string' || body === 'invalid bitcoin address') {
          throw new InvalidInputError(body);
        }
      }
      throw new MempoolApiError(res.status, path);
    }
    return res.json() as Promise<T>;
  } catch (error) {
    if (!options?.silent) {
      reportApiError(error);
    }
    throw error;
  }
}

export function fetchTransaction(txid: string, options?: MempoolFetchOptions): Promise<MempoolTx> {
  return apiFetch<MempoolTx>(`/tx/${txid}`, options);
}

export function fetchOutspends(txid: string, options?: MempoolFetchOptions): Promise<MempoolOutspend[]> {
  return apiFetch<MempoolOutspend[]>(`/tx/${txid}/outspends`, options);
}

export function fetchAddressInfo(address: string, options?: MempoolFetchOptions): Promise<MempoolAddressInfo> {
  return apiFetch<MempoolAddressInfo>(`/address/${address}`, options);
}

// Returns all mempool txs + first 25 confirmed txs for the address
export function fetchAddressTxs(address: string, options?: MempoolFetchOptions): Promise<MempoolTx[]> {
  return apiFetch<MempoolTx[]>(`/address/${address}/txs`, options);
}

// Returns the next page of 25 confirmed txs after lastSeenTxid
export function fetchAddressTxsChain(
  address: string,
  lastSeenTxid: string,
  options?: MempoolFetchOptions
): Promise<MempoolTx[]> {
  return apiFetch<MempoolTx[]>(`/address/${address}/txs/chain/${lastSeenTxid}`, options);
}
