import type { MempoolVin, MempoolVout, StoredAddress, HandleDescriptor, AddressGroup, StoredTransaction } from '../types';
import { truncateAddress } from './formatting';
import { getEffectiveName } from './addressDisplay';
import { getSpendingTxidsForOutput } from './graphConnections';
import { voutScriptpubkeyHex } from './psbt';

const MAX_HANDLES = 8;

/** Txids from mempool outspends only — used for red/green output handle color. */
function mempoolSpendingTxids(
  outspends: import('../types').MempoolOutspend[],
  voutIdx: number
): string[] {
  const o = outspends[voutIdx];
  return o?.spent && o.txid ? [o.txid] : [];
}

function getDisplayLabel(
  address: string | undefined,
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup>
): string {
  if (!address) return 'Non-Standard';
  const name = getEffectiveName(address, addresses[address], groupMap);
  if (name) return name;
  return truncateAddress(address);
}

function getInputDisplayLabel(
  vin: MempoolVin,
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup>,
  isPsbt: boolean,
  loadedTxids: Set<string>
): string {
  const address = vin.prevout?.scriptpubkey_address;
  if (!address) {
    if (isPsbt && vin.txid && !loadedTxids.has(vin.txid)) return 'Unknown';
    return 'Non-Standard';
  }
  return getDisplayLabel(address, addresses, groupMap);
}

function hasEffectiveName(
  address: string | undefined,
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup>
): boolean {
  if (!address) return false;
  return !!getEffectiveName(address, addresses[address], groupMap);
}

// Collapse a subset of inputs into at most placesLeft handles.
// allVins is the full vin list (for indexOf lookups).
function buildCollapsedInputHandles(
  vins: MempoolVin[],
  allVins: MempoolVin[],
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup>,
  placesLeft: number,
  idPrefix: string,
  isPsbt: boolean,
  loadedTxids: Set<string>
): HandleDescriptor[] {
  const named = vins.filter(v => hasEffectiveName(v.prevout?.scriptpubkey_address, addresses, groupMap));
  const unnamed = vins.filter(v => !hasEffectiveName(v.prevout?.scriptpubkey_address, addresses, groupMap));
  const namedCount = named.length;

  if (namedCount === 0) {
    return [{
      id: `${idPrefix}-all`,
      label: `${vins.length} inputs`,
      amount: vins.reduce((s, v) => s + (v.prevout?.value || 0), 0),
      addresses: vins.flatMap(v => v.prevout?.scriptpubkey_address ? [v.prevout.scriptpubkey_address] : []),
      txids: vins.flatMap(v => v.txid ? [v.txid] : []),
      vinIndices: vins.map(v => allVins.indexOf(v)),
    }];
  }

  if (namedCount < placesLeft) {
    const handles: HandleDescriptor[] = named.map((vin, i) => ({
      id: `${idPrefix}-named-${i}`,
      label: getInputDisplayLabel(vin, addresses, groupMap, isPsbt, loadedTxids),
      amount: vin.prevout?.value || 0,
      addresses: vin.prevout?.scriptpubkey_address ? [vin.prevout.scriptpubkey_address] : [],
      txids: vin.txid ? [vin.txid] : [],
      vinIndices: [allVins.indexOf(vin)],
    }));

    if (unnamed.length > 0) {
      handles.push({
        id: `${idPrefix}-other`,
        label: `${unnamed.length} other inputs`,
        amount: unnamed.reduce((s, v) => s + (v.prevout?.value || 0), 0),
        addresses: unnamed.flatMap(v => v.prevout?.scriptpubkey_address ? [v.prevout.scriptpubkey_address] : []),
        txids: unnamed.flatMap(v => v.txid ? [v.txid] : []),
        vinIndices: unnamed.map(v => allVins.indexOf(v)),
      });
    }

    return handles;
  }

  // namedCount >= placesLeft: group named + individual/collapsed unnamed
  const handles: HandleDescriptor[] = [];
  const namedAddresses = named.map(v => v.prevout?.scriptpubkey_address).filter(Boolean) as string[];
  const allSameAddr = namedAddresses.length > 0 && namedAddresses.every(a => a === namedAddresses[0]);
  const namedLabel = allSameAddr
    ? `${namedCount} inputs: ${getEffectiveName(namedAddresses[0], addresses[namedAddresses[0]], groupMap) || truncateAddress(namedAddresses[0])}`
    : `${namedCount} labeled inputs`;

  handles.push({
    id: `${idPrefix}-named`,
    label: namedLabel,
    amount: named.reduce((s, v) => s + (v.prevout?.value || 0), 0),
    addresses: namedAddresses,
    txids: named.flatMap(v => v.txid ? [v.txid] : []),
    vinIndices: named.map(v => allVins.indexOf(v)),
  });

  if (unnamed.length > 0) {
    if (unnamed.length < placesLeft - 1) {
      unnamed.forEach((vin, i) => {
        handles.push({
          id: `${idPrefix}-unnamed-${i}`,
          label: getInputDisplayLabel(vin, addresses, groupMap, isPsbt, loadedTxids),
          amount: vin.prevout?.value || 0,
          addresses: vin.prevout?.scriptpubkey_address ? [vin.prevout.scriptpubkey_address] : [],
          txids: vin.txid ? [vin.txid] : [],
          vinIndices: [allVins.indexOf(vin)],
        });
      });
    } else {
      handles.push({
        id: `${idPrefix}-other`,
        label: `${unnamed.length} other inputs`,
        amount: unnamed.reduce((s, v) => s + (v.prevout?.value || 0), 0),
        addresses: unnamed.flatMap(v => v.prevout?.scriptpubkey_address ? [v.prevout.scriptpubkey_address] : []),
        txids: unnamed.flatMap(v => v.txid ? [v.txid] : []),
        vinIndices: unnamed.map(v => allVins.indexOf(v)),
      });
    }
  }

  return handles;
}

// Collapse a subset of outputs into at most placesLeft handles.
// allVouts is the full vout list (for indexOf lookups).
function buildCollapsedOutputHandles(
  vouts: MempoolVout[],
  allVouts: MempoolVout[],
  outspends: import('../types').MempoolOutspend[],
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup>,
  placesLeft: number,
  idPrefix: string
): HandleDescriptor[] {
  const makeHandle = (vout: MempoolVout, id: string): HandleDescriptor => {
    const i = allVouts.indexOf(vout);
    return {
      id,
      label: vout.scriptpubkey_type === 'op_return'
        ? 'OP_RETURN'
        : getDisplayLabel(vout.scriptpubkey_address, addresses, groupMap),
      amount: vout.value,
      addresses: vout.scriptpubkey_address ? [vout.scriptpubkey_address] : [],
      txids: mempoolSpendingTxids(outspends, i),
      voutIndices: [i],
      isOpReturn: vout.scriptpubkey_type === 'op_return',
    };
  };

  const named = vouts.filter(v =>
    v.scriptpubkey_type !== 'op_return' && hasEffectiveName(v.scriptpubkey_address, addresses, groupMap)
  );
  const unnamed = vouts.filter(v =>
    v.scriptpubkey_type !== 'op_return' && !hasEffectiveName(v.scriptpubkey_address, addresses, groupMap)
  );
  const namedCount = named.length;

  if (namedCount === 0) {
    return [{
      id: `${idPrefix}-all`,
      label: `${vouts.length} outputs`,
      amount: vouts.reduce((s, v) => s + v.value, 0),
      addresses: vouts.flatMap(v => v.scriptpubkey_address ? [v.scriptpubkey_address] : []),
      txids: vouts.flatMap(v => mempoolSpendingTxids(outspends, allVouts.indexOf(v))),
      voutIndices: vouts.map(v => allVouts.indexOf(v)),
    }];
  }

  if (namedCount < placesLeft) {
    const handles: HandleDescriptor[] = named.map((vout, i) =>
      makeHandle(vout, `${idPrefix}-named-${i}`)
    );

    if (unnamed.length > 0) {
      handles.push({
        id: `${idPrefix}-other`,
        label: `${unnamed.length} other outputs`,
        amount: unnamed.reduce((s, v) => s + v.value, 0),
        addresses: unnamed.flatMap(v => v.scriptpubkey_address ? [v.scriptpubkey_address] : []),
        txids: unnamed.flatMap(v => mempoolSpendingTxids(outspends, allVouts.indexOf(v))),
        voutIndices: unnamed.map(v => allVouts.indexOf(v)),
      });
    }

    return handles;
  }

  // namedCount >= placesLeft: group named + individual/collapsed unnamed
  const handles: HandleDescriptor[] = [];
  const namedAddresses = named.map(v => v.scriptpubkey_address).filter(Boolean) as string[];
  const allSameAddr = namedAddresses.length > 0 && namedAddresses.every(a => a === namedAddresses[0]);
  const namedLabel = allSameAddr
    ? `${namedCount} outputs: ${getEffectiveName(namedAddresses[0], addresses[namedAddresses[0]], groupMap) || truncateAddress(namedAddresses[0])}`
    : `${namedCount} labeled outputs`;

  handles.push({
    id: `${idPrefix}-named`,
    label: namedLabel,
    amount: named.reduce((s, v) => s + v.value, 0),
    addresses: namedAddresses,
    txids: named.flatMap(v => mempoolSpendingTxids(outspends, allVouts.indexOf(v))),
    voutIndices: named.map(v => allVouts.indexOf(v)),
  });

  if (unnamed.length > 0) {
    if (unnamed.length < placesLeft - 1) {
      unnamed.forEach((vout, i) => {
        handles.push(makeHandle(vout, `${idPrefix}-unnamed-${i}`));
      });
    } else {
      handles.push({
        id: `${idPrefix}-other`,
        label: `${unnamed.length} other outputs`,
        amount: unnamed.reduce((s, v) => s + v.value, 0),
        addresses: unnamed.flatMap(v => v.scriptpubkey_address ? [v.scriptpubkey_address] : []),
        txids: unnamed.flatMap(v => mempoolSpendingTxids(outspends, allVouts.indexOf(v))),
        voutIndices: unnamed.map(v => allVouts.indexOf(v)),
      });
    }
  }

  return handles;
}

const PSBT_INPUT_DROP_HANDLE: HandleDescriptor = {
  id: 'in-drop',
  label: '',
  amount: 0,
  addresses: [],
  txids: [],
  vinIndices: [],
  isDropPlaceholder: true,
};

export function computeInputHandles(
  vins: MempoolVin[],
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup> = {},
  loadedTxids: Set<string> = new Set(),
  isPsbt = false
): HandleDescriptor[] {
  const count = vins.length;

  if (isPsbt && count === 0) {
    return [PSBT_INPUT_DROP_HANDLE];
  }

  // Coinbase transaction: single vin with is_coinbase flag (or no prevout/txid)
  if (count === 1 && vins[0].is_coinbase) {
    return [{
      id: 'in-0',
      label: 'Coinbase',
      amount: 0,
      addresses: [],
      txids: [],
      vinIndices: [0],
      isCoinbase: true,
    }];
  }

  if (count <= MAX_HANDLES) {
    return vins.map((vin, i) => ({
      id: `in-${i}`,
      label: getInputDisplayLabel(vin, addresses, groupMap, isPsbt, loadedTxids),
      amount: vin.prevout?.value || 0,
      addresses: vin.prevout?.scriptpubkey_address ? [vin.prevout.scriptpubkey_address] : [],
      txids: vin.txid ? [vin.txid] : [],
      vinIndices: [i],
    }));
  }

  // More than MAX_HANDLES inputs
  const connectedVins = vins.filter(v => v.txid && loadedTxids.has(v.txid));
  const unconnectedVins = vins.filter(v => !v.txid || !loadedTxids.has(v.txid));
  const connectedCount = connectedVins.length;

  if (connectedCount >= MAX_HANDLES) {
    // Too many connected to show individually — treat all vins as one pool.
    // Group handles carry txids for all handles they represent so edges still attach.
    return buildCollapsedInputHandles(vins, vins, addresses, groupMap, MAX_HANDLES, 'in', isPsbt, loadedTxids);
  }

  // connectedCount < MAX_HANDLES: connected vins each get their own handle
  const placesLeft = MAX_HANDLES - connectedCount;

  const connectedHandles: HandleDescriptor[] = connectedVins.map((vin) => {
    const originalIdx = vins.indexOf(vin);
    return {
      id: `in-${originalIdx}`,
      label: getInputDisplayLabel(vin, addresses, groupMap, isPsbt, loadedTxids),
      amount: vin.prevout?.value || 0,
      addresses: vin.prevout?.scriptpubkey_address ? [vin.prevout.scriptpubkey_address] : [],
      txids: vin.txid ? [vin.txid] : [],
      vinIndices: [originalIdx],
    };
  });

  const unconnectedHandles = buildCollapsedInputHandles(
    unconnectedVins, vins, addresses, groupMap, placesLeft, 'in', isPsbt, loadedTxids
  );

  return [...connectedHandles, ...unconnectedHandles];
}

export function computeOutputHandles(
  parentTxid: string,
  vouts: MempoolVout[],
  outspends: import('../types').MempoolOutspend[],
  transactions: Record<string, StoredTransaction>,
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup> = {},
  loadedTxids: Set<string> = new Set(),
  isPsbt = false
): HandleDescriptor[] {
  const count = vouts.length;

  const isConnectedVout = (voutIdx: number) =>
    getSpendingTxidsForOutput(
      parentTxid,
      voutIdx,
      transactions,
      outspends[voutIdx]?.spent ? outspends[voutIdx].txid : undefined
    ).some(id => loadedTxids.has(id));

  const makeHandle = (vout: MempoolVout, i: number, id: string): HandleDescriptor => ({
    id,
    label: vout.scriptpubkey_type === 'op_return'
      ? 'OP_RETURN'
      : getDisplayLabel(vout.scriptpubkey_address, addresses, groupMap),
    amount: vout.value,
    addresses: vout.scriptpubkey_address ? [vout.scriptpubkey_address] : [],
    txids: isPsbt
      ? getSpendingTxidsForOutput(
          parentTxid,
          i,
          transactions,
          outspends[i]?.spent ? outspends[i].txid : undefined
        ).filter(t => loadedTxids.has(t))
      : mempoolSpendingTxids(outspends, i),
    voutIndices: [i],
    isOpReturn: vout.scriptpubkey_type === 'op_return',
  });

  if (count <= MAX_HANDLES) {
    return vouts.map((vout, i) => makeHandle(vout, i, `out-${i}`));
  }

  // More than MAX_HANDLES outputs
  const connectedVouts = vouts.filter((_, i) => isConnectedVout(i));
  const unconnectedVouts = vouts.filter((_, i) => !isConnectedVout(i));
  const connectedCount = connectedVouts.length;

  if (connectedCount >= MAX_HANDLES) {
    return buildCollapsedOutputHandles(vouts, vouts, outspends, addresses, groupMap, MAX_HANDLES, 'out');
  }

  // connectedCount < MAX_HANDLES: connected vouts each get their own handle
  const placesLeft = MAX_HANDLES - connectedCount;

  const connectedHandles: HandleDescriptor[] = connectedVouts.map((vout) => {
    const originalIdx = vouts.indexOf(vout);
    return makeHandle(vout, originalIdx, `out-${originalIdx}`);
  });

  const unconnectedHandles = buildCollapsedOutputHandles(
    unconnectedVouts, vouts, outspends, addresses, groupMap, placesLeft, 'out'
  );

  return [...connectedHandles, ...unconnectedHandles];
}

/** Resolve a single vout index from an output handle id, or null if grouped/unknown. */
export function resolveOutputVoutIndexFromHandle(
  nodeId: string,
  handleId: string,
  stored: StoredTransaction,
  transactions: Record<string, StoredTransaction>,
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup>
): number | null {
  const loadedTxids = new Set(Object.keys(transactions));
  const handles = computeOutputHandles(
    nodeId,
    stored.data.vout,
    stored.outspends,
    transactions,
    addresses,
    groupMap,
    loadedTxids,
    !!stored.isPsbt
  );
  const handle = handles.find(h => h.id === handleId);
  if (!handle?.voutIndices || handle.voutIndices.length !== 1) return null;
  return handle.voutIndices[0];
}

/**
 * Index at which to insert a new PSBT input when a connection lands on `targetHandleId`
 * (insert immediately after the handle's position).
 */
export function resolvePsbtInputInsertIndexFromHandle(
  targetHandleId: string,
  stored: StoredTransaction,
  transactions: Record<string, StoredTransaction>,
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup>
): number {
  if (targetHandleId === 'in-drop') return 0;

  const loadedTxids = new Set(Object.keys(transactions));
  const handles = computeInputHandles(
    stored.data.vin,
    addresses,
    groupMap,
    loadedTxids,
    true
  );
  const handle = handles.find(h => h.id === targetHandleId);
  if (handle) {
    if (handle.isDropPlaceholder) return 0;
    const indices = handle.vinIndices ?? [];
    if (indices.length > 0) return Math.max(...indices) + 1;
  }

  const m = /^in-(\d+)$/.exec(targetHandleId);
  if (m) return Number(m[1]) + 1;

  return stored.data.vin.length;
}

export function isPsbtInputHandleId(handleId: string | null | undefined): boolean {
  if (!handleId) return false;
  return handleId === 'in-drop' || /^in-/.test(handleId);
}

export function isOutputHandleId(handleId: string | null | undefined): boolean {
  return !!handleId && /^out-/.test(handleId);
}

/** PSBT payment output that can be dragged as a connect source (may fund multiple PSBTs). */
export function isPsbtOutputSpendable(
  nodeId: string,
  handleId: string,
  stored: StoredTransaction,
  transactions: Record<string, StoredTransaction>,
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup>
): boolean {
  if (!stored.isPsbt) return false;
  const voutIdx = resolveOutputVoutIndexFromHandle(
    nodeId,
    handleId,
    stored,
    transactions,
    addresses,
    groupMap
  );
  if (voutIdx === null) return false;
  const vout = stored.data.vout[voutIdx];
  if (!vout || vout.scriptpubkey_type === 'op_return' || !voutScriptpubkeyHex(vout)) {
    return false;
  }
  return true;
}

/** Unspent output (green handle) — mempool outspend, or any spendable PSBT payment output. */
export function isUtxoOutputHandle(
  nodeId: string,
  handleId: string,
  stored: StoredTransaction,
  transactions: Record<string, StoredTransaction>,
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup>
): boolean {
  if (stored.isPsbt) {
    return isPsbtOutputSpendable(
      nodeId,
      handleId,
      stored,
      transactions,
      addresses,
      groupMap
    );
  }

  const voutIdx = resolveOutputVoutIndexFromHandle(
    nodeId,
    handleId,
    stored,
    transactions,
    addresses,
    groupMap
  );
  if (voutIdx === null) return false;
  const vout = stored.data.vout[voutIdx];
  if (!vout || vout.scriptpubkey_type === 'op_return') return false;
  const outspend = stored.outspends[voutIdx];
  return !(outspend?.spent && outspend.txid);
}
