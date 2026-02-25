import React, { useRef, useState } from 'react';
import Papa from 'papaparse';
import { useGlobalState, layoutRef } from '../../hooks/useGlobalState';
import { truncateTxid, formatTimestamp } from '../../utils/formatting';

export default function TransactionsTab() {
  const { transactions, selectedTxid, setSelectedTxid, addTransaction, removeTransaction, loadingTxids } = useGlobalState();
  const [txInput, setTxInput] = useState('');
  const [loadError, setLoadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddTx = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const txid = txInput.trim().toLowerCase();
    if (!txid) return;
    setLoadError('');
    setTxInput('');
    await addTransaction(txid);
  };

  const handleTxClick = (txid: string) => {
    setSelectedTxid(txid);
    layoutRef.focusNode(txid);
  };

  const handleDownload = () => {
    const rows = Object.entries(transactions).map(([txid, stored]) => ({
      txid,
      name: stored.name || '',
      color: stored.color || '',
    }));
    const csv = Papa.unparse(rows, { header: true });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bitcoin-flow-transactions.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse<{ txid: string; name?: string; color?: string }>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const { addTransactions, updateTransaction } = useGlobalState.getState();
        const txids = results.data
          .map(row => row.txid?.trim())
          .filter(Boolean) as string[];

        await addTransactions(txids);

        // Apply names/colors from CSV
        results.data.forEach(row => {
          const txid = row.txid?.trim();
          if (!txid) return;
          const patch: { name?: string; color?: string } = {};
          if (row.name?.trim()) patch.name = row.name.trim();
          if (row.color?.trim()) patch.color = row.color.trim();
          if (Object.keys(patch).length > 0) {
            updateTransaction(txid, patch);
          }
        });
      },
      error: (err) => {
        setLoadError(`CSV parse error: ${err.message}`);
      },
    });
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const sortedTxids = Object.keys(transactions).sort((a, b) => {
    const ta = transactions[a];
    const tb = transactions[b];
    const ha = ta.data.status.block_height ?? Infinity;
    const hb = tb.data.status.block_height ?? Infinity;
    return hb - ha; // Most recent first
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Add transaction */}
      <div className="p-3 border-b border-gray-700">
        <form onSubmit={handleAddTx} className="flex gap-2">
          <input
            className="flex-1 bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-blue-500 placeholder-gray-500"
            placeholder="Enter txid..."
            value={txInput}
            onChange={e => setTxInput(e.target.value)}
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={txInput.trim().length !== 64 || !/^[0-9a-fA-F]{64}$/.test(txInput.trim()) || loadingTxids.size > 0}
            className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs px-3 py-1 rounded cursor-pointer"
          >
            Add
          </button>
        </form>
        {loadError && <div className="text-red-400 text-xs mt-1">{loadError}</div>}

        {/* CSV buttons */}
        <div className="flex gap-2 mt-2">
          <button
            className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 py-1 rounded cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            Load CSV
          </button>
          <button
            className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 py-1 rounded cursor-pointer"
            onClick={handleDownload}
            disabled={Object.keys(transactions).length === 0}
          >
            Download CSV
          </button>
        </div>
        <div className="text-xs text-gray-500 mt-1">
          CSV format: txid, name, color (optional)
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleUpload}
        />
      </div>

      {/* Transaction list */}
      <div className="flex-1 overflow-y-auto">
        {sortedTxids.length === 0 ? (
          <div className="text-center text-gray-500 text-sm p-6">
            No transactions. Add one above.
          </div>
        ) : (
          <div>
            {sortedTxids.map(txid => {
              const stored = transactions[txid];
              const tx = stored.data;
              const isSelected = selectedTxid === txid;
              const isLoading = loadingTxids.has(txid);

              return (
                <div
                  key={txid}
                  className={`px-3 py-2 cursor-pointer border-b border-gray-700 hover:bg-gray-700 ${isSelected ? 'bg-gray-700' : ''}`}
                  onClick={() => handleTxClick(txid)}
                >
                  <div
                    className="text-sm font-medium truncate"
                    style={{ color: stored.color || '#e5e7eb' }}
                  >
                    {stored.name || truncateTxid(txid)}
                    {isLoading && <span className="text-xs text-gray-400 ml-1">(loading...)</span>}
                  </div>
                  {stored.name && (
                    <div className="text-xs text-gray-500 font-mono truncate">{txid}</div>
                  )}
                  <div className="text-xs text-gray-400">
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
        )}
        {sortedTxids.length > 0 && (
          <div className="p-3 border-t border-gray-700">
            <button
              className="w-full text-xs bg-red-900 hover:bg-red-800 text-white py-1.5 rounded cursor-pointer"
              onClick={() => sortedTxids.forEach(txid => removeTransaction(txid))}
            >
              Remove all transactions
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
