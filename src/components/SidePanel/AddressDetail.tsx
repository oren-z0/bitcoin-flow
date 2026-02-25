import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGlobalState, layoutRef } from '../../hooks/useGlobalState';
import { fetchAddressInfo, fetchAddressTxs, fetchAddressTxsChain, InvalidInputError } from '../../api/mempool';
import { truncateTxid, formatTimestamp } from '../../utils/formatting';
import { EMOJI_PALETTE } from '../../utils/emoji';
import type { MempoolTx } from '../../types';

function copyToClipboard(text: string, e: React.MouseEvent) {
  navigator.clipboard.writeText(text).then(() => {
    window.dispatchEvent(new CustomEvent('copy-success', { detail: { x: e.clientX, y: e.clientY } }));
  }).catch(() => {});
}

interface Props {
  address: string;
  onBack: () => void;
  onOpenAddressDetail: (address: string) => void;
}

export default function AddressDetail({ address, onBack }: Props) {
  const { transactions, addresses, groups, updateAddress, removeAddress, moveAddressToGroup, addTransaction, addTransactions, removeTransaction } = useGlobalState();

  const stored = addresses[address] || { isSelected: false };
  const [nameInput, setNameInput] = useState(stored.name || '');
  const [descInput, setDescInput] = useState(stored.description || '');
  const [showEmojiPalette, setShowEmojiPalette] = useState(false);
  const cursorPosRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [addrTxs, setAddrTxs] = useState<MempoolTx[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [addingAll, setAddingAll] = useState(false);
  const [totalTxCount, setTotalTxCount] = useState(0);
  const [confirmingAddAll, setConfirmingAddAll] = useState(false);

  useEffect(() => {
    setNameInput(stored.name || '');
    setDescInput(stored.description || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const loadTxs = useCallback(async (lastSeenTxid?: string) => {
    setLoading(true);
    setLoadError('');
    try {
      let txs: MempoolTx[];
      if (lastSeenTxid) {
        // Pagination: /txs/chain returns only confirmed txs, 25 per page
        txs = await fetchAddressTxsChain(address, lastSeenTxid);
        setAddrTxs(prev => [...prev, ...txs]);
        setHasMore(txs.length === 25);
      } else {
        // Initial load: returns all mempool txs + first 25 confirmed
        txs = await fetchAddressTxs(address);
        setAddrTxs(txs);
        const confirmedCount = txs.filter(tx => tx.status.confirmed).length;
        setHasMore(confirmedCount >= 25);
      }
    } catch (e) {
      if (e instanceof InvalidInputError) {
        setLoadError(e.message);
      } else {
        setLoadError('Failed to load transactions');
      }
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    setAddrTxs([]);
    setTotalTxCount(0);
    setHasMore(false);
    setConfirmingAddAll(false);
    fetchAddressInfo(address)
      .then(info => setTotalTxCount(info.chain_stats.tx_count + info.mempool_stats.tx_count))
      .catch(() => {});
    loadTxs();
  }, [address, loadTxs]);

  const handleLoadMore = () => {
    // The chain endpoint uses the last confirmed txid as cursor
    const lastConfirmed = [...addrTxs].reverse().find(tx => tx.status.confirmed);
    if (lastConfirmed) loadTxs(lastConfirmed.txid);
  };

  const handleAddAllClick = () => {
    if (totalTxCount > 50) {
      setConfirmingAddAll(true);
    } else {
      doAddAll();
    }
  };

  const doAddAll = async () => {
    setConfirmingAddAll(false);
    setAddingAll(true);
    try {
      // Collect all txids by paginating through the full history
      let allTxids = addrTxs.map(tx => tx.txid);
      let lastConfirmed = [...addrTxs].reverse().find(tx => tx.status.confirmed);
      while (lastConfirmed) {
        const page = await fetchAddressTxsChain(address, lastConfirmed.txid);
        if (page.length === 0) break;
        allTxids = [...allTxids, ...page.map(tx => tx.txid)];
        lastConfirmed = page.length === 25 ? page[page.length - 1] : undefined;
      }
      await addTransactions(allTxids.filter(txid => !transactions[txid]));
    } finally {
      setAddingAll(false);
    }
  };

  const handleTxClick = async (txid: string) => {
    if (transactions[txid]) {
      layoutRef.focusNode(txid);
      useGlobalState.getState().setSelectedTxid(txid);
    } else {
      await addTransaction(txid);
    }
  };

  const insertEmoji = (emoji: string) => {
    const pos = cursorPosRef.current;
    const next = nameInput.slice(0, pos) + emoji + nameInput.slice(pos);
    setNameInput(next);
    updateAddress(address, { name: next || undefined });
    setShowEmojiPalette(false);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const newPos = pos + emoji.length;
      inputRef.current?.setSelectionRange(newPos, newPos);
      cursorPosRef.current = newPos;
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-gray-700">
        <button
          className="text-gray-400 hover:text-white text-xs mb-2"
          onClick={onBack}
        >
          ← Back to Addresses
        </button>

        <div
          className="text-xs font-mono text-gray-300 cursor-pointer hover:text-white truncate"
          title="Click to copy"
          onClick={e => copyToClipboard(address, e)}
        >
          {address}
        </div>

        {/* Group */}
        <div className="flex items-center gap-2 mt-2">
          <label className="text-xs text-gray-400 shrink-0">Group:</label>
          <select
            className="flex-1 min-w-0 bg-gray-700 text-white text-xs px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            value={stored.groupId ?? ''}
            onChange={e => moveAddressToGroup(address, e.target.value)}
          >
            {groups.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>

        {/* Selected toggle */}
        <div className="flex items-center gap-2 mt-2">
          <label className="text-xs text-gray-400">Selected</label>
          <button
            className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${stored.isSelected ? 'bg-blue-600' : 'bg-gray-600'}`}
            onClick={() => updateAddress(address, { isSelected: !stored.isSelected })}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ${stored.isSelected ? 'translate-x-4' : 'translate-x-0.5'}`}
            />
          </button>
        </div>

        {/* Name */}
        <div className="mt-2 relative flex items-center gap-1 bg-gray-700 rounded border border-gray-600 focus-within:border-blue-500">
          <input
            ref={inputRef}
            className="flex-1 min-w-0 bg-transparent text-white text-sm px-2 py-1 focus:outline-none"
            placeholder="Name (optional)"
            value={nameInput}
            onChange={e => {
              setNameInput(e.target.value);
              cursorPosRef.current = e.target.selectionStart ?? 0;
            }}
            onBlur={() => {
              cursorPosRef.current = inputRef.current?.selectionStart ?? 0;
              updateAddress(address, { name: nameInput || undefined });
            }}
            onSelect={() => { cursorPosRef.current = inputRef.current?.selectionStart ?? 0; }}
            onKeyDown={e => { if (e.key === 'Enter') { updateAddress(address, { name: nameInput || undefined }); e.currentTarget.blur(); } }}
          />
          <button
            type="button"
            className="shrink-0 p-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded-r transition-colors"
            onClick={() => setShowEmojiPalette(prev => !prev)}
            title="Insert emoji"
          >
            <span className="text-base" aria-hidden>😀</span>
          </button>
          {showEmojiPalette && (
            <>
              <div
                className="fixed inset-0 z-10"
                aria-hidden
                onClick={() => setShowEmojiPalette(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-20 p-2 bg-gray-800 border border-gray-600 rounded-lg shadow-xl grid grid-cols-8 gap-1 max-h-40 overflow-y-auto">
                {EMOJI_PALETTE.map((emoji, i) => (
                  <button
                    key={i}
                    type="button"
                    className="w-7 h-7 flex items-center justify-center text-lg hover:bg-gray-600 rounded transition-colors"
                    onClick={() => insertEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Description */}
        <textarea
          className="w-full bg-gray-700 text-white text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-blue-500 placeholder-gray-500 resize-none mt-2"
          placeholder="Description (optional)"
          rows={3}
          value={descInput}
          onChange={e => setDescInput(e.target.value)}
          onBlur={() => updateAddress(address, { description: descInput || undefined })}
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { updateAddress(address, { description: descInput || undefined }); e.currentTarget.blur(); } }}
        />

        {/* Color */}
        <div className="flex items-center gap-2 mt-2">
          <label className="text-xs text-gray-400">Color:</label>
          <input
            type="color"
            className="w-8 h-6 rounded cursor-pointer bg-transparent border border-gray-600"
            value={stored.color || '#6b7280'}
            onChange={(e) => updateAddress(address, { color: e.target.value })}
          />
          {stored.color && (
            <button
              className="text-xs text-gray-400 hover:text-white"
              onClick={() => updateAddress(address, { color: undefined })}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Transaction list */}
      <div className="flex-1 overflow-y-auto p-2">
        {loadError && <div className="text-red-400 text-xs p-2">{loadError}</div>}
        {addrTxs.length === 0 && !loading && !loadError && (
          <div className="text-gray-500 text-xs text-center p-4">
            No transactions found for this address.
          </div>
        )}
        <div className="space-y-1">
          {addrTxs.map(tx => {
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
                        addTransaction(tx.txid, { noSelect: true });
                      }
                    }}
                    className="shrink-0 cursor-pointer accent-blue-500"
                  />
                  <div
                    className="text-blue-400 cursor-pointer hover:text-blue-300 font-mono truncate"
                    onClick={() => handleTxClick(tx.txid)}
                  >
                    {storedTx?.name || truncateTxid(tx.txid)}
                  </div>
                </div>
                {storedTx?.name && (
                  <div className="text-gray-500 font-mono text-xs">{truncateTxid(tx.txid)}</div>
                )}
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
            className="w-full text-xs text-gray-400 hover:text-white mt-2 py-1"
            onClick={handleLoadMore}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Load more'}
          </button>
        )}
        {loading && addrTxs.length === 0 && (
          <div className="text-center text-gray-400 text-xs py-4">Loading...</div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-700 space-y-2">
        {totalTxCount > 0 && (
          confirmingAddAll ? (
            <div className="bg-gray-700 rounded p-2 space-y-2">
              <div className="text-xs text-gray-200 text-center">
                Add all {totalTxCount} {totalTxCount === 1 ? 'transaction' : 'transactions'}?
              </div>
              <div className="flex gap-2">
                <button
                  className="flex-1 text-xs bg-blue-800 hover:bg-blue-700 text-white py-1.5 rounded"
                  onClick={doAddAll}
                >
                  Yes, add all
                </button>
                <button
                  className="flex-1 text-xs bg-gray-600 hover:bg-gray-500 text-gray-200 py-1.5 rounded"
                  onClick={() => setConfirmingAddAll(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="w-full text-xs bg-blue-800 hover:bg-blue-700 text-white py-1.5 rounded disabled:opacity-50"
              onClick={handleAddAllClick}
              disabled={addingAll}
            >
              {addingAll
                ? 'Adding...'
                : `Add all ${totalTxCount} ${totalTxCount === 1 ? 'transaction' : 'transactions'}`}
            </button>
          )
        )}
        <a
          href={`https://mempool.space/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 py-1.5 rounded"
        >
          Open on Mempool.space
        </a>
        <button
          className="w-full text-xs bg-red-900 hover:bg-red-800 text-white py-1.5 rounded"
          onClick={() => { removeAddress(address); onBack(); }}
        >
          Delete Address
        </button>
      </div>
    </div>
  );
}
