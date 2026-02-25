import { useEffect, useState } from 'react';
import { ReactFlowProvider } from 'reactflow';
import FlowCanvas from './components/FlowCanvas';
import SidePanel from './components/SidePanel/SidePanel';
import { useGlobalState } from './hooks/useGlobalState';
import { useMempoolWebSocket } from './hooks/useMempoolWebSocket';

function CopiedToast() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handler = (e: Event) => {
      const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail;
      setPos({ x, y });
      clearTimeout(timer);
      timer = setTimeout(() => setPos(null), 1500);
    };
    window.addEventListener('copy-success', handler);
    return () => { window.removeEventListener('copy-success', handler); clearTimeout(timer); };
  }, []);

  if (!pos) return null;
  return (
    <div
      className="fixed z-50 bg-gray-700 text-white text-xs px-2 py-1 rounded shadow pointer-events-none -translate-x-1/2 -translate-y-full -mt-1"
      style={{ left: pos.x, top: pos.y - 6 }}
    >
      Copied to clipboard!
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
            className="text-red-300 hover:text-white ml-2 cursor-pointer"
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

  const [sidePanelVisible, setSidePanelVisible] = useState(true);

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
      {sidePanelVisible
        ? <SidePanel onHide={() => setSidePanelVisible(false)} />
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
