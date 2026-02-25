import type { MempoolVin, MempoolVout, StoredAddress, HandleDescriptor, AddressGroup } from '../types';
import { truncateAddress } from './formatting';
import { getEffectiveName } from './addressDisplay';

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
  idPrefix: string
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
      label: getDisplayLabel(vin.prevout?.scriptpubkey_address, addresses, groupMap),
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
          label: getDisplayLabel(vin.prevout?.scriptpubkey_address, addresses, groupMap),
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
      txids: outspends[i]?.txid ? [outspends[i].txid!] : [],
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
      txids: vouts.flatMap(v => {
        const i = allVouts.indexOf(v);
        return outspends[i]?.txid ? [outspends[i].txid!] : [];
      }),
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
        txids: unnamed.flatMap(v => {
          const i = allVouts.indexOf(v);
          return outspends[i]?.txid ? [outspends[i].txid!] : [];
        }),
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
    txids: named.flatMap(v => {
      const i = allVouts.indexOf(v);
      return outspends[i]?.txid ? [outspends[i].txid!] : [];
    }),
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
        txids: unnamed.flatMap(v => {
          const i = allVouts.indexOf(v);
          return outspends[i]?.txid ? [outspends[i].txid!] : [];
        }),
        voutIndices: unnamed.map(v => allVouts.indexOf(v)),
      });
    }
  }

  return handles;
}

export function computeInputHandles(
  vins: MempoolVin[],
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup> = {},
  loadedTxids: Set<string> = new Set()
): HandleDescriptor[] {
  const count = vins.length;

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

  if (count <= 4) {
    return vins.map((vin, i) => ({
      id: `in-${i}`,
      label: getDisplayLabel(vin.prevout?.scriptpubkey_address, addresses, groupMap),
      amount: vin.prevout?.value || 0,
      addresses: vin.prevout?.scriptpubkey_address ? [vin.prevout.scriptpubkey_address] : [],
      txids: vin.txid ? [vin.txid] : [],
      vinIndices: [i],
    }));
  }

  // More than 4 inputs
  const connectedVins = vins.filter(v => v.txid && loadedTxids.has(v.txid));
  const unconnectedVins = vins.filter(v => !v.txid || !loadedTxids.has(v.txid));
  const connectedCount = connectedVins.length;

  if (connectedCount >= 4) {
    // Too many connected to show individually — treat all vins as one pool.
    // Group handles carry txids for all handles they represent so edges still attach.
    return buildCollapsedInputHandles(vins, vins, addresses, groupMap, 4, 'in');
  }

  // connectedCount < 4: connected vins each get their own handle
  const placesLeft = 4 - connectedCount;

  const connectedHandles: HandleDescriptor[] = connectedVins.map((vin) => {
    const originalIdx = vins.indexOf(vin);
    return {
      id: `in-${originalIdx}`,
      label: getDisplayLabel(vin.prevout?.scriptpubkey_address, addresses, groupMap),
      amount: vin.prevout?.value || 0,
      addresses: vin.prevout?.scriptpubkey_address ? [vin.prevout.scriptpubkey_address] : [],
      txids: vin.txid ? [vin.txid] : [],
      vinIndices: [originalIdx],
    };
  });

  const unconnectedHandles = buildCollapsedInputHandles(
    unconnectedVins, vins, addresses, groupMap, placesLeft, 'in'
  );

  return [...connectedHandles, ...unconnectedHandles];
}

export function computeOutputHandles(
  vouts: MempoolVout[],
  outspends: import('../types').MempoolOutspend[],
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup> = {},
  loadedTxids: Set<string> = new Set()
): HandleDescriptor[] {
  const count = vouts.length;

  const makeHandle = (vout: MempoolVout, i: number, id: string): HandleDescriptor => ({
    id,
    label: vout.scriptpubkey_type === 'op_return'
      ? 'OP_RETURN'
      : getDisplayLabel(vout.scriptpubkey_address, addresses, groupMap),
    amount: vout.value,
    addresses: vout.scriptpubkey_address ? [vout.scriptpubkey_address] : [],
    txids: outspends[i]?.txid ? [outspends[i].txid!] : [],
    voutIndices: [i],
    isOpReturn: vout.scriptpubkey_type === 'op_return',
  });

  if (count <= 4) {
    return vouts.map((vout, i) => makeHandle(vout, i, `out-${i}`));
  }

  // More than 4 outputs
  const connectedVouts = vouts.filter((_, i) => {
    const spendTxid = outspends[i]?.txid;
    return !!(spendTxid && loadedTxids.has(spendTxid));
  });
  const unconnectedVouts = vouts.filter((_, i) => {
    const spendTxid = outspends[i]?.txid;
    return !(spendTxid && loadedTxids.has(spendTxid));
  });
  const connectedCount = connectedVouts.length;

  if (connectedCount >= 4) {
    return buildCollapsedOutputHandles(vouts, vouts, outspends, addresses, groupMap, 4, 'out');
  }

  // connectedCount < 4: connected vouts each get their own handle
  const placesLeft = 4 - connectedCount;

  const connectedHandles: HandleDescriptor[] = connectedVouts.map((vout) => {
    const originalIdx = vouts.indexOf(vout);
    return makeHandle(vout, originalIdx, `out-${originalIdx}`);
  });

  const unconnectedHandles = buildCollapsedOutputHandles(
    unconnectedVouts, vouts, outspends, addresses, groupMap, placesLeft, 'out'
  );

  return [...connectedHandles, ...unconnectedHandles];
}
