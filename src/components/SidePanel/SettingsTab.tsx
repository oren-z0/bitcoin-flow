import React, { useRef, useState } from 'react';
import { useGlobalState } from '../../hooks/useGlobalState';
import { fetchTransaction, fetchOutspends } from '../../api/mempool';
import type { StoredAddress, StoredTransaction } from '../../types';

// Slim format saved to disk — no API data, just metadata + coordinates
interface SlimState {
  transactions: Record<string, {
    coordinates: { x: number; y: number };
    name?: string;
    color?: string;
  }>;
  addresses: Record<string, StoredAddress>;
  autoLayout?: boolean;
}

export default function SettingsTab() {
  const { autoLayout, setAutoLayout, transactions, addresses, mergeState, clearState } = useGlobalState();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);

  const handleDownloadState = () => {
    const slim: SlimState = {
      transactions: Object.fromEntries(
        Object.entries(transactions).map(([txid, stored]) => [
          txid,
          {
            coordinates: stored.coordinates,
            ...(stored.name && { name: stored.name }),
            ...(stored.color && { color: stored.color }),
          },
        ])
      ),
      addresses,
      autoLayout,
    };
    const blob = new Blob([JSON.stringify(slim, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bitcoin-flow-state.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUploadState = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    const reader = new FileReader();
    reader.onload = async (ev) => {
      let slim: SlimState;
      try {
        slim = JSON.parse(ev.target?.result as string);
      } catch {
        alert('Invalid state file');
        return;
      }

      // Merge addresses immediately
      if (slim.addresses) {
        mergeState({ addresses: slim.addresses });
      }

      const txids = Object.keys(slim.transactions || {});
      const total = txids.length;
      if (total === 0) return;

      setUploadProgress({ done: 0, total });

      const fetched: Record<string, StoredTransaction> = {};

      for (let i = 0; i < txids.length; i++) {
        const txid = txids[i];
        const meta = slim.transactions[txid];
        try {
          const [data, outspends] = await Promise.all([
            fetchTransaction(txid),
            fetchOutspends(txid),
          ]);
          fetched[txid] = {
            coordinates: meta.coordinates,
            data,
            outspends,
            ...(meta.name && { name: meta.name }),
            ...(meta.color && { color: meta.color }),
          };
        } catch {
          // Skip failed transactions silently
        }
        setUploadProgress({ done: i + 1, total });
      }

      mergeState({ transactions: fetched });
      setUploadProgress(null);
    };
    reader.readAsText(file);
  };

  const handleClearState = () => {
    if (confirm('Are you sure you want to clear all state? This cannot be undone.')) {
      clearState();
    }
  };

  const remaining = uploadProgress ? uploadProgress.total - uploadProgress.done : 0;

  return (
    <div className="p-4 space-y-6">
      {/* Upload progress popup */}
      {uploadProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-gray-800 border border-gray-600 rounded-lg px-6 py-4 text-center shadow-xl">
            <div className="text-white text-sm font-medium mb-1">Loading transactions…</div>
            <div className="text-gray-400 text-xs">
              {remaining} of {uploadProgress.total} remaining
            </div>
            <div className="mt-3 w-48 bg-gray-700 rounded-full h-1.5">
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all"
                style={{ width: `${(uploadProgress.done / uploadProgress.total) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Auto-layout */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Layout</h3>
        <div className="flex items-center gap-3">
          <button
            className={`relative inline-flex h-5 w-10 rounded-full transition-colors cursor-pointer ${autoLayout ? 'bg-blue-600' : 'bg-gray-600'}`}
            onClick={() => setAutoLayout(!autoLayout)}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ${autoLayout ? 'translate-x-5' : 'translate-x-0.5'}`}
            />
          </button>
          <span className="text-sm text-gray-300">Auto-layout</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Automatically arrange nodes when transactions are added or removed.
        </p>
      </div>

      {/* State management */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">State</h3>
        <div className="space-y-2">
          <button
            className="w-full text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 py-2 rounded cursor-pointer"
            onClick={handleDownloadState}
          >
            Save State
          </button>
          <button
            className="w-full text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 py-2 rounded disabled:opacity-50 cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
            disabled={!!uploadProgress}
          >
            Load State
          </button>
          <button
            className="w-full text-sm bg-red-900 hover:bg-red-800 text-white py-2 rounded cursor-pointer"
            onClick={handleClearState}
          >
            Clear State
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleUploadState}
          />
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Upload merges with existing data. Transactions are re-fetched from mempool.space.
        </p>
      </div>

      {/* Stats */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Stats</h3>
        <div className="bg-gray-700 rounded p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-400">Transactions</span>
            <span>{Object.keys(transactions).length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Addresses</span>
            <span>{Object.keys(addresses).length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
