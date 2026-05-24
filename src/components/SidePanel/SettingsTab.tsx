import React, { useRef, useState } from 'react';
import { useGlobalState } from '../../hooks/useGlobalState';
import {
  buildSlimState,
  parseStateFile,
  serializeStateFile,
} from '../../utils/stateFile';
import { loadSlimState, type LoadProgress } from '../../utils/loadSlimState';
import {
  buildGistShareUrl,
  buildShareUrl,
  GITHUB_GIST_URL,
  MAX_SHARE_URL_LENGTH,
  parseGistReference,
  SHARE_LINK_TOO_LONG_ERROR,
} from '../../utils/shareState';
import StateLoadProgress from '../StateLoadProgress';

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

function LinkIcon() {
  return (
    <svg className={iconClass} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg className={iconClass} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  );
}

const stateButtonClass =
  'flex flex-1 items-center justify-center gap-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 py-2 px-2 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

export default function SettingsTab() {
  const { autoLayout, setAutoLayout, transactions, addresses, clearState, addError } =
    useGlobalState();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<LoadProgress>(null);
  const [gistFormOpen, setGistFormOpen] = useState(false);
  const [gistUrlInput, setGistUrlInput] = useState('');

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

    await loadSlimState(result.state, setUploadProgress);
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

  const handleShareLink = async (e: React.MouseEvent) => {
    const slim = buildSlimState(transactions, addresses, autoLayout);
    const url = buildShareUrl(slim);
    if (url.length > MAX_SHARE_URL_LENGTH) {
      addError(SHARE_LINK_TOO_LONG_ERROR);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
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

  const handleCreateGistLink = async (e: React.MouseEvent) => {
    const parsed = parseGistReference(gistUrlInput);
    if (!parsed.ok) {
      addError(parsed.error);
      return;
    }
    const url = buildGistShareUrl(parsed.ref);
    try {
      await navigator.clipboard.writeText(url);
      window.dispatchEvent(
        new CustomEvent('copy-success', { detail: { x: e.clientX, y: e.clientY } })
      );
      setGistFormOpen(false);
      setGistUrlInput('');
    } catch {
      addError('Could not copy to clipboard');
    }
  };

  const handleClearState = () => {
    if (confirm('Are you sure you want to clear all state? This cannot be undone.')) {
      clearState();
    }
  };

  const loading = !!uploadProgress;

  return (
    <div className="p-4 space-y-6">
      <StateLoadProgress progress={uploadProgress} />

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
          <button className={`w-full ${stateButtonClass}`} onClick={handleShareLink}>
            <LinkIcon />
            Share Link
          </button>
          {gistFormOpen ? (
            <div className="rounded border border-gray-600 bg-gray-800/80 p-3 space-y-2">
              <p className="text-xs text-gray-300 leading-relaxed">
                Save the state json in a public{' '}
                <a
                  href={GITHUB_GIST_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  Github Gist
                </a>{' '}
                and enter the github gist link below.
              </p>
              <input
                type="text"
                value={gistUrlInput}
                onChange={(e) => setGistUrlInput(e.target.value)}
                placeholder={`${GITHUB_GIST_URL}...`}
                className="w-full text-sm bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-gray-500"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`flex-1 ${stateButtonClass}`}
                  onClick={handleCreateGistLink}
                >
                  <LinkIcon />
                  Create Link
                </button>
                <button
                  type="button"
                  className="text-xs text-gray-400 hover:text-gray-200 px-2 cursor-pointer"
                  onClick={() => {
                    setGistFormOpen(false);
                    setGistUrlInput('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className={`w-full ${stateButtonClass}`}
              onClick={() => setGistFormOpen(true)}
            >
              <GithubIcon />
              Share via Github Gist
            </button>
          )}
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
          Upload merges with existing data. Mined transactions are re-fetched from mempool.space; PSBTs are restored from the saved file. Share Link embeds your graph in the URL; Share via Github Gist uses a public gist for larger states.
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
