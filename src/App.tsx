import { useEffect, useState } from 'react';
import { ReactFlowProvider } from 'reactflow';
import FlowCanvas from './components/FlowCanvas';
import SidePanel from './components/SidePanel/SidePanel';
import { useGlobalState } from './hooks/useGlobalState';
import { useMempoolWebSocket } from './hooks/useMempoolWebSocket';

function CopiedToast() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = () => {
      setVisible(true);
      setTimeout(() => setVisible(false), 1500);
    };
    window.addEventListener('copy-success', handler);
    return () => window.removeEventListener('copy-success', handler);
  }, []);

  if (!visible) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 bg-gray-700 text-white text-xs px-3 py-1.5 rounded shadow">
      Copied!
    </div>
  );
}

function ErrorToasts() {
  const { errors, dismissError } = useGlobalState();
  if (errors.length === 0) return null;
  return (
    <div className="fixed bottom-4 left-4 z-50 space-y-2">
      {errors.map((err, i) => (
        <div
          key={i}
          className="flex items-center gap-2 bg-red-900 border border-red-700 text-white text-sm px-3 py-2 rounded shadow"
        >
          <span>{err}</span>
          <button
            className="text-red-300 hover:text-white ml-2"
            onClick={() => dismissError(i)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function LoadingIndicator() {
  const { loadingTxids } = useGlobalState();
  if (loadingTxids.size === 0) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-800 border border-gray-600 text-gray-200 text-xs px-4 py-2 rounded shadow">
      Loading {loadingTxids.size} transaction(s)...
    </div>
  );
}

function AppInner() {
  useMempoolWebSocket();

  // On mount, refresh all unconfirmed/unspent transactions
  useEffect(() => {
    const { transactions, refreshTransaction } = useGlobalState.getState();
    for (const [txid, stored] of Object.entries(transactions)) {
      const needsRefresh =
        !stored.data.status.confirmed ||
        stored.outspends.some(o => !o.spent);
      if (needsRefresh) {
        refreshTransaction(txid);
      }
    }
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-900">
      {/* Flow canvas */}
      <div className="flex-1 relative">
        <FlowCanvas />
        <div className="absolute top-3 left-3 text-gray-500 text-sm font-mono select-none">
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
      <SidePanel />

      {/* Overlays */}
      <ErrorToasts />
      <LoadingIndicator />
      <CopiedToast />
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
