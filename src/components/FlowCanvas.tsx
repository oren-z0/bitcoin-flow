import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  ControlButton,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeDragHandler,
  useStoreApi,
} from 'reactflow';
import {
  connectionFromConnectEndHandles,
  explainFlowConnectionValidity,
  isCompleteFlowConnection,
  logConnectRejected,
} from '../utils/psbtConnect';
import 'reactflow/dist/style.css';
import { SIDE_PANEL_WIDTH } from '../constants/layout';
import { CreatePsbtIcon, TrashIcon } from './SidePanel/icons';
import { useGlobalState, layoutRef } from '../hooks/useGlobalState';
import TransactionNode from './TransactionNode';
import { computeEdgeWidth } from '../utils/edgeStyling';
import {
  computeInputHandles,
  computeOutputHandles,
  isPsbtInputHandleId,
  pinnedUtxoVoutSet,
  resolvePsbtInputSourceTxids,
} from '../utils/handleGrouping';
import { collectGraphConnections } from '../utils/graphConnections';
import { getEffectiveColor } from '../utils/addressDisplay';
import { satsToBtc } from '../utils/formatting';
import {
  mergeFlowNodeDataDuringAnimation,
  reconcileFlowNodes,
} from '../utils/reconcileFlowNodes';
import { prefersCoarsePointer } from '../utils/coarsePointer';
import { loadLightningChannelExample } from '../utils/graphExamples';
import type { StoredTransaction, AddressGroup } from '../types';

const nodeTypes: NodeTypes = {
  transaction: TransactionNode,
};

const canvasPanelButtonClass =
  'w-full grid grid-cols-[1rem_1fr_1rem] items-center gap-x-2 text-[1rem] px-3 py-2 rounded shadow cursor-pointer border';

type EmptyPageExample =
  | { label: string; txid: string }
  | { label: string; txids: string[] }
  | { label: string; load: () => void | Promise<void> };

function emptyPageExampleKey(example: EmptyPageExample): string {
  if ('txids' in example) return example.txids.join('-');
  if ('txid' in example) return example.txid;
  return example.label;
}

async function runEmptyPageExample(example: EmptyPageExample): Promise<void> {
  await useGlobalState.getState().setAutoLayout(true);

  if ('txids' in example) {
    await useGlobalState.getState().addTransactions(example.txids);
    return;
  }
  if ('txid' in example) {
    await useGlobalState.getState().addTransaction(example.txid);
    return;
  }
  await example.load();
}

/**
 * Max press-to-release duration (ms) for a PSBT input handle interaction to count as a
 * click (find the source transaction) rather than a connection drag.
 */
const PSBT_INPUT_CLICK_MS = 500;

function buildNodes(
  transactions: Record<string, StoredTransaction>,
  selectedTxid: string | undefined
): Node[] {
  return Object.entries(transactions).map(([txid, stored]) => ({
    id: txid,
    type: 'transaction',
    position: stored.coordinates,
    data: { txid, stored, isSelected: selectedTxid === txid },
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
  const loadedTxids = new Set(Object.keys(transactions));
  const connections = collectGraphConnections(transactions);
  const allAmounts = connections.map(c => c.amount);
  const edgeIds = new Set<string>();

  for (const conn of connections) {
    const edgeId = `${conn.parentTxid}-${conn.voutIdx}-${conn.spendingTxid}-${conn.vinIdx}`;
    if (edgeIds.has(edgeId)) continue;
    edgeIds.add(edgeId);

    const parent = transactions[conn.parentTxid];
    const spendingTx = transactions[conn.spendingTxid];
    const outHandles = computeOutputHandles(
      conn.parentTxid,
      parent.data.vout,
      parent.outspends,
      transactions,
      addresses,
      groupMap,
      loadedTxids,
      !!parent.isPsbt,
      pinnedUtxoVoutSet(parent)
    );
    const inHandles = computeInputHandles(
      spendingTx.data.vin,
      addresses,
      groupMap,
      loadedTxids,
      !!spendingTx.isPsbt
    );

    const voutAddress = parent.data.vout[conn.voutIdx]?.scriptpubkey_address;
    const edgeColor = voutAddress
      ? (getEffectiveColor(addresses[voutAddress], groupMap) ?? '#6b7280')
      : '#6b7280';
    const isSelected = voutAddress ? selectedAddresses.has(voutAddress) : false;
    const width = computeEdgeWidth(conn.amount, allAmounts);

    const sourceHandle = outHandles.find(h => h.voutIndices?.includes(conn.voutIdx));
    const sourceHandleId = sourceHandle?.id ?? `out-${conn.voutIdx}`;
    const sourceRepresentsMultiple = (sourceHandle?.voutIndices?.length ?? 1) > 1;

    const targetHandle = inHandles.find(h => h.vinIndices?.includes(conn.vinIdx));
    const targetHandleId = targetHandle?.id ?? `in-${conn.vinIdx}`;
    const targetRepresentsMultiple = (targetHandle?.vinIndices?.length ?? 1) > 1;

    const showLabel = sourceRepresentsMultiple || targetRepresentsMultiple;

    edges.push({
      id: edgeId,
      source: conn.parentTxid,
      target: conn.spendingTxid,
      sourceHandle: sourceHandleId,
      targetHandle: targetHandleId,
      ...(showLabel && {
        label: satsToBtc(conn.amount) + ' BTC',
        labelStyle: { fill: '#e5e7eb', fontSize: 10 },
        labelShowBg: true,
        labelBgStyle: { fill: '#1f2937', fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
      }),
      style: {
        strokeWidth: width,
        stroke: edgeColor,
        ...(spendingTx.isPsbt && { strokeDasharray: '6 4' }),
        filter: isSelected
          ? `drop-shadow(0 0 8px #facc15) drop-shadow(0 0 16px #facc15)`
          : undefined,
      },
      animated: false,
      type: 'default',
    });
  }

  return edges;
}

export default function FlowCanvas() {
  const transactions = useGlobalState(s => s.transactions);
  const selectedTxid = useGlobalState(s => s.selectedTxid);
  const addresses = useGlobalState(s => s.addresses);
  const groupMap = useGlobalState(s => s.groupMap);
  const selectedAddresses = useGlobalState(s => s.selectedAddresses);
  const autoLayout = useGlobalState(s => s.autoLayout);
  const [showMiniMap] = useState(() => !prefersCoarsePointer());

  const { setCenter, getViewport, fitView } = useReactFlow();
  const storeApi = useStoreApi();
  const connectAppliedRef = useRef(false);
  const lastConnectErrorRef = useRef<{ message: string; at: number } | null>(null);
  /** Last hover during drag with a full source/target pair (for accurate reject logs on release). */
  const lastConnectCheckRef = useRef<{
    connection: Connection;
    reason: string | null;
  } | null>(null);
  /** Press start (handle + time) for distinguishing a quick click from a connection drag. */
  const connectStartRef = useRef<{
    nodeId: string | null;
    handleId: string | null;
    handleType: string | null;
    time: number;
  } | null>(null);

  // Always-current snapshot of controlled nodes, readable inside rAF callbacks
  const nodesRef = useRef<Node[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const animatingLayoutRef = useRef(false);

  // Register layout ref callbacks
  useEffect(() => {
    layoutRef.getViewportCenter = () => {
      const viewport = getViewport();
      const width = window.innerWidth - SIDE_PANEL_WIDTH;
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
    () => buildNodes(transactions, selectedTxid),
    [transactions, selectedTxid]
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
    setControlledNodes(prev =>
      animatingLayoutRef.current
        ? mergeFlowNodeDataDuringAnimation(prev, nodes)
        : reconcileFlowNodes(prev, nodes)
    );
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

  const onNodeDragStop: NodeDragHandler = useCallback((_event, node) => {
    useGlobalState.getState().updateTransaction(node.id, {
      coordinates: { x: node.position.x, y: node.position.y },
    });
  }, []);

  const onNodeDragStart: NodeDragHandler = useCallback(() => {
    void useGlobalState.getState().setAutoLayout(false);
  }, []);

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    useGlobalState.getState().setSelectedTxid(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    useGlobalState.getState().setSelectedTxid(undefined);
  }, []);

  const isValidConnection = useCallback((connection: Connection) => {
    const { transactions, addresses, groupMap } = useGlobalState.getState();
    const reason = explainFlowConnectionValidity(
      connection,
      transactions,
      addresses,
      groupMap
    );
    if (isCompleteFlowConnection(connection)) {
      lastConnectCheckRef.current = { connection, reason };
    }
    return reason === null;
  }, []);

  const onConnectStart = useCallback(
    (
      _event: React.MouseEvent | React.TouchEvent,
      params: { nodeId: string | null; handleId: string | null; handleType: string | null }
    ) => {
      connectAppliedRef.current = false;
      lastConnectCheckRef.current = null;
      connectStartRef.current = {
        nodeId: params.nodeId,
        handleId: params.handleId,
        handleType: params.handleType,
        time: performance.now(),
      };
    },
    []
  );

  /**
   * Quick press-release on a PSBT input handle (no connection made): try to load the
   * input's source transaction(s) onto the canvas. addTransaction surfaces a toast if
   * the prevout cannot be fetched.
   */
  const findPsbtInputSource = useCallback((nodeId: string, handleId: string) => {
    const { transactions, addresses, groupMap, addTransaction } = useGlobalState.getState();
    const stored = transactions[nodeId];
    if (!stored) return;
    const txids = resolvePsbtInputSourceTxids(
      handleId,
      stored,
      transactions,
      addresses,
      groupMap
    );
    txids.forEach(id => void addTransaction(id));
  }, []);

  const onConnectEnd = useCallback(() => {
    const start = connectStartRef.current;
    connectStartRef.current = null;

    if (connectAppliedRef.current) {
      lastConnectCheckRef.current = null;
      return;
    }

    // No connection was made: a quick press-release on a PSBT input handle is a click
    // (find the source transaction) rather than an aborted drag.
    if (
      start &&
      start.nodeId &&
      start.handleId &&
      start.handleType === 'target' &&
      isPsbtInputHandleId(start.handleId) &&
      performance.now() - start.time < PSBT_INPUT_CLICK_MS
    ) {
      findPsbtInputSource(start.nodeId, start.handleId);
      lastConnectCheckRef.current = null;
      return;
    }

    const { connectionStartHandle, connectionEndHandle } = storeApi.getState();
    let connection: Connection | null = null;

    if (connectionStartHandle?.nodeId) {
      connection = connectionFromConnectEndHandles(
        connectionStartHandle,
        connectionEndHandle
      );
    }

    if (!connection || !isCompleteFlowConnection(connection)) {
      connection = lastConnectCheckRef.current?.connection ?? connection;
    }

    if (!connection || !connection.source) return;

    const { transactions, addresses, groupMap, addError } = useGlobalState.getState();
    const reason = explainFlowConnectionValidity(
      connection,
      transactions,
      addresses,
      groupMap
    );

    if (reason) {
      logConnectRejected(reason);
      // A complete connection that still has a rejection reason (e.g. would create a
      // cycle) is blocked during the drag, so onConnect never fires to surface it.
      // Show it to the user instead of only logging to the console.
      if (isCompleteFlowConnection(connection)) {
        const now = Date.now();
        const last = lastConnectErrorRef.current;
        if (!last || last.message !== reason || now - last.at > 2000) {
          lastConnectErrorRef.current = { message: reason, at: now };
          addError(reason);
        }
      }
    } else if (lastConnectCheckRef.current?.reason) {
      logConnectRejected(lastConnectCheckRef.current.reason);
    } else {
      logConnectRejected(
        'Release over the PSBT input on the left (gray dot). The line was valid while hovering but the drop did not land on the handle.'
      );
    }
    lastConnectCheckRef.current = null;
  }, [storeApi, findPsbtInputSource]);

  const onConnect = useCallback(
    (connection: Connection) => {
      connectAppliedRef.current = true;
      const { source, target, sourceHandle, targetHandle } = connection;
      if (!source || !target || !sourceHandle || !targetHandle) {
        logConnectRejected(
          'onConnect: incomplete connection (missing source, target, or handle ids)'
        );
        return;
      }
      // Single connection type: a spendable output (source) funds a PSBT input (target).
      // React Flow normalizes the direction, so source is always the output handle.
      useGlobalState
        .getState()
        .connectPsbtInputFromOutput(source, sourceHandle, target, targetHandle);
    },
    []
  );

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
      onConnectStart={onConnectStart}
      onConnectEnd={onConnectEnd}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.05}
      maxZoom={3}
      deleteKeyCode={null}
      nodesConnectable
      connectionRadius={50}
    >
      <Background color="#374151" gap={20} />
      <Panel position="top-right" className="!m-12">
        <div className="flex flex-col gap-4 w-max min-w-[12rem]">
          <button
            type="button"
            className={`${canvasPanelButtonClass} border-gray-600 bg-gray-800 hover:bg-gray-700 text-gray-200`}
            onClick={() => void useGlobalState.getState().createPsbt()}
          >
            <CreatePsbtIcon />
            <span className="col-start-2 text-center">Create a new PSBT</span>
            <span className="col-start-3" aria-hidden />
          </button>
          <button
            type="button"
            className={`${canvasPanelButtonClass} border-red-800 bg-red-900 hover:bg-red-800 text-white`}
            onClick={() => {
              if (confirm('Are you sure you want to clear all state? This cannot be undone.')) {
                useGlobalState.getState().clearState();
              }
            }}
          >
            <TrashIcon />
            <span className="col-start-2 text-center">Clear State</span>
            <span className="col-start-3" aria-hidden />
          </button>
        </div>
      </Panel>
      {Object.keys(transactions).length === 0 && (
        <Panel position="top-center" style={{ top: '50%', transform: 'translate(-50%, -50%)' }}>
          <div className="text-center text-gray-500 select-none">
            <div className="text-2xl font-semibold mb-2 pointer-events-none">No transactions yet</div>
            <div className="text-sm pointer-events-none">Add transaction IDs from the side panel,<br />or look up an address to explore its history.</div>
            <div className="text-sm mt-4 pointer-events-none font-medium">Examples:</div>
            <div className="text-sm mt-1 flex flex-col gap-1">
              {([
                { label: 'Satoshi → Hal Finney', txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16' },
                { label: 'Coinbase', txid: '8cc015e338bb71b748dd931a9ab8a244f8202eb1560dc205d610059a3ef75898' },
                { label: 'Coinjoin', txid: '353734ec9ed658b2282df9ec2cb1e5b2d56d8d4ddde12963893fb8384956dbf2' },
                { label: 'Consolidation', txid: 'ca11d6ef802f4b3d9730cbff112655ad635500ccd657c3406184b26f74e53e15' },
                { label: 'Lightning channel open & forced close', load: loadLightningChannelExample },
                { label: 'PayJoin', txid: '7104bae698587b3e75563b7ea7a9aada41d9c787788bc2bf26dd201fd7eca8a2' },
                { label: 'Timelock Recovery', txids: ['8b1a59ba445220d70bb3a5bdc9dd44515f885509e9631fe409a024c483ed73b0', '526c3e7916d3d455ddd85ca520f31fca675ed7b97e4ed6e71e7090fe765b74a0'] },
                { label: 'Absolute Locktime', txid: '648fe76b22bc1768b56facab73af046ea40fa190f2e882a7cc99a5b6fccf05de' },
                { label: 'OP_RETURN', txid: '6dfb16dd580698242bcfd8e433d557ed8c642272a368894de27292a8844a4e75' },
              ] satisfies EmptyPageExample[]).map((example) => (
                <button
                  key={emptyPageExampleKey(example)}
                  className="underline hover:text-gray-300 transition-colors cursor-pointer"
                  onClick={() => void runEmptyPageExample(example)}
                >
                  {example.label}
                </button>
              ))}
            </div>
          </div>
        </Panel>
      )}
      <Controls>
        <ControlButton
          onClick={() => void useGlobalState.getState().setAutoLayout(!autoLayout)}
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
      {showMiniMap && (
        <MiniMap
          nodeColor={(node) => {
            const stored = (node.data as { stored: { color?: string } }).stored;
            return stored?.color || '#4b5563';
          }}
          style={{ background: '#1f2937', border: '1px solid #374151' }}
        />
      )}
    </ReactFlow>
  );
}
