import { Transaction, OutScript, Address, NETWORK, getInputType, p2wpkh, p2pkh, p2tr } from '@scure/btc-signer';
import { bip32Path, getPrevOut, SigHashNames } from '@scure/btc-signer/transaction.js';
import type { PSBTInputs, PSBTOutputs } from '@scure/btc-signer/transaction.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { base64, hex } from '@scure/base';
import type {
  MempoolTx,
  MempoolVin,
  MempoolVout,
  MempoolOutspend,
  StoredTransaction,
} from '../types';
import {
  encodeOpReturnScript,
  parseOpReturnEditDraft,
  type OpReturnEditMode,
} from './opReturn';

/** Display-order txid (mempool / node id) ↔ internal bytes in unsigned tx inputs. */
function reverseTxidHex(txid: string): string {
  const bytes = hex.decode(txid.toLowerCase());
  return hex.encode(bytes.slice().reverse());
}

/** Whether a vin/outspend txid refers to a graph node id (incl. `psbt_` prefix and endian variants). */
export function inputTxidMatchesNodeRef(vinTxid: string, nodeRef: string): boolean {
  const a = vinTxid.toLowerCase();
  const b = nodeRef.toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;

  const aBare = a.startsWith('psbt_') ? a.slice(5) : a;
  const bBare = b.startsWith('psbt_') ? b.slice(5) : b;
  if (aBare === bBare) return true;

  if (/^[0-9a-f]{64}$/.test(aBare) && /^[0-9a-f]{64}$/.test(bBare)) {
    if (aBare === reverseTxidHex(bBare) || bBare === reverseTxidHex(aBare)) return true;
  }
  return false;
}

/** 32-byte prevout txid for `updateInput`, from a graph node id or 64-char hex. */
export function nodeRefToPsbtInputTxidBytes(nodeRef: string): Uint8Array {
  const bare = nodeRef.toLowerCase().startsWith('psbt_') ? nodeRef.slice(5) : nodeRef;
  if (!/^[0-9a-f]{64}$/i.test(bare)) {
    throw new Error(`Invalid node id for PSBT input: ${nodeRef}`);
  }
  return hex.decode(bare.toLowerCase());
}

/** Vin/outspend txid string to use after a parent node id change. */
export function nodeRefToVinTxidString(nodeRef: string): string {
  if (isPsbtNodeId(nodeRef)) return nodeRef.slice(5).toLowerCase();
  return nodeRef.toLowerCase();
}

/** Graph node key for a vin prevout txid (matches `psbt_` ids and endian variants). */
export function resolveParentNodeId(
  transactions: Record<string, StoredTransaction>,
  vinTxid: string
): string | undefined {
  if (transactions[vinTxid]) return vinTxid;
  for (const nodeId of Object.keys(transactions)) {
    if (inputTxidMatchesNodeRef(vinTxid, nodeId)) return nodeId;
  }
  return undefined;
}

/** Rewrite parent references in a PSBT when a parent node's graph id changes. */
export function remapPsbtInputParentRefs(
  psbtBase64: string,
  oldNodeId: string,
  newNodeId: string
): string {
  const normalized = normalizePsbtBase64(psbtBase64);
  const tx = Transaction.fromPSBT(base64.decode(normalized));
  const newTxidBytes = nodeRefToPsbtInputTxidBytes(newNodeId);
  let changed = false;

  for (let i = 0; i < tx.inputsLength; i++) {
    const input = tx.getInput(i);
    const vinTxid = input.txid?.length ? bytesToHex(input.txid) : '';
    if (vinTxid && inputTxidMatchesNodeRef(vinTxid, oldNodeId)) {
      tx.updateInput(i, { txid: newTxidBytes });
      changed = true;
    }
  }

  return changed ? base64.encode(tx.toPSBT()) : normalized;
}

function recordIdRewrite(rewrites: Map<string, string>, oldId: string, newId: string): void {
  for (const [key, value] of rewrites) {
    if (value === oldId) rewrites.set(key, newId);
  }
  rewrites.set(oldId, newId);
}

export function resolveNodeIdAfterRewrites(
  txid: string | undefined,
  rewrites: Map<string, string>
): string | undefined {
  if (!txid) return undefined;
  let cur = txid;
  const seen = new Set<string>();
  while (rewrites.has(cur)) {
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = rewrites.get(cur)!;
  }
  return cur;
}

/**
 * When a PSBT node's graph id changes, update child PSBT inputs (and outspends) recursively.
 */
export function propagatePsbtNodeIdChange(
  transactions: Record<string, StoredTransaction>,
  oldNodeId: string,
  newNodeId: string
): { transactions: Record<string, StoredTransaction>; rewrites: Map<string, string> } {
  const rewrites = new Map<string, string>();
  if (oldNodeId === newNodeId) {
    return { transactions, rewrites };
  }

  recordIdRewrite(rewrites, oldNodeId, newNodeId);
  let result = { ...transactions };
  const pending: [string, string][] = [[oldNodeId, newNodeId]];

  while (pending.length > 0) {
    const [oldId, newId] = pending.shift()!;
    const newVinTxid = nodeRefToVinTxidString(newId);

    for (const [txKey, stored] of Object.entries(result)) {
      let outChanged = false;
      const newOutspends = stored.outspends.map((o: MempoolOutspend) => {
        if (o.txid && inputTxidMatchesNodeRef(o.txid, oldId)) {
          outChanged = true;
          return { ...o, txid: newVinTxid };
        }
        return o;
      });
      if (outChanged) {
        result = { ...result, [txKey]: { ...stored, outspends: newOutspends } };
      }
    }

    for (const [childKey, stored] of Object.entries(result)) {
      if (!stored.isPsbt || !stored.psbtBase64) continue;
      const referencesParent = stored.data.vin.some(
        vin => !vin.is_coinbase && vin.txid && inputTxidMatchesNodeRef(vin.txid, oldId)
      );
      if (!referencesParent) continue;

      let newBase64: string;
      try {
        newBase64 = remapPsbtInputParentRefs(stored.psbtBase64, oldId, newId);
      } catch (e) {
        console.error('Failed to remap PSBT parent input', childKey, e);
        continue;
      }

      let parsed: ParsedPsbt;
      try {
        parsed = parsePsbtBase64(newBase64);
      } catch (e) {
        console.error('Invalid PSBT after parent id remap', childKey, e);
        continue;
      }

      const newChildKey = resolvePsbtGraphNodeId(parsed.nodeId, parsed.data.txid, childKey);
      const updatedChild: StoredTransaction = {
        ...result[childKey],
        data: parsed.data,
        outspends: result[childKey].outspends,
        isPsbt: true,
        psbtBase64: newBase64,
      };

      const next = { ...result };
      delete next[childKey];
      next[newChildKey] = updatedChild;
      result = next;

      if (newChildKey !== childKey) {
        recordIdRewrite(rewrites, childKey, newChildKey);
        pending.push([childKey, newChildKey]);
      }
    }
  }

  return { transactions: result, rewrites };
}

/** Update one input's prevout index (vout) in PSBT bytes. */
export function remapPsbtInputVout(
  psbtBase64: string,
  inputIndex: number,
  newVout: number
): string {
  const normalized = normalizePsbtBase64(psbtBase64);
  const tx = Transaction.fromPSBT(base64.decode(normalized));
  tx.updateInput(inputIndex, { index: newVout });
  return base64.encode(tx.toPSBT());
}

/**
 * After swapping two outputs on a parent PSBT, update child PSBT inputs that spent them.
 */
export function propagatePsbtOutputSwap(
  transactions: Record<string, StoredTransaction>,
  parentNodeId: string,
  fromIndex: number,
  toIndex: number
): { transactions: Record<string, StoredTransaction>; rewrites: Map<string, string> } {
  const rewrites = new Map<string, string>();
  let result = { ...transactions };

  const mapVout = (vout: number): number | undefined => {
    if (vout === fromIndex) return toIndex;
    if (vout === toIndex) return fromIndex;
    return undefined;
  };

  for (const [childKey, stored] of Object.entries(result)) {
    if (!stored.isPsbt || !stored.psbtBase64) continue;

    const updates: { inputIndex: number; newVout: number }[] = [];
    stored.data.vin.forEach((vin, inputIndex) => {
      if (vin.is_coinbase || !vin.txid) return;
      if (!inputTxidMatchesNodeRef(vin.txid, parentNodeId)) return;
      const newVout = mapVout(vin.vout);
      if (newVout !== undefined && newVout !== vin.vout) {
        updates.push({ inputIndex, newVout });
      }
    });
    if (updates.length === 0) continue;

    let newBase64 = stored.psbtBase64;
    try {
      for (const { inputIndex, newVout } of updates) {
        newBase64 = remapPsbtInputVout(newBase64, inputIndex, newVout);
      }
    } catch (e) {
      console.error('Failed to remap child PSBT input vout', childKey, e);
      continue;
    }

    let parsed: ParsedPsbt;
    try {
      parsed = parsePsbtBase64(newBase64);
    } catch (e) {
      console.error('Invalid PSBT after vout remap', childKey, e);
      continue;
    }

    const newChildKey = resolvePsbtGraphNodeId(parsed.nodeId, parsed.data.txid, childKey);
    const next = { ...result };
    delete next[childKey];
    next[newChildKey] = {
      ...stored,
      data: parsed.data,
      outspends: stored.outspends,
      isPsbt: true,
      psbtBase64: newBase64,
    };
    result = next;

    if (newChildKey !== childKey) {
      recordIdRewrite(rewrites, childKey, newChildKey);
      const idProp = propagatePsbtNodeIdChange(result, childKey, newChildKey);
      result = idProp.transactions;
      for (const [k, v] of idProp.rewrites) {
        recordIdRewrite(rewrites, k, v);
      }
    }
  }

  return { transactions: result, rewrites };
}

const PSBT_MAGIC = new Uint8Array([0x70, 0x73, 0x62, 0x74, 0xff]);

const addrCodec = Address(NETWORK);

function bytesToHex(bytes: Uint8Array): string {
  return hex.encode(bytes);
}

function scriptToMempoolFields(script: Uint8Array): Pick<MempoolVout, 'scriptpubkey' | 'scriptpubkey_type' | 'scriptpubkey_address'> {
  const scriptpubkey = bytesToHex(script);
  if (script.length > 0 && script[0] === 0x6a) {
    return { scriptpubkey, scriptpubkey_type: 'op_return' };
  }
  try {
    const decoded = OutScript.decode(script);
    if (!decoded) {
      return { scriptpubkey };
    }
    const typeMap: Record<string, string> = {
      wpkh: 'v0_p2wpkh',
      tr: 'v1_p2tr',
      pkh: 'p2pkh',
      sh: 'p2sh',
      wsh: 'v0_p2wsh',
      ms: 'multisig',
    };
    const scriptpubkey_type = typeMap[decoded.type] ?? decoded.type;
    let scriptpubkey_address: string | undefined;
    try {
      scriptpubkey_address = addrCodec.encode(decoded as Parameters<typeof addrCodec.encode>[0]);
    } catch {
      // no address for this script type
    }
    return { scriptpubkey, scriptpubkey_type, scriptpubkey_address };
  } catch {
    return { scriptpubkey };
  }
}

export function normalizePsbtBase64(input: string): string {
  return input.trim().replace(/\s/g, '');
}

export function isPsbtBase64(input: string): boolean {
  const normalized = normalizePsbtBase64(input);
  if (!normalized || /^[0-9a-f]{64}$/i.test(normalized)) return false;
  try {
    const bytes = base64.decode(normalized);
    if (bytes.length < PSBT_MAGIC.length) return false;
    for (let i = 0; i < PSBT_MAGIC.length; i++) {
      if (bytes[i] !== PSBT_MAGIC[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isTxidHex(input: string): boolean {
  return /^[0-9a-f]{64}$/i.test(input.trim());
}

/** True when the PSBT/tx has a finalized 64-char hex txid (not empty / all-zero). */
export function isKnownTxid(txid: string): boolean {
  return /^[0-9a-f]{64}$/i.test(txid) && txid.toLowerCase() !== '0'.repeat(64);
}

export function isPsbtNodeId(id: string): boolean {
  return /^psbt_[0-9a-f]{64}$/i.test(id);
}

export function psbtNodeIdFromBase64(normalizedBase64: string): string {
  const hash = sha256(utf8ToBytes(normalizedBase64));
  return `psbt_${hex.encode(hash)}`;
}

/**
 * Graph node id for a PSBT. Unsigned PSBTs keep their existing `psbt_…` id across
 * edits so updating fields (pubkey, amounts, etc.) does not drop the node.
 */
export function resolvePsbtGraphNodeId(
  parsedNodeId: string,
  chainTxid: string,
  existingGraphId?: string
): string {
  if (isKnownTxid(chainTxid)) return chainTxid.toLowerCase();
  if (existingGraphId && isPsbtNodeId(existingGraphId)) return existingGraphId;
  return parsedNodeId;
}

/** Weight (WU) per input type — standard vsize × 4 for fee display on unsigned PSBTs. */
const INPUT_WEIGHT: Record<string, number> = {
  legacy: 592,
  segwit: 272,
  wpkh: 272,
  tr: 230,
  pkh: 592,
  pk: 592,
  sh: 592,
  wsh: 628,
};

function estimateOutputWeight(script: Uint8Array | undefined): number {
  if (!script?.length) return 124;
  try {
    const decoded = OutScript.decode(script);
    const byType: Record<string, number> = { wpkh: 124, tr: 172, pkh: 68, sh: 64 };
    return byType[decoded.type] ?? 32 + 4 * (script.length + 1);
  } catch {
    return 32 + 4 * (script.length + 1);
  }
}

/** @scure/btc-signer only exposes `weight` on finalized txs; estimate for signing PSBTs. */
function getTransactionWeight(tx: Transaction): number {
  if (tx.isFinal) return tx.weight;

  let weight = 40; // version, counts, locktime (rough)
  let hasWitness = false;

  for (let i = 0; i < tx.inputsLength; i++) {
    const input = tx.getInput(i);
    try {
      const { txType, type } = getInputType(input, true);
      if (txType === 'segwit') hasWitness = true;
      weight += INPUT_WEIGHT[type] ?? INPUT_WEIGHT[txType] ?? 592;
    } catch {
      weight += 592;
    }
  }

  if (hasWitness) weight += 2;

  for (let i = 0; i < tx.outputsLength; i++) {
    weight += estimateOutputWeight(tx.getOutput(i).script);
  }

  return weight;
}

export interface ParsedPsbt {
  /** Key in `transactions` — real txid when known, else `psbt_<sha256(base64)>`. */
  nodeId: string;
  data: MempoolTx;
  outspends: MempoolOutspend[];
}

export function parsePsbtBase64(psbtBase64: string): ParsedPsbt {
  const normalized = normalizePsbtBase64(psbtBase64);
  const bytes = base64.decode(normalized);
  const tx = Transaction.fromPSBT(bytes);

  let chainTxid = '';
  try {
    const id = tx.id;
    if (isKnownTxid(id)) chainTxid = id.toLowerCase();
  } catch {
    // Unsigned PSBT — no tx id yet
  }

  const nodeId = chainTxid || psbtNodeIdFromBase64(normalized);

  const vin: MempoolVin[] = [];
  let inputSum = 0;
  let hasAllInputAmounts = true;

  for (let i = 0; i < tx.inputsLength; i++) {
    const input = tx.getInput(i);
    const txidBytes = input.txid;
    const vinTxid = txidBytes && txidBytes.length > 0 ? bytesToHex(txidBytes) : '';
    const isCoinbase = !vinTxid || vinTxid === '0'.repeat(64);

    let prevout: MempoolVin['prevout'] = { value: 0 };
    if (!isCoinbase) {
      try {
        const prev = getPrevOut(input);
        inputSum += Number(prev.amount);
        prevout = {
          value: Number(prev.amount),
          ...scriptToMempoolFields(prev.script),
        };
      } catch {
        hasAllInputAmounts = false;
        prevout = { value: 0 };
      }
    }

    vin.push({
      txid: isCoinbase ? '' : vinTxid,
      vout: input.index ?? 0,
      sequence: input.sequence ?? 0xffffffff,
      is_coinbase: isCoinbase,
      prevout,
    });
  }

  const vout: MempoolVout[] = [];
  let outputSum = 0;
  for (let i = 0; i < tx.outputsLength; i++) {
    const output = tx.getOutput(i);
    const value = Number(output.amount);
    outputSum += value;
    let address: string | undefined;
    try {
      address = tx.getOutputAddress(i);
    } catch {
      // OP_RETURN and other non-standard outputs have no address
    }
    const fields = output.script ? scriptToMempoolFields(output.script) : {};
    vout.push({
      value,
      ...fields,
      scriptpubkey_address: address ?? fields.scriptpubkey_address,
    });
  }

  const feeFromIo = computeTxFee(vin, vout);
  const fee =
    feeFromIo ??
    (hasAllInputAmounts && vin.some(v => !v.is_coinbase) ? inputSum - outputSum : 0);

  const data: MempoolTx = {
    txid: chainTxid,
    vin,
    vout,
    fee,
    size: tx.unsignedTx.length,
    weight: getTransactionWeight(tx),
    version: tx.version,
    locktime: tx.lockTime,
    status: { confirmed: false },
  };

  const outspends: MempoolOutspend[] = vout.map(() => ({ spent: false }));

  return { nodeId, data, outspends };
}

function vinHasKnownAmount(vin: MempoolVin): boolean {
  if (vin.is_coinbase) return true;
  const prevout = vin.prevout;
  if (!prevout) return false;
  if ((prevout.value ?? 0) > 0) return true;
  return !!prevout.scriptpubkey_address;
}

/** Fee from summed inputs/outputs; null when any non-coinbase input amount is unknown. */
export function computeTxFee(vin: MempoolVin[], vout: MempoolVout[]): number | null {
  if (!vin.some(v => !v.is_coinbase)) return null;

  let inputSum = 0;
  for (const v of vin) {
    if (v.is_coinbase) continue;
    if (!vinHasKnownAmount(v)) return null;
    inputSum += v.prevout!.value;
  }

  const outputSum = vout.reduce((sum, o) => sum + o.value, 0);
  return inputSum - outputSum;
}

function prevoutFromParentOutput(parentOut: MempoolVout): MempoolVin['prevout'] {
  return {
    value: parentOut.value,
    scriptpubkey_address: parentOut.scriptpubkey_address,
    scriptpubkey_type: parentOut.scriptpubkey_type,
  };
}

function prevoutsEqual(a: MempoolVin['prevout'], b: MempoolVin['prevout']): boolean {
  return (
    a.value === b.value &&
    a.scriptpubkey_address === b.scriptpubkey_address &&
    a.scriptpubkey_type === b.scriptpubkey_type
  );
}

/**
 * When a vin's parent tx/PSBT is on the graph, copy that output's prevout (amount + script).
 * Otherwise keep amounts from PSBT witness/non-witness UTXO data. Recomputes fee after changes.
 */
export function enrichPrevoutsFromGraph(
  transactions: Record<string, StoredTransaction>
): Record<string, StoredTransaction> | null {
  let changed = false;
  const result = { ...transactions };

  for (const [txid, stored] of Object.entries(transactions)) {
    let vinChanged = false;
    const newVin = stored.data.vin.map(vin => {
      if (vin.is_coinbase || !vin.txid) return vin;

      const parentKey = resolveParentNodeId(transactions, vin.txid);
      const parent = parentKey ? transactions[parentKey] : undefined;
      if (!parent) return vin;

      const parentOut = parent.data.vout[vin.vout];
      if (!parentOut) return vin;

      const fromParent = prevoutFromParentOutput(parentOut);
      if (prevoutsEqual(vin.prevout, fromParent)) return vin;

      vinChanged = true;
      return { ...vin, prevout: fromParent };
    });

    const feeFromIo = computeTxFee(newVin, stored.data.vout);
    const fee = feeFromIo ?? stored.data.fee;

    if (vinChanged || fee !== stored.data.fee) {
      changed = true;
      result[txid] = {
        ...stored,
        data: { ...stored.data, vin: newVin, fee },
      };
    }
  }

  return changed ? result : null;
}

const HARDENED_OFFSET = 0x80000000;

export interface PsbtDerivationDisplay {
  fingerprint: string;
  path: string;
}

/** Format BIP32 path indices as `m/0h/1` (hardened suffix `h`). */
export function formatBip32Path(path: number[]): string {
  if (path.length === 0) return '';
  return (
    'm/' +
    path
      .map((idx) => {
        const hardened = idx >= HARDENED_OFFSET;
        const i = hardened ? idx - HARDENED_OFFSET : idx;
        return hardened ? `${i}h` : `${i}`;
      })
      .join('/')
  );
}

export function formatFingerprint(fingerprint: number): string {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, fingerprint >>> 0, false);
  return hex.encode(buf);
}

export function parseFingerprintHex(input: string): number | undefined {
  const s = input.trim().replace(/^0x/i, '');
  if (!s) return undefined;
  if (!/^[0-9a-f]{8}$/i.test(s)) {
    throw new Error('Master fingerprint must be 4 bytes (8 hex characters)');
  }
  const buf = hex.decode(s);
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0, false);
}

export function parsePubkeyHex(input: string): Uint8Array {
  const s = input.trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{64}$|^[0-9a-f]{66}$/i.test(s)) {
    throw new Error('Public key must be 32 or 33 bytes (64 or 66 hex characters)');
  }
  return hex.decode(s);
}

function normalizePathInput(path: string): string {
  const t = path.trim();
  if (!t) return '';
  return t.replace(/(\d+)h\b/gi, "$1'");
}

function parsePathInput(path: string): number[] {
  const normalized = normalizePathInput(path);
  if (!normalized) return [];
  return bip32Path(normalized);
}

type PsbtIo = PSBTInputs | PSBTOutputs;

function extractDerivationDisplay(io: PsbtIo): PsbtDerivationDisplay {
  if (io.bip32Derivation?.length) {
    const der = io.bip32Derivation[0][1];
    return {
      fingerprint: formatFingerprint(der.fingerprint),
      path: formatBip32Path(der.path),
    };
  }
  if ('tapBip32Derivation' in io && io.tapBip32Derivation?.length) {
    const der = io.tapBip32Derivation[0][1].der;
    return {
      fingerprint: formatFingerprint(der.fingerprint),
      path: formatBip32Path(der.path),
    };
  }
  return { fingerprint: '', path: '' };
}

function resolvePubkeyForDerivation(io: PsbtIo, isInput: boolean): Uint8Array | undefined {
  if (io.bip32Derivation?.[0]?.[0]) return io.bip32Derivation[0][0];
  if ('tapBip32Derivation' in io && io.tapBip32Derivation?.[0]?.[0]) {
    return io.tapBip32Derivation[0][0];
  }
  if ('tapInternalKey' in io && io.tapInternalKey?.length) return io.tapInternalKey;
  if ('partialSig' in io && io.partialSig?.[0]?.[0]) return io.partialSig[0][0];

  const script =
    ('witnessUtxo' in io && io.witnessUtxo?.script) ||
    ('script' in io && io.script) ||
    undefined;
  if (script?.length) {
    try {
      const decoded = OutScript.decode(script);
      if (decoded.type === 'tr' || decoded.type === 'pk') return decoded.pubkey;
    } catch {
      // ignore
    }
  }

  if (isInput && 'nonWitnessUtxo' in io && io.nonWitnessUtxo && 'index' in io) {
    const idx = io.index ?? 0;
    const prevOut = io.nonWitnessUtxo.outputs[idx];
    if (prevOut?.script?.length) {
      try {
        const decoded = OutScript.decode(prevOut.script);
        if (decoded.type === 'tr' || decoded.type === 'pk') return decoded.pubkey;
      } catch {
        // ignore
      }
    }
  }

  return undefined;
}

type Bip32Der = { fingerprint: number; path: number[] };

// updateInput merges keymaps; `undefined` values remove an entry (undocumented in types).
type KeymapPatchEntry<T> = [Uint8Array, T | undefined];

/** scure merges keymap fields; same pubkey with a new value throws unless the old entry is cleared first. */
function keymapClears<T>(existing: readonly [Uint8Array, T][] | undefined): KeymapPatchEntry<T>[] {
  return (existing ?? []).map(([pk]) => [pk, undefined]);
}

function keymapReplace<T>(
  existing: readonly [Uint8Array, T][] | undefined,
  pubkey: Uint8Array,
  value: T
): KeymapPatchEntry<T>[] {
  const pkHex = hex.encode(pubkey);
  const inPlace = (existing ?? []).some(([pk]) => hex.encode(pk) === pkHex);
  const clears = inPlace ? [[pubkey, undefined] as KeymapPatchEntry<T>] : keymapClears(existing);
  return [...clears, [pubkey, value]];
}

/** Remove BIP32/tap derivations and tap internal key; keeps no pubkey/path in PSBT. */
function clearIoDerivationPubkeyAndPath(io: PsbtIo): Partial<PsbtIo> {
  const patch: Partial<PsbtIo> = {
    bip32Derivation: keymapClears(io.bip32Derivation) as Partial<PsbtIo>['bip32Derivation'],
    tapBip32Derivation: keymapClears(
      'tapBip32Derivation' in io ? io.tapBip32Derivation : undefined
    ) as Partial<PsbtIo>['tapBip32Derivation'],
  };
  if ('tapInternalKey' in io) {
    (patch as Partial<PSBTOutputs>).tapInternalKey = undefined;
  }
  return patch;
}

function buildDerivationPatch(
  io: PsbtIo,
  isInput: boolean,
  fingerprintHex: string,
  pathStr: string,
  pubkeyHex?: string
): Partial<PsbtIo> {
  const path = parsePathInput(pathStr);
  const fingerprint = parseFingerprintHex(fingerprintHex);

  const useTap =
    ('tapBip32Derivation' in io && io.tapBip32Derivation?.length) ||
    ('tapInternalKey' in io && io.tapInternalKey?.length);

  if (fingerprint === undefined && path.length === 0) {
    if (useTap) {
      return {
        tapBip32Derivation: keymapClears(
          'tapBip32Derivation' in io ? io.tapBip32Derivation : undefined
        ) as Partial<PsbtIo>['tapBip32Derivation'],
        bip32Derivation: keymapClears(io.bip32Derivation) as Partial<PsbtIo>['bip32Derivation'],
      };
    }
    return {
      bip32Derivation: keymapClears(io.bip32Derivation) as Partial<PsbtIo>['bip32Derivation'],
      tapBip32Derivation: keymapClears(
        'tapBip32Derivation' in io ? io.tapBip32Derivation : undefined
      ) as Partial<PsbtIo>['tapBip32Derivation'],
    };
  }
  if (fingerprint === undefined) {
    throw new Error('Master fingerprint is required when a derivation path is set');
  }

  const pubkey = pubkeyHex
    ? parsePubkeyHex(pubkeyHex)
    : resolvePubkeyForDerivation(io, isInput);
  if (!pubkey) {
    throw new Error(
      'Cannot determine a public key for this item — enter one below or add partial signatures / a tap internal key in the PSBT first'
    );
  }

  const der: Bip32Der = { fingerprint, path };

  if (useTap) {
    const existing = 'tapBip32Derivation' in io ? io.tapBip32Derivation?.[0] : undefined;
    return {
      tapBip32Derivation: keymapReplace(
        'tapBip32Derivation' in io ? io.tapBip32Derivation : undefined,
        pubkey,
        { hashes: existing?.[1]?.hashes ?? [], der }
      ) as Partial<PsbtIo>['tapBip32Derivation'],
      bip32Derivation: keymapClears(io.bip32Derivation) as Partial<PsbtIo>['bip32Derivation'],
    };
  }

  return {
    bip32Derivation: keymapReplace(io.bip32Derivation, pubkey, der) as Partial<PsbtIo>['bip32Derivation'],
    tapBip32Derivation: keymapClears(
      'tapBip32Derivation' in io ? io.tapBip32Derivation : undefined
    ) as Partial<PsbtIo>['tapBip32Derivation'],
  };
}

export function readPsbtIoDerivation(
  psbtBase64: string,
  kind: 'input' | 'output',
  index: number
): PsbtDerivationDisplay {
  const normalized = normalizePsbtBase64(psbtBase64);
  const tx = Transaction.fromPSBT(base64.decode(normalized));
  const io = kind === 'input' ? tx.getInput(index) : tx.getOutput(index);
  return extractDerivationDisplay(io);
}

export type PsbtScriptKind =
  | 'wpkh'
  | 'pkh'
  | 'tr'
  | 'pk'
  | 'op_return'
  | 'sh'
  | 'wsh'
  | 'ms'
  | 'unknown';

export const PSBT_SCRIPT_TYPE_LABELS: Record<PsbtScriptKind, string> = {
  wpkh: 'v0_p2wpkh',
  pkh: 'p2pkh',
  tr: 'v1_p2tr',
  pk: 'p2pk',
  op_return: 'op_return',
  sh: 'p2sh',
  wsh: 'v0_p2wsh',
  ms: 'multisig',
  unknown: 'unknown',
};

export const PSBT_INPUT_SCRIPT_TYPES: PsbtScriptKind[] = ['wpkh', 'pkh', 'tr'];
export const PSBT_OUTPUT_SCRIPT_TYPES: PsbtScriptKind[] = ['wpkh', 'pkh', 'tr', 'op_return'];

function isEditableScriptKind(kind: PsbtScriptKind): boolean {
  return kind === 'wpkh' || kind === 'pkh' || kind === 'tr' || kind === 'op_return';
}

function getIoScript(io: PsbtIo, isInput: boolean): Uint8Array | undefined {
  if (isInput) {
    const inp = io as PSBTInputs;
    if (inp.witnessUtxo?.script?.length) return inp.witnessUtxo.script;
    const idx = inp.index ?? 0;
    return inp.nonWitnessUtxo?.outputs[idx]?.script;
  }
  return (io as PSBTOutputs).script;
}

export function readScriptKindFromScript(script: Uint8Array | undefined): PsbtScriptKind {
  if (!script?.length) return 'unknown';
  if (script[0] === 0x6a) return 'op_return';
  try {
    const decoded = OutScript.decode(script);
    const t = decoded.type;
    if (
      t === 'wpkh' ||
      t === 'pkh' ||
      t === 'tr' ||
      t === 'pk' ||
      t === 'sh' ||
      t === 'wsh' ||
      t === 'ms'
    ) {
      return t;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function readPsbtIoScriptType(
  psbtBase64: string,
  kind: 'input' | 'output',
  index: number
): PsbtScriptKind {
  const tx = openPsbtForEdit(psbtBase64);
  const io = kind === 'input' ? tx.getInput(index) : tx.getOutput(index);
  return readScriptKindFromScript(getIoScript(io, kind === 'input'));
}

function scriptBytesForKind(kind: PsbtScriptKind, pubkey: Uint8Array | undefined): Uint8Array {
  if (kind === 'op_return') return hex.decode('6a00');
  if (!pubkey) {
    throw new Error('Public key is required for this script type');
  }
  switch (kind) {
    case 'wpkh':
      return p2wpkh(pubkey).script!;
    case 'pkh':
      return p2pkh(pubkey).script!;
    case 'tr': {
      const xonly = pubkey.length === 33 && pubkey[0] !== 0x04 ? pubkey.slice(1) : pubkey;
      return p2tr(xonly).script!;
    }
    case 'pk':
      return OutScript.encode({ type: 'pk', pubkey });
    default:
      throw new Error(`Script type "${PSBT_SCRIPT_TYPE_LABELS[kind]}" cannot be set from a public key`);
  }
}

function applyScriptToIo(
  tx: Transaction,
  kind: 'input' | 'output',
  index: number,
  script: Uint8Array
): void {
  if (kind === 'input') {
    const inp = tx.getInput(index);
    const amount = inp.witnessUtxo?.amount ?? 0n;
    tx.updateInput(index, { witnessUtxo: { script, amount } }, true);
  } else {
    const out = tx.getOutput(index);
    tx.updateOutput(index, { script, amount: out.amount }, true);
  }
}

function scriptToAddress(script: Uint8Array | undefined): string | undefined {
  if (!script?.length || script[0] === 0x6a) return undefined;
  try {
    const decoded = OutScript.decode(script);
    return addrCodec.encode(decoded as Parameters<typeof addrCodec.encode>[0]);
  } catch {
    return undefined;
  }
}

/** Address for a pubkey under an editable script type (wpkh, pkh, tr). */
export function addressFromPubkeyAndScriptKind(
  pubkeyHex: string,
  kind: PsbtScriptKind
): string | null {
  try {
    const trimmed = pubkeyHex.trim();
    if (!trimmed || !isEditableScriptKind(kind) || kind === 'op_return') return null;
    const script = scriptBytesForKind(kind, parsePubkeyHex(trimmed));
    return scriptToAddress(script) ?? null;
  } catch {
    return null;
  }
}

/** Re-encode script from a pubkey for a given script kind (wpkh, pkh, tr, pk). */
function outputScriptFromPubkey(
  currentScript: Uint8Array | undefined,
  pubkey: Uint8Array
): Uint8Array | null {
  if (!currentScript?.length || currentScript[0] === 0x6a) return null;
  const kind = readScriptKindFromScript(currentScript);
  if (!isEditableScriptKind(kind) || kind === 'op_return') return null;
  try {
    return scriptBytesForKind(kind, pubkey);
  } catch {
    return null;
  }
}

export function addressFromOutputPubkey(
  currentScript: Uint8Array | undefined,
  pubkeyHex: string
): string | null {
  try {
    const pubkey = parsePubkeyHex(pubkeyHex);
    const script = outputScriptFromPubkey(currentScript, pubkey);
    if (!script) return null;
    return scriptToAddress(script) ?? null;
  } catch {
    return null;
  }
}

export function updatePsbtOutputAddress(
  psbtBase64: string,
  outputIndex: number,
  address: string
): string {
  const trimmed = address.trim();
  if (!trimmed) throw new Error('Address is required');
  const tx = openPsbtForEdit(psbtBase64);
  let decoded;
  try {
    decoded = Address(NETWORK).decode(trimmed);
  } catch {
    throw new Error('Invalid Bitcoin address');
  }
  const script = OutScript.encode(decoded as Parameters<typeof OutScript.encode>[0]);
  const cur = tx.getOutput(outputIndex);
  tx.updateOutput(outputIndex, { script, amount: cur.amount }, true);
  const io = tx.getOutput(outputIndex);
  tx.updateOutput(outputIndex, clearIoDerivationPubkeyAndPath(io));
  return base64.encode(tx.toPSBT());
}

export function updatePsbtIoDerivation(
  psbtBase64: string,
  kind: 'input' | 'output',
  index: number,
  fingerprintHex: string,
  pathStr: string,
  pubkeyHex?: string,
  scriptType?: PsbtScriptKind
): string {
  const tx = openPsbtForEdit(psbtBase64);
  const isInput = kind === 'input';
  let io = isInput ? tx.getInput(index) : tx.getOutput(index);
  const currentKind = readScriptKindFromScript(getIoScript(io, isInput));
  const targetKind = scriptType ?? currentKind;

  if (targetKind !== currentKind) {
    if (!isEditableScriptKind(targetKind)) {
      throw new Error(`Cannot change script type to ${PSBT_SCRIPT_TYPE_LABELS[targetKind]}`);
    }
    if (isInput && targetKind === 'op_return') {
      throw new Error('OP_RETURN is not valid for inputs');
    }
    const pubkey = pubkeyHex?.trim()
      ? parsePubkeyHex(pubkeyHex)
      : resolvePubkeyForDerivation(io, isInput);
    const script = scriptBytesForKind(targetKind, targetKind === 'op_return' ? undefined : pubkey);
    applyScriptToIo(tx, kind, index, script);
    io = isInput ? tx.getInput(index) : tx.getOutput(index);
  }

  const patch = buildDerivationPatch(io, isInput, fingerprintHex, pathStr, pubkeyHex);
  if (isInput) {
    tx.updateInput(index, patch);
  } else {
    tx.updateOutput(index, patch);
  }

  if (!isInput && targetKind !== 'op_return' && pubkeyHex?.trim()) {
    const pubkey = parsePubkeyHex(pubkeyHex);
    const out = tx.getOutput(index);
    try {
      const newScript = scriptBytesForKind(targetKind, pubkey);
      tx.updateOutput(index, { script: newScript, amount: out.amount }, true);
    } catch {
      const fallback = outputScriptFromPubkey(out.script, pubkey);
      if (fallback) {
        tx.updateOutput(index, { script: fallback, amount: out.amount }, true);
      }
    }
  } else if (isInput && pubkeyHex?.trim() && isEditableScriptKind(targetKind)) {
    const pubkey = parsePubkeyHex(pubkeyHex);
    try {
      const script = scriptBytesForKind(targetKind, pubkey);
      applyScriptToIo(tx, kind, index, script);
    } catch {
      // keep witness utxo from prior step
    }
  }

  return base64.encode(tx.toPSBT());
}

export function updatePsbtOutputAmount(
  psbtBase64: string,
  outputIndex: number,
  amountSats: number
): string {
  if (!Number.isSafeInteger(amountSats) || amountSats < 0) {
    throw new Error('Output amount must be a non-negative integer (satoshis)');
  }
  const tx = openPsbtForEdit(psbtBase64);
  tx.updateOutput(outputIndex, { amount: BigInt(amountSats) }, true);
  return base64.encode(tx.toPSBT());
}

export function updatePsbtInputSequence(
  psbtBase64: string,
  inputIndex: number,
  sequence: number
): string {
  const normalized = normalizePsbtBase64(psbtBase64);
  const tx = Transaction.fromPSBT(base64.decode(normalized));
  tx.updateInput(inputIndex, { sequence: sequence >>> 0 });
  return base64.encode(tx.toPSBT());
}

export function updatePsbtLocktime(psbtBase64: string, locktime: number): string {
  const normalized = normalizePsbtBase64(psbtBase64);
  const tx = Transaction.fromPSBT(base64.decode(normalized));
  (tx as unknown as { global: { fallbackLocktime?: number } }).global.fallbackLocktime =
    locktime >>> 0;
  return base64.encode(tx.toPSBT());
}

export function readPsbtIoPubkey(
  psbtBase64: string,
  kind: 'input' | 'output',
  index: number
): string | undefined {
  const normalized = normalizePsbtBase64(psbtBase64);
  const tx = Transaction.fromPSBT(base64.decode(normalized));
  const io = kind === 'input' ? tx.getInput(index) : tx.getOutput(index);
  const pk = resolvePubkeyForDerivation(io, kind === 'input');
  return pk ? hex.encode(pk) : undefined;
}

export interface PsbtGlobalXpubDisplay {
  fingerprint: string;
  path: string;
  depth: number;
  publicKey: string;
}

export interface PsbtIoAdvancedDisplay {
  pubkey?: string;
  sighashType?: string;
  redeemScript?: string;
  witnessScript?: string;
  tapInternalKey?: string;
  tapBip32DerivationCount?: number;
  partialSigCount?: number;
  finalizedInput?: boolean;
}

export interface PsbtAdvancedMeta {
  psbtVersion: number;
  globalXpubs: PsbtGlobalXpubDisplay[];
  inputs: PsbtIoAdvancedDisplay[];
  outputs: PsbtIoAdvancedDisplay[];
}

function bytesFieldHex(value: Uint8Array | undefined): string | undefined {
  if (!value?.length) return undefined;
  return hex.encode(value);
}

function formatSighashType(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const name = SigHashNames[value];
  return name ? `${name} (${value})` : String(value);
}

function extractIoAdvanced(io: PsbtIo, isInput: boolean): PsbtIoAdvancedDisplay {
  const advanced: PsbtIoAdvancedDisplay = {};

  const pubkey = resolvePubkeyForDerivation(io, isInput);
  if (pubkey) advanced.pubkey = hex.encode(pubkey);

  if (isInput) {
    const inp = io as PSBTInputs;
    const sighash = formatSighashType(inp.sighashType);
    if (sighash) advanced.sighashType = sighash;
    if (inp.finalScriptSig !== undefined) advanced.finalizedInput = true;
    if (inp.partialSig?.length) advanced.partialSigCount = inp.partialSig.length;
    const redeem = bytesFieldHex(inp.redeemScript);
    if (redeem) advanced.redeemScript = redeem;
    const witness = bytesFieldHex(inp.witnessScript);
    if (witness) advanced.witnessScript = witness;
    const tapKey = bytesFieldHex(inp.tapInternalKey);
    if (tapKey) advanced.tapInternalKey = tapKey;
    if (inp.tapBip32Derivation?.length) {
      advanced.tapBip32DerivationCount = inp.tapBip32Derivation.length;
    }
  } else {
    const out = io as PSBTOutputs;
    const redeem = bytesFieldHex(out.redeemScript);
    if (redeem) advanced.redeemScript = redeem;
    const witness = bytesFieldHex(out.witnessScript);
    if (witness) advanced.witnessScript = witness;
    const tapKey = bytesFieldHex(out.tapInternalKey);
    if (tapKey) advanced.tapInternalKey = tapKey;
    if (out.tapBip32Derivation?.length) {
      advanced.tapBip32DerivationCount = out.tapBip32Derivation.length;
    }
  }

  return advanced;
}

function hasIoAdvancedContent(advanced: PsbtIoAdvancedDisplay): boolean {
  return Object.keys(advanced).length > 0;
}

type PsbtGlobalDecoded = {
  version?: number;
  xpub?: Array<
    [
      { depth: number; publicKey: Uint8Array },
      { fingerprint: number; path: number[] },
    ]
  >;
};

export function readPsbtAdvancedMeta(psbtBase64: string): PsbtAdvancedMeta {
  const normalized = normalizePsbtBase64(psbtBase64);
  const tx = Transaction.fromPSBT(base64.decode(normalized));
  const global = (tx as unknown as { global: PsbtGlobalDecoded }).global;

  const globalXpubs: PsbtGlobalXpubDisplay[] = [];
  for (const [xpub, der] of global.xpub ?? []) {
    globalXpubs.push({
      fingerprint: formatFingerprint(der.fingerprint),
      path: formatBip32Path(der.path),
      depth: xpub.depth,
      publicKey: hex.encode(xpub.publicKey),
    });
  }

  const inputs: PsbtIoAdvancedDisplay[] = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    inputs.push(extractIoAdvanced(tx.getInput(i), true));
  }

  const outputs: PsbtIoAdvancedDisplay[] = [];
  for (let i = 0; i < tx.outputsLength; i++) {
    outputs.push(extractIoAdvanced(tx.getOutput(i), false));
  }

  return {
    psbtVersion: global.version ?? 0,
    globalXpubs,
    inputs,
    outputs,
  };
}

const PSBT_EDIT_OPTS = { allowUnknownOutputs: true };

function openPsbtForEdit(psbtBase64: string): Transaction {
  return Transaction.fromPSBT(base64.decode(normalizePsbtBase64(psbtBase64)), PSBT_EDIT_OPTS);
}

function splicePsbtIoList(
  tx: Transaction,
  kind: 'input' | 'output',
  index: number
): void {
  const mutable = tx as unknown as { inputs: unknown[]; outputs: unknown[] };
  const list = kind === 'input' ? mutable.inputs : mutable.outputs;
  if (index < 0 || index >= list.length) {
    throw new Error(`Invalid ${kind} index`);
  }
  list.splice(index, 1);
}

export function removePsbtInput(psbtBase64: string, inputIndex: number): string {
  const tx = openPsbtForEdit(psbtBase64);
  splicePsbtIoList(tx, 'input', inputIndex);
  return base64.encode(tx.toPSBT());
}

export function removePsbtOutput(psbtBase64: string, outputIndex: number): string {
  const tx = openPsbtForEdit(psbtBase64);
  splicePsbtIoList(tx, 'output', outputIndex);
  return base64.encode(tx.toPSBT());
}

function templatePaymentOutputScript(tx: Transaction): Uint8Array {
  for (let i = tx.outputsLength - 1; i >= 0; i--) {
    const out = tx.getOutput(i);
    if (out.script?.length && out.script[0] !== 0x6a) {
      return out.script;
    }
  }
  return OutScript.encode({ type: 'wpkh', hash: new Uint8Array(20) });
}

export function addPsbtPaymentOutput(psbtBase64: string): string {
  const tx = openPsbtForEdit(psbtBase64);
  tx.addOutput({ script: templatePaymentOutputScript(tx), amount: 0n }, true);
  return base64.encode(tx.toPSBT());
}

export function updatePsbtOpReturnPayload(
  psbtBase64: string,
  outputIndex: number,
  payloadDraft: string,
  mode: OpReturnEditMode
): string {
  const payload = parseOpReturnEditDraft(payloadDraft, mode);
  const script = encodeOpReturnScript(payload);
  const tx = openPsbtForEdit(psbtBase64);
  const out = tx.getOutput(outputIndex);
  if (!out.script?.length || out.script[0] !== 0x6a) {
    throw new Error('Output is not OP_RETURN');
  }
  tx.updateOutput(outputIndex, { script, amount: out.amount }, true);
  return base64.encode(tx.toPSBT());
}

export function movePsbtIo(
  psbtBase64: string,
  kind: 'input' | 'output',
  index: number,
  direction: 'up' | 'down'
): string {
  const newIndex = direction === 'up' ? index - 1 : index + 1;
  const normalized = normalizePsbtBase64(psbtBase64);
  const tx = Transaction.fromPSBT(base64.decode(normalized));
  const mutable = tx as unknown as { inputs: unknown[]; outputs: unknown[] };

  const list = kind === 'input' ? mutable.inputs : mutable.outputs;
  if (newIndex < 0 || newIndex >= list.length) {
    throw new Error(`Cannot move ${kind} ${direction}`);
  }

  const tmp = list[index];
  list[index] = list[newIndex];
  list[newIndex] = tmp;

  return base64.encode(tx.toPSBT());
}

export function psbtAdvancedHasContent(meta: PsbtAdvancedMeta): boolean {
  if (meta.globalXpubs.length > 0) return true;
  if (meta.inputs.some(hasIoAdvancedContent)) return true;
  if (meta.outputs.some(hasIoAdvancedContent)) return true;
  return false;
}
