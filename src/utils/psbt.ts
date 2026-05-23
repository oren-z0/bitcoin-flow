import { Transaction, OutScript, Address, NETWORK } from '@scure/btc-signer';
import { getPrevOut } from '@scure/btc-signer/transaction.js';
import { base64, hex } from '@scure/base';
import type {
  MempoolTx,
  MempoolVin,
  MempoolVout,
  MempoolOutspend,
  StoredTransaction,
} from '../types';

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

export interface ParsedPsbt {
  txid: string;
  data: MempoolTx;
  outspends: MempoolOutspend[];
}

export function parsePsbtBase64(psbtBase64: string): ParsedPsbt {
  const normalized = normalizePsbtBase64(psbtBase64);
  const bytes = base64.decode(normalized);
  const tx = Transaction.fromPSBT(bytes);
  const txid = tx.id;

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
    const address = tx.getOutputAddress(i);
    const fields = output.script ? scriptToMempoolFields(output.script) : {};
    vout.push({
      value,
      ...fields,
      scriptpubkey_address: address ?? fields.scriptpubkey_address,
    });
  }

  const fee = hasAllInputAmounts && vin.some(v => !v.is_coinbase) ? Math.max(0, inputSum - outputSum) : 0;
  const rawBytes = tx.toBytes(false, false);

  const data: MempoolTx = {
    txid,
    vin,
    vout,
    fee,
    size: rawBytes.length,
    weight: tx.weight,
    version: tx.version,
    locktime: tx.lockTime,
    status: { confirmed: false },
  };

  const outspends: MempoolOutspend[] = vout.map(() => ({ spent: false }));

  return { txid, data, outspends };
}

/** Copy prevout from a loaded parent tx output when vin lacks an address. */
export function enrichPrevoutsFromGraph(
  transactions: Record<string, StoredTransaction>
): Record<string, StoredTransaction> | null {
  let changed = false;
  const updated: Record<string, StoredTransaction> = {};

  for (const [txid, stored] of Object.entries(transactions)) {
    let txChanged = false;
    const newVin = stored.data.vin.map(vin => {
      if (vin.is_coinbase || !vin.txid) return vin;
      if (vin.prevout?.scriptpubkey_address && (vin.prevout?.value ?? 0) > 0) return vin;

      const parent = transactions[vin.txid];
      if (!parent) return vin;

      const parentOut = parent.data.vout[vin.vout];
      if (!parentOut) return vin;

      txChanged = true;
      changed = true;
      return {
        ...vin,
        prevout: {
          value: parentOut.value,
          scriptpubkey_address: parentOut.scriptpubkey_address,
          scriptpubkey_type: parentOut.scriptpubkey_type,
          scriptpubkey: parentOut.scriptpubkey,
        },
      };
    });

    if (txChanged) {
      updated[txid] = {
        ...stored,
        data: { ...stored.data, vin: newVin },
      };
    }
  }

  if (!changed) return null;

  const result = { ...transactions };
  for (const [txid, stored] of Object.entries(updated)) {
    result[txid] = stored;
  }
  return result;
}
