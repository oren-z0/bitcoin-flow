import { useEffect, useState } from 'react';
import { ReactFlowProvider } from 'reactflow';
import FlowCanvas from './components/FlowCanvas';
import SidePanel from './components/SidePanel/SidePanel';
import StateLoadProgress from './components/StateLoadProgress';
import { setMempoolApiErrorHandler } from './api/mempool';
import { useGlobalState } from './hooks/useGlobalState';
import { useMempoolWebSocket } from './hooks/useMempoolWebSocket';
import { useShareLinkFromHash } from './hooks/useShareLinkFromHash';
import type { LoadProgress } from './utils/loadSlimState';
import { runWithConcurrency } from './utils/staggeredRefresh';

function NotificationToasts() {
  const { errors, successes, dismissError, dismissSuccess } = useGlobalState();
  if (errors.length === 0 && successes.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 max-w-md">
      {successes.map(({ id, message }) => (
        <div
          key={id}
          className="flex items-start gap-2 bg-green-900 border border-green-600 text-white text-sm px-3 py-2 rounded shadow"
        >
          <svg
            className="shrink-0 mt-0.5 text-green-300"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <span className="flex-1">{message}</span>
          <button
            type="button"
            className="text-green-300 hover:text-white shrink-0 cursor-pointer"
            onClick={() => dismissSuccess(id)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
      {errors.map((err, i) => (
        <div
          key={i}
          className="flex items-center gap-2 bg-red-900 border border-red-700 text-white text-sm px-3 py-2 rounded shadow"
        >
          <span>{err}</span>
          <button
            type="button"
            className="text-red-300 hover:text-white ml-2 cursor-pointer"
            onClick={() => dismissError(i)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function LoadingIndicator() {
  const { loadingTxids, transactions } = useGlobalState();
  if (loadingTxids.size === 0) return null;
  // Empty-page examples show their own spinner; avoid duplicate banners.
  if (Object.keys(transactions).length === 0) return null;
  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-800 border border-gray-600 text-gray-200 text-xs px-4 py-2 rounded shadow flex items-center gap-2"
      role="status"
      aria-live="polite"
    >
      <span
        className="inline-block h-3.5 w-3.5 border-2 border-gray-500 border-t-gray-300 rounded-full animate-spin shrink-0"
        aria-hidden
      />
      Loading {loadingTxids.size} transaction{loadingTxids.size === 1 ? '' : 's'}…
    </div>
  );
}

function AppInner() {
  useMempoolWebSocket();
  const [shareLoadProgress, setShareLoadProgress] = useState<LoadProgress>(null);
  useShareLinkFromHash(setShareLoadProgress);

  useEffect(() => {
    setMempoolApiErrorHandler(msg => useGlobalState.getState().addError(msg));
    return () => setMempoolApiErrorHandler(null);
  }, []);

  // On mount, refresh unconfirmed txs (limited concurrency — avoids freezing mobile).
  useEffect(() => {
    const { transactions, refreshTransaction, promotePsbtIfConfirmed } = useGlobalState.getState();
    const refreshTxids: string[] = [];
    for (const [txid, stored] of Object.entries(transactions)) {
      if (stored.isPsbt) {
        void promotePsbtIfConfirmed(txid);
        continue;
      }
      const needsRefresh =
        !stored.data.status.confirmed ||
        stored.outspends.some(o => !o.spent);
      if (needsRefresh) refreshTxids.push(txid);
    }
    void runWithConcurrency(refreshTxids, 2, txid => refreshTransaction(txid));
  }, []);

  const [sidePanelVisible, setSidePanelVisible] = useState(true);

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-gray-900">
      {/* Flow canvas */}
      <div className="flex-1 relative min-w-0">
        <FlowCanvas />
        <div
          className={`absolute top-3 left-3 z-0 text-gray-500 text-sm font-mono select-none ${
            sidePanelVisible ? 'max-md:hidden' : ''
          }`}
        >
          <div className="pointer-events-none">bitcoinflow.niot.space</div>
          <a
            href="https://njump.me/nprofile1qqsrx9hzmz8lj8ss38r4lmkumza2yfvtg4z45wc4dtmp04lv0x69legpz4mhxue69uhhyetvv9ujuerpd46hxtnfduhszrnhwden5te0dehhxtnvdakz7qgkwaehxw309ash2arg9ehx7um5wgcjucm0d5hsfa7mst"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs hover:text-gray-300 transition-colors"
          >
            Follow me on Nostr
          </a>
        </div>
      </div>

      {/* Side panel */}
      {sidePanelVisible
        ? <SidePanel className="relative z-20 shrink-0" onHide={() => setSidePanelVisible(false)} />
        : (
          <button
            className="absolute top-2 right-2 z-10 p-1.5 rounded bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-colors cursor-pointer"
            onClick={() => setSidePanelVisible(true)}
            title="Show panel"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </button>
        )
      }

      {/* Overlays */}
      <StateLoadProgress progress={shareLoadProgress} />
      <NotificationToasts />
      <LoadingIndicator />
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <AppInner />
    </ReactFlowProvider>
  );
}
