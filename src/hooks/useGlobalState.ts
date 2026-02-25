import { create } from 'zustand';
import type { StoredTransaction, StoredAddress, AddressGroup } from '../types';
import { fetchTransaction, fetchOutspends } from '../api/mempool';
import { computeLayout } from '../utils/layout';
import { sortTxids } from '../utils/sorting';

const STORAGE_KEY = 'bitcoin-flow-state';
const NODE_GAP = 400;

interface LayoutRef {
  getViewportCenter: () => { x: number; y: number };
  focusNode: (txid: string) => void;
  setNodePositions: (positions: Record<string, { x: number; y: number }>, animate: boolean) => void;
  fitView: () => void;
}

export const layoutRef: LayoutRef = {
  getViewportCenter: () => ({ x: 0, y: 0 }),
  focusNode: () => {},
  setNodePositions: () => {},
  fitView: () => {},
};

const DEFAULT_GROUP: AddressGroup = { id: '', name: 'Default', addresses: [] };

interface GlobalStore {
  transactions: Record<string, StoredTransaction>;
  addresses: Record<string, StoredAddress>;
  groups: AddressGroup[];
  groupMap: Record<string, AddressGroup>; // derived, not persisted
  selectedAddresses: Set<string>;
  selectedTxid?: string;
  autoLayout: boolean;
  loadingTxids: Set<string>;
  errors: string[];

  // Actions
  addTransaction: (txid: string, opts?: { noFocus?: boolean, noSelect?: boolean }) => Promise<void>;
  addTransactions: (txids: string[]) => Promise<void>;
  removeTransaction: (txid: string) => void;
  updateTransaction: (txid: string, patch: Partial<Pick<StoredTransaction, 'name' | 'color' | 'coordinates'>>) => void;
  updateAddress: (address: string, patch: Partial<StoredAddress>) => void;
  removeAddress: (address: string) => void;
  addAddressesToGroup: (entries: Array<{ address: string; name?: string; description?: string; color?: string }>, groupId: string) => void;
  moveAddressToGroup: (address: string, newGroupId: string) => void;
  addGroup: (name: string) => string; // returns new group id
  ensureGroup: (id: string, name: string) => void; // creates group with given id if it doesn't exist
  updateGroup: (groupId: string, patch: Partial<Pick<AddressGroup, 'name' | 'color'>>) => void;
  removeGroup: (groupId: string) => void;
  setSelectedTxid: (txid: string | undefined) => void;
  setAutoLayout: (value: boolean) => void;
  applyLayout: (positions: Record<string, { x: number; y: number }>) => void;
  runLayout: () => Promise<void>;
  refreshTransaction: (txid: string) => Promise<void>;
  mergeState: (newState: Partial<{ transactions: Record<string, StoredTransaction>; addresses: Record<string, StoredAddress> }>) => void;
  clearState: () => void;
  dismissError: (index: number) => void;
  addError: (msg: string) => void;
}

function buildGroupMap(groups: AddressGroup[]): Record<string, AddressGroup> {
  const map: Record<string, AddressGroup> = {};
  for (const g of groups) map[g.id] = g;
  return map;
}

function loadFromStorage(): Partial<GlobalStore> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    const addresses: Record<string, StoredAddress> = data.addresses || {};

    // Load groups; ensure Default group always exists
    let groups: AddressGroup[] = data.groups || [];
    if (!groups.find((g: AddressGroup) => g.id === '')) {
      groups = [{ ...DEFAULT_GROUP }, ...groups];
    }

    // Reconcile: make sure every address is in exactly one group
    const assignedAddresses = new Set(groups.flatMap((g: AddressGroup) => g.addresses));
    const allAddresses = Object.keys(addresses);
    const unassigned = allAddresses.filter(a => !assignedAddresses.has(a));
    if (unassigned.length > 0) {
      groups = groups.map(g =>
        g.id === '' ? { ...g, addresses: [...g.addresses, ...unassigned] } : g
      );
    }

    return {
      transactions: data.transactions || {},
      addresses,
      groups,
      groupMap: buildGroupMap(groups),
      selectedTxid: data.selectedTxid,
      autoLayout: data.autoLayout ?? true,
    };
  } catch {
    return {};
  }
}

function persist(state: Pick<GlobalStore, 'transactions' | 'addresses' | 'groups' | 'selectedTxid' | 'autoLayout'>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      transactions: state.transactions,
      addresses: state.addresses,
      groups: state.groups,
      selectedTxid: state.selectedTxid,
      autoLayout: state.autoLayout,
    }));
  } catch (e) {
    console.error('Failed to persist state', e);
  }
}

function buildSelectedAddresses(addresses: Record<string, StoredAddress>): Set<string> {
  const set = new Set<string>();
  for (const [addr, data] of Object.entries(addresses)) {
    if (data.isSelected) set.add(addr);
  }
  return set;
}


const NODE_WIDTH = 260;
const SMALL_GAP = 30;

function computeInitialX(
  txid: string,
  transactions: Record<string, StoredTransaction>
): number {
  const sorted = sortTxids(transactions);
  const idx = sorted.indexOf(txid);
  if (sorted.length === 1) return 0;

  // Base X from sorted-order neighbors
  let x: number;
  if (idx === 0) {
    x = transactions[sorted[1]].coordinates.x - NODE_GAP;
  } else if (idx === sorted.length - 1) {
    x = transactions[sorted[sorted.length - 2]].coordinates.x + NODE_GAP;
  } else {
    x = (transactions[sorted[idx - 1]].coordinates.x + transactions[sorted[idx + 1]].coordinates.x) / 2;
  }

  const stored = transactions[txid];

  // 1. Output-connected nodes (nodes that spend this tx's outputs).
  //    This tx must appear to the LEFT of them.
  const outputTxids = stored.outspends
    .map(o => o.txid)
    .filter((id): id is string => !!id && !!transactions[id]);
  if (outputTxids.length > 0) {
    const minX = Math.min(...outputTxids.map(id => transactions[id].coordinates.x));
    const limit = minX - NODE_WIDTH - SMALL_GAP;
    if (x > limit) x = limit;
  }

  // 2. Input-connected nodes (nodes whose outputs this tx spends).
  //    This tx must appear to the RIGHT of them.
  const inputTxids = stored.data.vin
    .map(vin => vin.txid)
    .filter((id): id is string => !!id && !!transactions[id]);
  if (inputTxids.length > 0) {
    const maxX = Math.max(...inputTxids.map(id => transactions[id].coordinates.x));
    const limit = maxX + NODE_WIDTH + SMALL_GAP;
    if (x < limit) x = limit;
  }

  return x;
}

const storedState = loadFromStorage();

const initialGroups: AddressGroup[] = storedState.groups || [{ ...DEFAULT_GROUP }];

export const useGlobalState = create<GlobalStore>((set, get) => ({
  transactions: storedState.transactions || {},
  addresses: storedState.addresses || {},
  groups: initialGroups,
  groupMap: buildGroupMap(initialGroups),
  selectedAddresses: buildSelectedAddresses(storedState.addresses || {}),
  selectedTxid: storedState.selectedTxid,
  autoLayout: storedState.autoLayout ?? true,
  loadingTxids: new Set(),
  errors: [],

  addError: (msg: string) => {
    set(s => ({ errors: [...s.errors, msg] }));
  },

  dismissError: (index: number) => {
    set(s => ({ errors: s.errors.filter((_, i) => i !== index) }));
  },

  addTransaction: async (txid: string, opts?: { noFocus?: boolean, noSelect?: boolean }) => {
    const noFocus = opts?.noFocus ?? false;
    const noSelect = opts?.noSelect ?? false;
    const state = get();
    if (state.transactions[txid]) {
      // Already exists — just focus
      if (!noFocus) {
        layoutRef.focusNode(txid);
      }
      return;
    }
    if (state.loadingTxids.has(txid)) return;

    set(s => ({ loadingTxids: new Set([...s.loadingTxids, txid]) }));

    try {
      const [tx, outspends] = await Promise.all([
        fetchTransaction(txid),
        fetchOutspends(txid),
      ]);

      const viewportCenter = layoutRef.getViewportCenter();
      const y = viewportCenter.y;

      // Add to transactions first with placeholder coords
      const newTx: StoredTransaction = {
        coordinates: { x: 0, y },
        data: tx,
        outspends,
      };

      set(s => {
        const updated = { ...s.transactions, [txid]: newTx };
        const x = computeInitialX(txid, updated);
        updated[txid] = { ...newTx, coordinates: { x, y } };
        persist({ ...s, transactions: updated });
        return { transactions: updated };
      });

      set(s => ({ loadingTxids: new Set([...s.loadingTxids].filter(id => id !== txid)) }));

      const { autoLayout } = get();
      if (autoLayout) {
        await get().runLayout();
      }

      if (!noFocus) {
        // Focus after layout (or immediately if no layout).
        // Use rAF to ensure the node has been rendered before centering.
        requestAnimationFrame(() => layoutRef.focusNode(txid));

        // Select the new transaction
        if (!noSelect) {
          get().setSelectedTxid(txid);
        }
      }
    } catch (e) {
      set(s => ({
        loadingTxids: new Set([...s.loadingTxids].filter(id => id !== txid)),
      }));
      get().addError(`Failed to load transaction ${txid.slice(0, 8)}...`);
      console.error('Failed to add transaction', txid, e);
    }
  },

  addTransactions: async (txids: string[]) => {
    const state = get();
    const toAdd = txids.filter(id => !state.transactions[id]);
    if (toAdd.length === 0) return;

    // Load all in parallel
    const results = await Promise.allSettled(
      toAdd.map(txid =>
        Promise.all([fetchTransaction(txid), fetchOutspends(txid)])
          .then(([tx, outspends]) => ({ txid, tx, outspends }))
      )
    );

    set(s => {
      const updated = { ...s.transactions };
      const viewportCenter = layoutRef.getViewportCenter();

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { txid, tx, outspends } = result.value;
          updated[txid] = {
            coordinates: { x: 0, y: viewportCenter.y },
            data: tx,
            outspends,
          };
        }
      }

      // Now recompute X for all newly added
      const sorted = sortTxids(updated);
      for (let i = 0; i < sorted.length; i++) {
        if (toAdd.includes(sorted[i])) {
          let x: number;
          if (sorted.length === 1) {
            x = 0;
          } else if (i === 0) {
            x = updated[sorted[1]].coordinates.x - NODE_GAP;
          } else if (i === sorted.length - 1) {
            x = updated[sorted[i - 1]].coordinates.x + NODE_GAP;
          } else {
            x = (updated[sorted[i - 1]].coordinates.x + updated[sorted[i + 1]].coordinates.x) / 2;
          }
          updated[sorted[i]] = {
            ...updated[sorted[i]],
            coordinates: { x, y: viewportCenter.y },
          };
        }
      }

      persist({ ...s, transactions: updated });
      return { transactions: updated };
    });

    const { autoLayout } = get();
    if (autoLayout) {
      await get().runLayout();
    }
  },

  removeTransaction: (txid: string) => {
    set(s => {
      const updated = { ...s.transactions };
      delete updated[txid];
      const newSelectedTxid = s.selectedTxid === txid ? undefined : s.selectedTxid;
      persist({ ...s, transactions: updated, selectedTxid: newSelectedTxid });
      return { transactions: updated, selectedTxid: newSelectedTxid };
    });
  },

  updateTransaction: (txid: string, patch) => {
    set(s => {
      const tx = s.transactions[txid];
      if (!tx) return s;
      const updated = {
        ...s.transactions,
        [txid]: { ...tx, ...patch },
      };
      persist({ ...s, transactions: updated });
      return { transactions: updated };
    });
  },

  updateAddress: (address: string, patch) => {
    set(s => {
      const isNew = !s.addresses[address];
      const existing = s.addresses[address] || { isSelected: false };
      const newData: StoredAddress = { ...existing, ...patch };
      const updated = { ...s.addresses, [address]: newData };
      const selectedAddresses = buildSelectedAddresses(updated);

      // When adding a new address, assign it to the specified group (or Default)
      let groups = s.groups;
      if (isNew) {
        const targetGroupId = newData.groupId ?? '';
        // Ensure the target group exists; fall back to Default
        const groupExists = groups.some(g => g.id === targetGroupId);
        const resolvedGroupId = groupExists ? targetGroupId : '';
        newData.groupId = resolvedGroupId;
        updated[address] = newData;
        groups = groups.map(g =>
          g.id === resolvedGroupId
            ? { ...g, addresses: [...g.addresses, address] }
            : g
        );
      }

      const groupMap = buildGroupMap(groups);
      persist({ ...s, addresses: updated, groups });
      return { addresses: updated, selectedAddresses, groups, groupMap };
    });
  },

  removeAddress: (address: string) => {
    set(s => {
      const addr = s.addresses[address];
      const updated = { ...s.addresses };
      delete updated[address];
      const selectedAddresses = buildSelectedAddresses(updated);

      // Remove from its group
      const groupId = addr?.groupId ?? '';
      const groups = s.groups.map(g =>
        g.id === groupId
          ? { ...g, addresses: g.addresses.filter(a => a !== address) }
          : g
      );
      const groupMap = buildGroupMap(groups);
      persist({ ...s, addresses: updated, groups });
      return { addresses: updated, selectedAddresses, groups, groupMap };
    });
  },

  addAddressesToGroup: (entries, groupId) => {
    set(s => {
      const resolvedGroupId = s.groups.some(g => g.id === groupId) ? groupId : '';
      const addresses = { ...s.addresses };
      const newInGroup: string[] = [];
      for (const entry of entries) {
        if (addresses[entry.address]) continue; // skip existing
        addresses[entry.address] = {
          isSelected: false,
          groupId: resolvedGroupId,
          name: entry.name,
          description: entry.description,
          color: entry.color,
        };
        newInGroup.push(entry.address);
      }
      const groups = s.groups.map(g =>
        g.id === resolvedGroupId ? { ...g, addresses: [...g.addresses, ...newInGroup] } : g
      );
      const selectedAddresses = buildSelectedAddresses(addresses);
      const groupMap = buildGroupMap(groups);
      persist({ ...s, addresses, groups });
      return { addresses, selectedAddresses, groups, groupMap };
    });
  },

  moveAddressToGroup: (address: string, newGroupId: string) => {
    set(s => {
      const addr = s.addresses[address];
      if (!addr) return s;
      const oldGroupId = addr.groupId ?? '';
      if (oldGroupId === newGroupId) return s;
      const targetExists = s.groups.some(g => g.id === newGroupId);
      if (!targetExists) return s;

      const updated = { ...s.addresses, [address]: { ...addr, groupId: newGroupId } };
      const groups = s.groups.map(g => {
        if (g.id === oldGroupId) return { ...g, addresses: g.addresses.filter(a => a !== address) };
        if (g.id === newGroupId) return { ...g, addresses: [...g.addresses, address] };
        return g;
      });
      const groupMap = buildGroupMap(groups);
      persist({ ...s, addresses: updated, groups });
      return { addresses: updated, groups, groupMap };
    });
  },

  addGroup: (name: string) => {
    const id = Math.random().toString(36).slice(2, 10);
    set(s => {
      const groups = [...s.groups, { id, name, addresses: [] }];
      const groupMap = buildGroupMap(groups);
      persist({ ...s, groups });
      return { groups, groupMap };
    });
    return id;
  },

  ensureGroup: (id: string, name: string) => {
    set(s => {
      if (s.groups.some(g => g.id === id)) return s;
      const groups = [...s.groups, { id, name, addresses: [] }];
      const groupMap = buildGroupMap(groups);
      persist({ ...s, groups });
      return { groups, groupMap };
    });
  },

  updateGroup: (groupId: string, patch: Partial<Pick<AddressGroup, 'name' | 'color'>>) => {
    set(s => {
      const groups = s.groups.map(g => g.id === groupId ? { ...g, ...patch } : g);
      const groupMap = buildGroupMap(groups);
      persist({ ...s, groups });
      return { groups, groupMap };
    });
  },

  removeGroup: (groupId: string) => {
    if (groupId === '') return; // Cannot remove Default group
    set(s => {
      const group = s.groups.find(g => g.id === groupId);
      if (!group) return s;

      // Remove all addresses in this group
      const updated = { ...s.addresses };
      for (const addr of group.addresses) {
        delete updated[addr];
      }
      const selectedAddresses = buildSelectedAddresses(updated);
      const groups = s.groups.filter(g => g.id !== groupId);
      const groupMap = buildGroupMap(groups);
      persist({ ...s, addresses: updated, groups });
      return { addresses: updated, selectedAddresses, groups, groupMap };
    });
  },

  setSelectedTxid: (txid) => {
    set(s => {
      persist({ ...s, selectedTxid: txid });
      return { selectedTxid: txid };
    });
  },

  setAutoLayout: async (value: boolean) => {
    set(s => {
      persist({ ...s, autoLayout: value });
      return { autoLayout: value };
    });
    if (value) {
      await get().runLayout();
    }
  },

  applyLayout: (positions) => {
    set(s => {
      const updated = { ...s.transactions };
      for (const [txid, pos] of Object.entries(positions)) {
        if (updated[txid]) {
          updated[txid] = { ...updated[txid], coordinates: pos };
        }
      }
      persist({ ...s, transactions: updated });
      return { transactions: updated };
    });
    layoutRef.setNodePositions(positions, true);
  },

  runLayout: async () => {
    const { transactions } = get();
    if (Object.keys(transactions).length === 0) return;
    try {
      const positions = await computeLayout(transactions);
      get().applyLayout(positions);
    } catch (e) {
      console.error('Layout failed', e);
    }
  },

  refreshTransaction: async (txid: string) => {
    try {
      const [tx, outspends] = await Promise.all([
        fetchTransaction(txid),
        fetchOutspends(txid),
      ]);
      set(s => {
        const existing = s.transactions[txid];
        if (!existing) return s;
        const updated = {
          ...s.transactions,
          [txid]: { ...existing, data: tx, outspends },
        };
        persist({ ...s, transactions: updated });
        return { transactions: updated };
      });
    } catch (e) {
      console.error('Failed to refresh transaction', txid, e);
    }
  },

  mergeState: (newState) => {
    set(s => {
      const transactions = { ...s.transactions, ...(newState.transactions || {}) };
      const newAddresses = newState.addresses || {};
      const addresses = { ...s.addresses, ...newAddresses };
      const selectedAddresses = buildSelectedAddresses(addresses);

      // Add newly merged addresses to their groups (or Default)
      let groups = s.groups;
      const existingInGroups = new Set(groups.flatMap(g => g.addresses));
      const toAssign = Object.keys(newAddresses).filter(a => !existingInGroups.has(a));
      if (toAssign.length > 0) {
        groups = groups.map(g =>
          g.id === '' ? { ...g, addresses: [...g.addresses, ...toAssign] } : g
        );
      }
      const groupMap = buildGroupMap(groups);
      persist({ ...s, transactions, addresses, groups });
      return { transactions, addresses, selectedAddresses, groups, groupMap };
    });
  },

  clearState: () => {
    const initialGroupsForClear: AddressGroup[] = [{ ...DEFAULT_GROUP }];
    const empty = {
      transactions: {} as Record<string, StoredTransaction>,
      addresses: {} as Record<string, StoredAddress>,
      groups: initialGroupsForClear,
      selectedTxid: undefined as string | undefined,
      autoLayout: true,
    };
    persist(empty);
    set({
      ...empty,
      groupMap: buildGroupMap(initialGroupsForClear),
      selectedAddresses: new Set(),
      loadingTxids: new Set(),
    });
  },
}));
