import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  ControlButton,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeDragHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useGlobalState, layoutRef } from '../hooks/useGlobalState';
import TransactionNode from './TransactionNode';
import { computeEdgeWidth } from '../utils/edgeStyling';
import { computeInputHandles, computeOutputHandles } from '../utils/handleGrouping';
import { getEffectiveColor } from '../utils/addressDisplay';
import { satsToBtc } from '../utils/formatting';
import type { StoredTransaction, AddressGroup } from '../types';

const nodeTypes: NodeTypes = {
  transaction: TransactionNode,
};

function buildNodes(
  transactions: Record<string, StoredTransaction>
): Node[] {
  return Object.entries(transactions).map(([txid, stored]) => ({
    id: txid,
    type: 'transaction',
    position: stored.coordinates,
    data: { txid, stored },
    style: { background: 'transparent', border: 'none', padding: 0 },
  }));
}

function buildEdges(
  transactions: Record<string, StoredTransaction>,
  addresses: ReturnType<typeof useGlobalState.getState>['addresses'],
  selectedAddresses: Set<string>,
  groupMap: Record<string, AddressGroup>
): Edge[] {
  const edges: Edge[] = [];
  const allAmounts: number[] = [];

  // Collect all edge amounts first for log-scale
  for (const [, stored] of Object.entries(transactions)) {
    stored.outspends.forEach((outspend, voutIdx) => {
      if (outspend.spent && outspend.txid && transactions[outspend.txid]) {
        allAmounts.push(stored.data.vout[voutIdx]?.value || 0);
      }
    });
  }

  for (const [txid, stored] of Object.entries(transactions)) {
    const outHandles = computeOutputHandles(stored.data.vout, stored.outspends, addresses, groupMap);

    stored.outspends.forEach((outspend, voutIdx) => {
      if (!outspend.spent || !outspend.txid || !transactions[outspend.txid]) return;
      const spendingTxid = outspend.txid;
      const vinIdx = outspend.vin ?? 0;
      const amount = stored.data.vout[voutIdx]?.value || 0;
      const voutAddress = stored.data.vout[voutIdx]?.scriptpubkey_address;
      const edgeColor = voutAddress
        ? (getEffectiveColor(addresses[voutAddress], groupMap) ?? '#6b7280')
        : '#6b7280';
      const isSelected = voutAddress ? selectedAddresses.has(voutAddress) : false;
      const width = computeEdgeWidth(amount, allAmounts);

      // Find source handle id in output handles
      let sourceHandle = outHandles.find(h => h.voutIndices?.includes(voutIdx));
      const sourceHandleId = sourceHandle?.id ?? `out-${voutIdx}`;
      const sourceRepresentsMultiple = (sourceHandle?.voutIndices?.length ?? 1) > 1;

      // Find target handle id in input handles
      const spendingTx = transactions[spendingTxid];
      const inHandles = computeInputHandles(spendingTx.data.vin, addresses, groupMap);
      let targetHandle = inHandles.find(h => h.vinIndices?.includes(vinIdx));
      const targetHandleId = targetHandle?.id ?? `in-${vinIdx}`;
      const targetRepresentsMultiple = (targetHandle?.vinIndices?.length ?? 1) > 1;

      const showLabel = sourceRepresentsMultiple || targetRepresentsMultiple;

      edges.push({
        id: `${txid}-${voutIdx}-${spendingTxid}-${vinIdx}`,
        source: txid,
        target: spendingTxid,
        sourceHandle: sourceHandleId,
        targetHandle: targetHandleId,
        ...(showLabel && {
          label: satsToBtc(amount) + ' BTC',
          labelStyle: { fill: '#e5e7eb', fontSize: 10 },
          labelShowBg: true,
          labelBgStyle: { fill: '#1f2937', fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
        }),
        style: {
          strokeWidth: width,
          stroke: edgeColor,
          filter: isSelected
            ? `drop-shadow(0 0 8px #facc15) drop-shadow(0 0 16px #facc15)`
            : undefined,
        },
        animated: false,
        type: 'default',
      });
    });
  }

  return edges;
}

export default function FlowCanvas() {
  const {
    transactions,
    addresses,
    groupMap,
    selectedAddresses,
    autoLayout,
    setSelectedTxid,
    updateTransaction,
    setAutoLayout,
    addTransaction,
  } = useGlobalState();

  const { setCenter, getViewport, fitView } = useReactFlow();

  // Always-current snapshot of controlled nodes, readable inside rAF callbacks
  const nodesRef = useRef<Node[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const animatingLayoutRef = useRef(false);

  // Register layout ref callbacks
  useEffect(() => {
    layoutRef.getViewportCenter = () => {
      const viewport = getViewport();
      const width = window.innerWidth - 280;
      const height = window.innerHeight;
      return {
        x: (-viewport.x + width / 2) / viewport.zoom,
        y: (-viewport.y + height / 2) / viewport.zoom,
      };
    };

    layoutRef.focusNode = (txid: string) => {
      const tx = useGlobalState.getState().transactions[txid];
      if (!tx) return;
      const { x, y } = tx.coordinates;
      const viewport = getViewport();
      setCenter(x + 90, y + 60, { zoom: viewport.zoom, duration: 600 });
    };

    layoutRef.fitView = () => {
      fitView({ padding: 0.2, duration: 600 });
    };
  }, [setCenter, getViewport, fitView]);

  const nodes = useMemo(
    () => buildNodes(transactions),
    [transactions]
  );

  const edges = useMemo(
    () => buildEdges(transactions, addresses, selectedAddresses, groupMap),
    [transactions, addresses, selectedAddresses, groupMap]
  );

  const [controlledNodes, setControlledNodes, onControlledNodesChange] = useNodesState(nodes);
  const [controlledEdges, setControlledEdges, onControlledEdgesChange] = useEdgesState(edges);

  // Keep nodesRef in sync so rAF callbacks can read current positions
  useEffect(() => {
    nodesRef.current = controlledNodes;
  }, [controlledNodes]);

  useEffect(() => {
    if (animatingLayoutRef.current) return;
    setControlledNodes(nodes);
  }, [nodes, setControlledNodes]);

  useEffect(() => {
    setControlledEdges(edges);
  }, [edges, setControlledEdges]);

  // rAF-based smooth animation for layout transitions
  useEffect(() => {
    const DURATION = 1000; // ms — spec: "more than a few seconds"
    const easeInOut = (t: number) =>
      t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    layoutRef.setNodePositions = (
      positions: Record<string, { x: number; y: number }>,
      animate: boolean
    ) => {
      // Cancel any in-progress animation
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
        animatingLayoutRef.current = false;
      }

      if (!animate) {
        animatingLayoutRef.current = false;
        setControlledNodes(prev =>
          prev.map(node => {
            const pos = positions[node.id];
            return pos ? { ...node, position: pos } : node;
          })
        );
        return;
      }

      animatingLayoutRef.current = true;

      // Snapshot start positions from the live nodes ref
      const startPositions: Record<string, { x: number; y: number }> = {};
      nodesRef.current.forEach(node => {
        startPositions[node.id] = { x: node.position.x, y: node.position.y };
      });

      const startTime = performance.now();

      const step = (now: number) => {
        const t = Math.min((now - startTime) / DURATION, 1);
        const eased = easeInOut(t);

        setControlledNodes(prev =>
          prev.map(node => {
            const dest = positions[node.id];
            if (!dest) return node;
            const start = startPositions[node.id] ?? dest;
            return {
              ...node,
              position: {
                x: start.x + (dest.x - start.x) * eased,
                y: start.y + (dest.y - start.y) * eased,
              },
            };
          })
        );

        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(step);
        } else {
          animFrameRef.current = null;
          animatingLayoutRef.current = false;
          // Snap to exact final positions
          setControlledNodes(prev =>
            prev.map(node => {
              const pos = positions[node.id];
              return pos ? { ...node, position: pos } : node;
            })
          );
        }
      };

      animFrameRef.current = requestAnimationFrame(step);
    };

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [setControlledNodes]);

  const onNodeDragStop: NodeDragHandler = useCallback(
    (_event, node) => {
      updateTransaction(node.id, {
        coordinates: { x: node.position.x, y: node.position.y },
      });
    },
    [updateTransaction]
  );

  const onNodeDragStart: NodeDragHandler = useCallback(
    () => {
      setAutoLayout(false);
    },
    [setAutoLayout]
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedTxid(node.id);
    },
    [setSelectedTxid]
  );

  const onPaneClick = useCallback(() => {
    setSelectedTxid(undefined);
  }, [setSelectedTxid]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const { selectedTxid, removeTransaction } = useGlobalState.getState();
        if (selectedTxid) {
          removeTransaction(selectedTxid);
        }
      }
      if (e.key === 'Escape') {
        useGlobalState.getState().setSelectedTxid(undefined);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <ReactFlow
      nodes={controlledNodes}
      edges={controlledEdges}
      onNodesChange={onControlledNodesChange}
      onEdgesChange={onControlledEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onNodeDragStart={onNodeDragStart}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.05}
      maxZoom={3}
      deleteKeyCode={null}
      nodesConnectable={false}
    >
      <Background color="#374151" gap={20} />
      {Object.keys(transactions).length === 0 && (
        <Panel position="top-center" style={{ top: '50%', transform: 'translate(-50%, -50%)' }}>
          <div className="text-center text-gray-500 select-none">
            <div className="text-2xl font-semibold mb-2 pointer-events-none">No transactions yet</div>
            <div className="text-sm pointer-events-none">Add transaction IDs from the side panel,<br />or look up an address to explore its history.</div>
            <div className="text-sm mt-2">
              Or{' '}
              <button
                className="underline hover:text-gray-300 transition-colors"
                onClick={() => addTransaction('f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16')}
              >
                click here
              </button>
              {' '}to add the first Bitcoin transaction from<br />Satoshi Nakamoto to Hal Finney.
            </div>
          </div>
        </Panel>
      )}
      <Controls>
        <ControlButton
          onClick={() => setAutoLayout(!autoLayout)}
          title={autoLayout ? 'Auto-layout on — click to disable' : 'Auto-layout off — click to enable'}
        >
          {autoLayout ? (
            // Two boxes in a row + right-pointing arrow below = "auto layout"
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="2" width="5" height="5" rx="0.5"/>
              <rect x="10" y="2" width="5" height="5" rx="0.5"/>
              <path d="M2 12 H10 M8 10 L12.5 12 L8 14"/>
            </svg>
          ) : (
            // Three misaligned squares = "unorganized / no auto-layout"
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
              <rect x="9.5" y="1" width="5" height="4.5" rx="0.5"/>
              <rect x="1" y="3.5" width="5" height="4.5" rx="0.5"/>
              <rect x="5.5" y="10.5" width="5" height="4.5" rx="0.5"/>
            </svg>
          )}
        </ControlButton>
      </Controls>
      <MiniMap
        nodeColor={(node) => {
          const stored = (node.data as { stored: { color?: string } }).stored;
          return stored?.color || '#4b5563';
        }}
        style={{ background: '#1f2937', border: '1px solid #374151' }}
      />
    </ReactFlow>
  );
}
