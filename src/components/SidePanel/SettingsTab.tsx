import React, { useRef, useState } from 'react';
import { useGlobalState } from '../../hooks/useGlobalState';
import { fetchTransaction, fetchOutspends } from '../../api/mempool';
import { parsePsbtBase64, normalizePsbtBase64, enrichPrevoutsFromGraph } from '../../utils/psbt';
import { buildSlimState, parseStateFile, serializeStateFile, type SlimState } from '../../utils/stateFile';
import type { StoredTransaction } from '../../types';

const iconClass = 'shrink-0';

function SaveIcon() {
  return (
    <svg className={iconClass} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function FileOpenIcon() {
  return (
    <svg className={iconClass} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M12 18v-6" />
      <path d="m9 15 3 3 3-3" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className={iconClass} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg className={iconClass} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  );
}

const stateButtonClass =
  'flex flex-1 items-center justify-center gap-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 py-2 px-2 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

export default function SettingsTab() {
  const { autoLayout, setAutoLayout, transactions, addresses, mergeState, clearState, addError } =
    useGlobalState();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);

  const applyLoadedState = async (slim: SlimState) => {
    if (Object.keys(slim.addresses).length > 0) {
      mergeState({ addresses: slim.addresses });
    }

    const txids = Object.keys(slim.transactions);
    const total = txids.length;

    if (total === 0) {
      if (slim.autoLayout !== undefined) {
        await useGlobalState.getState().setAutoLayout(slim.autoLayout);
      }
      return;
    }

    setUploadProgress({ done: 0, total });

    const fetched: Record<string, StoredTransaction> = {};

    for (let i = 0; i < txids.length; i++) {
      const txid = txids[i];
      const meta = slim.transactions[txid];
      try {
        if (meta.isPsbt && meta.psbtBase64) {
          const normalized = normalizePsbtBase64(meta.psbtBase64);
          const parsed = parsePsbtBase64(normalized);
          fetched[parsed.txid] = {
            coordinates: meta.coordinates,
            data: parsed.data,
            outspends: parsed.outspends,
            isPsbt: true,
            psbtBase64: normalized,
            ...(meta.name && { name: meta.name }),
            ...(meta.color && { color: meta.color }),
          };
        } else {
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
        }
      } catch {
        // Skip failed transactions silently
      }
      setUploadProgress({ done: i + 1, total });
    }

    mergeState({ transactions: fetched });

    const merged = useGlobalState.getState().transactions;
    const enriched = enrichPrevoutsFromGraph(merged);
    if (enriched) {
      mergeState({ transactions: enriched });
    }

    if (slim.autoLayout !== undefined) {
      await useGlobalState.getState().setAutoLayout(slim.autoLayout);
    } else if (useGlobalState.getState().autoLayout) {
      await useGlobalState.getState().runLayout();
    }

    setUploadProgress(null);
  };

  const loadStateFromText = async (text: string) => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      addError('Invalid JSON');
      return;
    }

    const result = parseStateFile(raw);
    if (!result.ok) {
      addError(result.error);
      return;
    }

    await applyLoadedState(result.state);
  };

  const handleSaveAs = () => {
    const slim = buildSlimState(transactions, addresses, autoLayout);
    const blob = new Blob([serializeStateFile(slim)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bitcoin-flow-state.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyToClipboard = async (e: React.MouseEvent) => {
    const slim = buildSlimState(transactions, addresses, autoLayout);
    try {
      await navigator.clipboard.writeText(serializeStateFile(slim));
      window.dispatchEvent(
        new CustomEvent('copy-success', { detail: { x: e.clientX, y: e.clientY } })
      );
    } catch {
      addError('Could not copy to clipboard');
    }
  };

  const handleLoadFromClipboard = async () => {
    if (uploadProgress) return;
    try {
      const text = await navigator.clipboard.readText();
      await loadStateFromText(text);
    } catch {
      addError('Could not read from clipboard');
    }
  };

  const handleUploadState = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result;
      if (typeof text !== 'string') {
        addError('Could not read file');
        return;
      }
      await loadStateFromText(text);
    };
    reader.readAsText(file);
  };

  const handleClearState = () => {
    if (confirm('Are you sure you want to clear all state? This cannot be undone.')) {
      clearState();
    }
  };

  const remaining = uploadProgress ? uploadProgress.total - uploadProgress.done : 0;
  const loading = !!uploadProgress;

  return (
    <div className="p-4 space-y-6">
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

      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">State</h3>
        <div className="space-y-2">
          <div className="flex gap-2">
            <button className={stateButtonClass} onClick={handleSaveAs}>
              <SaveIcon />
              Save as…
            </button>
            <button
              className={stateButtonClass}
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
            >
              <FileOpenIcon />
              Load file…
            </button>
          </div>
          <div className="flex gap-2">
            <button className={stateButtonClass} onClick={handleCopyToClipboard}>
              <CopyIcon />
              Copy to clipboard
            </button>
            <button
              className={stateButtonClass}
              onClick={handleLoadFromClipboard}
              disabled={loading}
            >
              <ClipboardIcon />
              Load from clipboard
            </button>
          </div>
          <button
            className="w-full text-sm bg-red-900 hover:bg-red-800 text-white py-2 rounded cursor-pointer"
            onClick={handleClearState}
          >
            Clear State
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleUploadState}
          />
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Upload merges with existing data. Mined transactions are re-fetched from mempool.space; PSBTs are restored from the saved file.
        </p>
      </div>

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
