import type { StoredAddress, StoredTransaction } from '../types';

export interface SlimTransactionMeta {
  coordinates: { x: number; y: number };
  name?: string;
  color?: string;
  description?: string;
  isPsbt?: boolean;
  psbtBase64?: string;
}

export interface SlimState {
  transactions: Record<string, SlimTransactionMeta>;
  addresses: Record<string, StoredAddress>;
  autoLayout?: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

const TXID_RE = /^[0-9a-f]{64}$/i;
const PSBT_NODE_ID_RE = /^psbt_[0-9a-f]{64}$/i;

function isValidTransactionKey(key: string): boolean {
  return TXID_RE.test(key) || PSBT_NODE_ID_RE.test(key);
}

function parseCoordinates(
  value: unknown,
  path: string
): { x: number; y: number } | { error: string } {
  if (!isRecord(value)) {
    return { error: `${path} must be an object` };
  }
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    return { error: `${path}.x and ${path}.y must be numbers` };
  }
  return { x: value.x, y: value.y };
}

function parseTransactionMeta(
  txid: string,
  value: unknown
): { meta: SlimTransactionMeta } | { error: string } {
  if (!isRecord(value)) {
    return { error: `transactions["${txid}"] must be an object` };
  }

  const coords = parseCoordinates(value.coordinates, `transactions["${txid}"].coordinates`);
  if ('error' in coords) return coords;

  const meta: SlimTransactionMeta = { coordinates: coords };

  if (value.name !== undefined) {
    if (typeof value.name !== 'string') {
      return { error: `transactions["${txid}"].name must be a string` };
    }
    if (value.name) meta.name = value.name;
  }

  if (value.color !== undefined) {
    if (typeof value.color !== 'string') {
      return { error: `transactions["${txid}"].color must be a string` };
    }
    if (value.color) meta.color = value.color;
  }

  if (value.description !== undefined) {
    if (typeof value.description !== 'string') {
      return { error: `transactions["${txid}"].description must be a string` };
    }
    if (value.description) meta.description = value.description;
  }

  if (value.isPsbt !== undefined) {
    if (typeof value.isPsbt !== 'boolean') {
      return { error: `transactions["${txid}"].isPsbt must be a boolean` };
    }
    if (value.isPsbt) meta.isPsbt = true;
  }

  if (value.psbtBase64 !== undefined) {
    if (typeof value.psbtBase64 !== 'string') {
      return { error: `transactions["${txid}"].psbtBase64 must be a string` };
    }
    if (value.psbtBase64) meta.psbtBase64 = value.psbtBase64;
  }

  if (meta.isPsbt && !meta.psbtBase64) {
    return { error: `transactions["${txid}"] has isPsbt but missing psbtBase64` };
  }

  return { meta };
}

function parseAddress(
  address: string,
  value: unknown
): { addr: StoredAddress } | { error: string } {
  if (!isRecord(value)) {
    return { error: `addresses["${address}"] must be an object` };
  }
  if (typeof value.isSelected !== 'boolean') {
    return { error: `addresses["${address}"].isSelected must be a boolean` };
  }

  const addr: StoredAddress = { isSelected: value.isSelected };

  if (value.name !== undefined) {
    if (typeof value.name !== 'string') {
      return { error: `addresses["${address}"].name must be a string` };
    }
    if (value.name) addr.name = value.name;
  }

  if (value.description !== undefined) {
    if (typeof value.description !== 'string') {
      return { error: `addresses["${address}"].description must be a string` };
    }
    if (value.description) addr.description = value.description;
  }

  if (value.color !== undefined) {
    if (typeof value.color !== 'string') {
      return { error: `addresses["${address}"].color must be a string` };
    }
    if (value.color) addr.color = value.color;
  }

  if (value.groupId !== undefined) {
    if (typeof value.groupId !== 'string') {
      return { error: `addresses["${address}"].groupId must be a string` };
    }
    addr.groupId = value.groupId;
  }

  return { addr };
}

/**
 * Parse and validate exported state JSON. Unknown top-level and nested keys are ignored.
 */
export function parseStateFile(data: unknown): { ok: true; state: SlimState } | { ok: false; error: string } {
  if (!isRecord(data)) {
    return { ok: false, error: 'State must be a JSON object' };
  }

  const state: SlimState = {
    transactions: {},
    addresses: {},
  };

  if (data.transactions !== undefined) {
    if (!isRecord(data.transactions)) {
      return { ok: false, error: 'transactions must be an object' };
    }
    for (const [txid, raw] of Object.entries(data.transactions)) {
      if (!isValidTransactionKey(txid)) {
        return { ok: false, error: `Invalid transaction id "${txid}"` };
      }
      const parsed = parseTransactionMeta(txid, raw);
      if ('error' in parsed) {
        return { ok: false, error: parsed.error };
      }
      state.transactions[txid.toLowerCase()] = parsed.meta;
    }
  }

  if (data.addresses !== undefined) {
    if (!isRecord(data.addresses)) {
      return { ok: false, error: 'addresses must be an object' };
    }
    for (const [address, raw] of Object.entries(data.addresses)) {
      if (!isNonEmptyString(address)) {
        return { ok: false, error: 'Address keys must be non-empty strings' };
      }
      const parsed = parseAddress(address, raw);
      if ('error' in parsed) {
        return { ok: false, error: parsed.error };
      }
      state.addresses[address] = parsed.addr;
    }
  }

  if (data.autoLayout !== undefined) {
    if (typeof data.autoLayout !== 'boolean') {
      return { ok: false, error: 'autoLayout must be a boolean' };
    }
    state.autoLayout = data.autoLayout;
  }

  return { ok: true, state };
}

export function buildSlimState(
  transactions: Record<string, StoredTransaction>,
  addresses: Record<string, StoredAddress>,
  autoLayout: boolean
): SlimState {
  return {
    transactions: Object.fromEntries(
      Object.entries(transactions).map(([txid, stored]) => [
        txid,
        {
          coordinates: stored.coordinates,
          ...(stored.name && { name: stored.name }),
          ...(stored.color && { color: stored.color }),
          ...(stored.description && { description: stored.description }),
          ...(stored.isPsbt && stored.psbtBase64 && {
            isPsbt: true,
            psbtBase64: stored.psbtBase64,
          }),
        },
      ])
    ),
    addresses,
    autoLayout,
  };
}

export function serializeStateFile(state: SlimState): string {
  return JSON.stringify(state, null, 2);
}
