import type { MempoolVin, MempoolVout, StoredAddress, HandleDescriptor, AddressGroup } from '../types';
import { truncateAddress } from './formatting';
import { getEffectiveName } from './addressDisplay';

function getDisplayLabel(
  address: string | undefined,
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup>
): string {
  if (!address) return 'Unknown';
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

export function computeInputHandles(
  vins: MempoolVin[],
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup> = {}
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
  const namedVins = vins.filter(v => hasEffectiveName(v.prevout?.scriptpubkey_address, addresses, groupMap));
  const namedCount = namedVins.length;

  if (namedCount === 0) {
    return [{
      id: 'in-all',
      label: `${count} inputs`,
      amount: vins.reduce((s, v) => s + (v.prevout?.value || 0), 0),
      addresses: vins.flatMap(v => v.prevout?.scriptpubkey_address ? [v.prevout.scriptpubkey_address] : []),
      txids: vins.map(v => v.txid).filter(Boolean),
      vinIndices: vins.map((_, i) => i),
    }];
  }

  if (namedCount <= 3) {
    const unnamedVins = vins.filter(v => !hasEffectiveName(v.prevout?.scriptpubkey_address, addresses, groupMap));
    const handles: HandleDescriptor[] = namedVins.map((vin, i) => ({
      id: `in-named-${i}`,
      label: getDisplayLabel(vin.prevout?.scriptpubkey_address, addresses, groupMap),
      amount: vin.prevout?.value || 0,
      addresses: vin.prevout?.scriptpubkey_address ? [vin.prevout.scriptpubkey_address] : [],
      txids: vin.txid ? [vin.txid] : [],
      vinIndices: [vins.indexOf(vin)],
    }));

    handles.push({
      id: 'in-other',
      label: `${unnamedVins.length} other inputs`,
      amount: unnamedVins.reduce((s, v) => s + (v.prevout?.value || 0), 0),
      addresses: unnamedVins.flatMap(v => v.prevout?.scriptpubkey_address ? [v.prevout.scriptpubkey_address] : []),
      txids: unnamedVins.map(v => v.txid).filter(Boolean),
      vinIndices: unnamedVins.map(v => vins.indexOf(v)),
    });

    return handles;
  }

  // namedCount > 3
  const handles: HandleDescriptor[] = [];
  const unnamedVins = vins.filter(v => !hasEffectiveName(v.prevout?.scriptpubkey_address, addresses, groupMap));

  // Named group handle
  const namedAddresses = namedVins.map(v => v.prevout?.scriptpubkey_address).filter(Boolean) as string[];
  const allSameAddr = namedAddresses.length > 0 && namedAddresses.every(a => a === namedAddresses[0]);
  let namedLabel: string;
  if (allSameAddr) {
    const name = getEffectiveName(namedAddresses[0], addresses[namedAddresses[0]], groupMap) || truncateAddress(namedAddresses[0]);
    namedLabel = `${namedCount} inputs: ${name}`;
  } else {
    namedLabel = `${namedCount} labeled inputs`;
  }

  handles.push({
    id: 'in-named',
    label: namedLabel,
    amount: namedVins.reduce((s, v) => s + (v.prevout?.value || 0), 0),
    addresses: namedAddresses,
    txids: namedVins.map(v => v.txid).filter(Boolean),
    vinIndices: namedVins.map(v => vins.indexOf(v)),
  });

  // Unnamed handles
  if (unnamedVins.length === 0) {
    // no extra handle
  } else if (unnamedVins.length < 3) {
    unnamedVins.forEach((vin, i) => {
      handles.push({
        id: `in-unnamed-${i}`,
        label: getDisplayLabel(vin.prevout?.scriptpubkey_address, addresses, groupMap),
        amount: vin.prevout?.value || 0,
        addresses: vin.prevout?.scriptpubkey_address ? [vin.prevout.scriptpubkey_address] : [],
        txids: vin.txid ? [vin.txid] : [],
        vinIndices: [vins.indexOf(vin)],
      });
    });
  } else {
    handles.push({
      id: 'in-other',
      label: `${unnamedVins.length} other inputs`,
      amount: unnamedVins.reduce((s, v) => s + (v.prevout?.value || 0), 0),
      addresses: unnamedVins.flatMap(v => v.prevout?.scriptpubkey_address ? [v.prevout.scriptpubkey_address] : []),
      txids: unnamedVins.map(v => v.txid).filter(Boolean),
      vinIndices: unnamedVins.map(v => vins.indexOf(v)),
    });
  }

  return handles;
}

export function computeOutputHandles(
  vouts: MempoolVout[],
  outspends: import('../types').MempoolOutspend[],
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup> = {}
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

  // More than 4 outputs (non-OP_RETURN for grouping logic)
  const namedVouts = vouts.filter((v) =>
    v.scriptpubkey_type !== 'op_return' && hasEffectiveName(v.scriptpubkey_address, addresses, groupMap)
  );
  const namedCount = namedVouts.length;

  if (namedCount === 0) {
    return [{
      id: 'out-all',
      label: `${count} outputs`,
      amount: vouts.reduce((s, v) => s + v.value, 0),
      addresses: vouts.flatMap(v => v.scriptpubkey_address ? [v.scriptpubkey_address] : []),
      txids: outspends.flatMap(o => o.txid ? [o.txid] : []),
      voutIndices: vouts.map((_, i) => i),
    }];
  }

  if (namedCount <= 3) {
    const unnamedVouts = vouts.filter((v) =>
      v.scriptpubkey_type !== 'op_return' && !hasEffectiveName(v.scriptpubkey_address, addresses, groupMap)
    );
    const handles: HandleDescriptor[] = namedVouts.map(vout => {
      const i = vouts.indexOf(vout);
      return makeHandle(vout, i, `out-named-${i}`);
    });

    handles.push({
      id: 'out-other',
      label: `${unnamedVouts.length} other outputs`,
      amount: unnamedVouts.reduce((s, v) => s + v.value, 0),
      addresses: unnamedVouts.flatMap(v => v.scriptpubkey_address ? [v.scriptpubkey_address] : []),
      txids: unnamedVouts.flatMap(v => {
        const i = vouts.indexOf(v);
        return outspends[i]?.txid ? [outspends[i].txid!] : [];
      }),
      voutIndices: unnamedVouts.map(v => vouts.indexOf(v)),
    });

    return handles;
  }

  // namedCount > 3
  const handles: HandleDescriptor[] = [];
  const unnamedVouts = vouts.filter((v) =>
    v.scriptpubkey_type !== 'op_return' && !hasEffectiveName(v.scriptpubkey_address, addresses, groupMap)
  );

  const namedAddresses = namedVouts.map(v => v.scriptpubkey_address).filter(Boolean) as string[];
  const allSameAddr = namedAddresses.length > 0 && namedAddresses.every(a => a === namedAddresses[0]);
  let namedLabel: string;
  if (allSameAddr) {
    const name = getEffectiveName(namedAddresses[0], addresses[namedAddresses[0]], groupMap) || truncateAddress(namedAddresses[0]);
    namedLabel = `${namedCount} outputs: ${name}`;
  } else {
    namedLabel = `${namedCount} labeled outputs`;
  }

  handles.push({
    id: 'out-named',
    label: namedLabel,
    amount: namedVouts.reduce((s, v) => s + v.value, 0),
    addresses: namedAddresses,
    txids: namedVouts.flatMap(v => {
      const i = vouts.indexOf(v);
      return outspends[i]?.txid ? [outspends[i].txid!] : [];
    }),
    voutIndices: namedVouts.map(v => vouts.indexOf(v)),
  });

  if (unnamedVouts.length === 0) {
    // no extra handle
  } else if (unnamedVouts.length < 3) {
    unnamedVouts.forEach((vout) => {
      const i = vouts.indexOf(vout);
      handles.push(makeHandle(vout, i, `out-unnamed-${i}`));
    });
  } else {
    handles.push({
      id: 'out-other',
      label: `${unnamedVouts.length} other outputs`,
      amount: unnamedVouts.reduce((s, v) => s + v.value, 0),
      addresses: unnamedVouts.flatMap(v => v.scriptpubkey_address ? [v.scriptpubkey_address] : []),
      txids: unnamedVouts.flatMap(v => {
        const i = vouts.indexOf(v);
        return outspends[i]?.txid ? [outspends[i].txid!] : [];
      }),
      voutIndices: unnamedVouts.map(v => vouts.indexOf(v)),
    });
  }

  return handles;
}
