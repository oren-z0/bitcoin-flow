import { useCallback, useEffect, useRef, useState } from 'react';
import { useGlobalState, layoutRef } from '../../hooks/useGlobalState';
import { fetchAddressTxs, fetchAddressTxsChain } from '../../api/mempool';
import { truncateTxid, truncateAddress, formatTimestamp } from '../../utils/formatting';
import type { MempoolTx } from '../../types';

interface TxEntry {
  tx: MempoolTx;
  address: string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface GroupCacheEntry {
  txEntries: TxEntry[];
  hasMore: boolean;
  paginationComplete: boolean;
  cursor: { addressIndex: number; lastConfirmedTxid?: string };
  seenTxids: Set<string>;
}

const groupTxCache = new Map<string, GroupCacheEntry>();

interface Props {
  groupId: string;
  onBack: () => void;
}

export default function GroupDetail({ groupId, onBack }: Props) {
  const { groupMap, transactions, addTransaction, addTransactions, removeTransaction } = useGlobalState();

  const group = groupMap[groupId];
  const groupAddresses = group?.addresses ?? [];

  // Stable ref so callbacks always see the latest addresses without re-creating
  const groupAddressesRef = useRef(groupAddresses);
  useEffect(() => { groupAddressesRef.current = groupAddresses; });

  const [txEntries, setTxEntries] = useState<TxEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [paginationComplete, setPaginationComplete] = useState(false);
  const [addingAll, setAddingAll] = useState(false);
  const [confirmingAddAll, setConfirmingAddAll] = useState(false);

  // Points to the next page to load
  const cursorRef = useRef<{ addressIndex: number; lastConfirmedTxid?: string }>({ addressIndex: 0 });
  // Deduplication across all addresses
  const seenTxidsRef = useRef<Set<string>>(new Set());

  const loadPage = useCallback(async (startAddressIndex: number, startLastConfirmedTxid?: string) => {
    const addrs = groupAddressesRef.current;
    if (startAddressIndex >= addrs.length) return;

    setLoading(true);
    setLoadError('');

    let addressIndex = startAddressIndex;
    let lastConfirmedTxid = startLastConfirmedTxid;

    try {
      // Keep fetching pages until we find new entries or exhaust pagination
      let isFirst = true;
      while (addressIndex < addrs.length) {
        if (!isFirst) await sleep(500);
        isFirst = false;
        const address = addrs[addressIndex];
        const txs: MempoolTx[] = lastConfirmedTxid
          ? await fetchAddressTxsChain(address, lastConfirmedTxid)
          : await fetchAddressTxs(address);

        // Deduplicate: only add txids we haven't seen
        const newEntries: TxEntry[] = [];
        for (const tx of txs) {
          if (!seenTxidsRef.current.has(tx.txid)) {
            seenTxidsRef.current.add(tx.txid);
            newEntries.push({ tx, address });
          }
        }

        // Advance cursor for next iteration
        const confirmed = txs.filter(tx => tx.status.confirmed);
        const lastConfirmed = confirmed.at(-1);

        if (confirmed.length >= 25 && lastConfirmed) {
          lastConfirmedTxid = lastConfirmed.txid;
          // addressIndex stays the same (next chain page of same address)
        } else {
          addressIndex++;
          lastConfirmedTxid = undefined;
        }

        if (newEntries.length > 0) {
          setTxEntries(prev => [...prev, ...newEntries]);
          cursorRef.current = { addressIndex, lastConfirmedTxid };
          if (addressIndex < addrs.length) {
            setHasMore(true);
          } else {
            setHasMore(false);
            setPaginationComplete(true);
          }
          return;
        }
        // No new entries — loop continues to next page automatically
      }

      // Exhausted all pages without finding anything new
      cursorRef.current = { addressIndex };
      setHasMore(false);
      setPaginationComplete(true);
    } catch {
      setLoadError('Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cached = groupTxCache.get(groupId);
    if (cached) {
      setTxEntries(cached.txEntries);
      setHasMore(cached.hasMore);
      setPaginationComplete(cached.paginationComplete);
      cursorRef.current = { ...cached.cursor };
      seenTxidsRef.current = new Set(cached.seenTxids);
      setConfirmingAddAll(false);
      return;
    }
    setTxEntries([]);
    setLoadError('');
    setHasMore(false);
    setPaginationComplete(false);
    setConfirmingAddAll(false);
    cursorRef.current = { addressIndex: 0 };
    seenTxidsRef.current = new Set();

    if (groupAddressesRef.current.length > 0) {
      loadPage(0);
    } else {
      setPaginationComplete(true);
    }
  }, [groupId, loadPage]);

  // Keep cache in sync after every load/pagination/addAll
  useEffect(() => {
    if (txEntries.length > 0 || paginationComplete) {
      groupTxCache.set(groupId, {
        txEntries,
        hasMore,
        paginationComplete,
        cursor: { ...cursorRef.current },
        seenTxids: new Set(seenTxidsRef.current),
      });
    }
  }, [groupId, txEntries, hasMore, paginationComplete]);

  const handleLoadMore = () => {
    const { addressIndex, lastConfirmedTxid } = cursorRef.current;
    loadPage(addressIndex, lastConfirmedTxid);
  };

  const handleTxClick = async (txid: string) => {
    if (transactions[txid]) {
      layoutRef.focusNode(txid);
      useGlobalState.getState().setSelectedTxid(txid);
    } else {
      await addTransaction(txid);
    }
  };

  const doAddAll = async () => {
    setConfirmingAddAll(false);
    setAddingAll(true);
    try {
      const allTxids = new Set<string>(seenTxidsRef.current);

      if (!paginationComplete) {
        let { addressIndex, lastConfirmedTxid } = cursorRef.current;
        const addrs = groupAddressesRef.current;

        let isFirst = true;
        while (addressIndex < addrs.length) {
          if (!isFirst) await sleep(500);
          isFirst = false;
          const address = addrs[addressIndex];
          const txs: MempoolTx[] = lastConfirmedTxid
            ? await fetchAddressTxsChain(address, lastConfirmedTxid)
            : await fetchAddressTxs(address);

          // Mirror what loadPage does: deduplicate and update the visible list
          const newEntries: TxEntry[] = [];
          for (const tx of txs) {
            allTxids.add(tx.txid);
            if (!seenTxidsRef.current.has(tx.txid)) {
              seenTxidsRef.current.add(tx.txid);
              newEntries.push({ tx, address });
            }
          }
          if (newEntries.length > 0) {
            setTxEntries(prev => [...prev, ...newEntries]);
          }

          const confirmed = txs.filter(tx => tx.status.confirmed);
          const lastConfirmed = confirmed.at(-1);

          if (confirmed.length >= 25 && lastConfirmed) {
            lastConfirmedTxid = lastConfirmed.txid;
          } else {
            addressIndex++;
            lastConfirmedTxid = undefined;
          }
        }

        // Pagination is now complete
        cursorRef.current = { addressIndex };
        setHasMore(false);
        setPaginationComplete(true);
      }

      const wasEmpty = Object.keys(useGlobalState.getState().transactions).length === 0;
      const toAdd = [...allTxids].filter(txid => !transactions[txid]);
      await addTransactions(toAdd);
      if (wasEmpty && toAdd.length > 0) {
        setTimeout(() => layoutRef.fitView(), 1000);
      }
    } finally {
      setAddingAll(false);
    }
  };

  const visibleCount = txEntries.length;
  const someGroupUnchecked = txEntries.some(({ tx }) => !transactions[tx.txid]);
  const someGroupChecked = txEntries.some(({ tx }) => !!transactions[tx.txid]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-gray-700">
        <button
          className="text-gray-400 hover:text-white text-xs mb-2 cursor-pointer"
          onClick={onBack}
        >
          ← Back to Addresses
        </button>
        <div className="text-sm font-semibold text-gray-200">{group?.name ?? 'Group'}</div>
        <div className="text-xs text-gray-500 mt-0.5">
          {groupAddresses.length} address{groupAddresses.length !== 1 ? 'es' : ''}
          {paginationComplete && ` · ${visibleCount} transaction${visibleCount !== 1 ? 's' : ''}`}
        </div>
      </div>

      {/* Transaction list */}
      <div className="flex-1 overflow-y-auto p-2">
        {loadError && <div className="text-red-400 text-xs p-2">{loadError}</div>}
        {txEntries.length === 0 && !loading && !loadError && paginationComplete && (
          <div className="text-gray-500 text-xs text-center p-4">
            No transactions found.
          </div>
        )}
        {(someGroupUnchecked || someGroupChecked) && (
          <div className="flex gap-3 mb-2">
            {someGroupUnchecked && (
              <button
                className="text-xs text-gray-400 hover:text-white cursor-pointer"
                onClick={() => addTransactions(txEntries.filter(({ tx }) => !transactions[tx.txid]).map(({ tx }) => tx.txid))}
              >
                Add All
              </button>
            )}
            {someGroupChecked && (
              <button
                className="text-xs text-gray-400 hover:text-white cursor-pointer"
                onClick={() => txEntries.filter(({ tx }) => !!transactions[tx.txid]).forEach(({ tx }) => removeTransaction(tx.txid))}
              >
                Remove All
              </button>
            )}
          </div>
        )}
        <div className="space-y-1">
          {txEntries.map(({ tx, address }) => {
            const storedTx = transactions[tx.txid];
            const isInState = !!storedTx;
            return (
              <div key={tx.txid} className="bg-gray-700 rounded p-2 text-xs">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isInState}
                    onChange={() => {
                      if (isInState) {
                        removeTransaction(tx.txid);
                      } else {
                        addTransaction(tx.txid, { noFocus: true });
                      }
                    }}
                    className="shrink-0 cursor-pointer accent-blue-500"
                  />
                  <div
                    className="font-mono text-blue-400 cursor-pointer hover:text-blue-300 truncate"
                    onClick={() => handleTxClick(tx.txid)}
                  >
                    {storedTx?.name || truncateTxid(tx.txid)}
                  </div>
                </div>
                <div className="text-gray-500 font-mono">{truncateAddress(address)}</div>
                <div className="text-gray-400">
                  {tx.status.confirmed
                    ? tx.status.block_time
                      ? formatTimestamp(tx.status.block_time)
                      : `Block ${tx.status.block_height}`
                    : 'Unconfirmed'}
                </div>
              </div>
            );
          })}
        </div>

        {hasMore && (
          <button
            className="w-full text-xs text-gray-400 hover:text-white mt-2 py-1 cursor-pointer"
            onClick={handleLoadMore}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Load more'}
          </button>
        )}
        {loading && txEntries.length === 0 && (
          <div className="text-center text-gray-400 text-xs py-4">Loading...</div>
        )}
      </div>

      {/* Footer */}
      {groupAddresses.length > 0 && !paginationComplete && (
        <div className="p-3 border-t border-gray-700 space-y-2">
          {confirmingAddAll ? (
            <div className="bg-gray-700 rounded p-2 space-y-2">
              <div className="text-xs text-gray-200 text-center">
               Load and add all transactions? Number of transactions is unknown.
              </div>
              <div className="flex gap-2">
                <button
                  className="flex-1 text-xs bg-blue-800 hover:bg-blue-700 text-white py-1.5 rounded cursor-pointer"
                  onClick={doAddAll}
                >
                  Yes, add all
                </button>
                <button
                  className="flex-1 text-xs bg-gray-600 hover:bg-gray-500 text-gray-200 py-1.5 rounded cursor-pointer"
                  onClick={() => setConfirmingAddAll(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="w-full text-xs bg-blue-800 hover:bg-blue-700 text-white py-1.5 rounded disabled:opacity-50 cursor-pointer"
              onClick={() => setConfirmingAddAll(true)}
              disabled={addingAll}
            >
              {addingAll
                ? 'Adding...'
                : 'Load and add all transactions'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
