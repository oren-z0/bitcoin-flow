import type { Connection } from 'reactflow';
import type { StoredAddress, AddressGroup, StoredTransaction } from '../types';
import { connectWouldCreateCycle } from './graphConnections';
import {
  isOutputHandleId,
  isPsbtInputHandleId,
  isPsbtOutputSpendable,
  isUtxoOutputHandle,
  resolveOutputVoutIndexFromHandle,
} from './handleGrouping';
import { voutScriptpubkeyHex } from './psbt';

const LOG = '[bitcoin-flow connect]';

export function logConnectRejected(reason: string): void {
  console.info(`${LOG} ${reason}`);
}

type ConnectEndHandle = {
  nodeId: string;
  handleId?: string | null;
  type: 'source' | 'target';
};

/**
 * Build a partial Connection from the React Flow store after a drag ends without onConnect.
 * The drag may start from either end (an output or a PSBT input), so we normalize to the
 * canonical shape: source = the output handle, target = the PSBT input handle.
 */
export function connectionFromConnectEndHandles(
  start: ConnectEndHandle,
  end: ConnectEndHandle | null
): Connection {
  const startHandle = start.handleId ?? null;
  const endHandle = end?.handleId ?? null;
  if (start.type === 'source') {
    return {
      source: start.nodeId,
      sourceHandle: startHandle,
      target: end?.nodeId ?? null,
      targetHandle: endHandle,
    };
  }
  return {
    source: end?.nodeId ?? null,
    sourceHandle: endHandle,
    target: start.nodeId,
    targetHandle: startHandle,
  };
}

export function isCompleteFlowConnection(connection: Connection): boolean {
  return !!(
    connection.source &&
    connection.target &&
    connection.sourceHandle &&
    connection.targetHandle
  );
}

function explainIncompleteFlowConnection(connection: Connection): string {
  const { source, target, sourceHandle, targetHandle } = connection;
  if (!source || !sourceHandle) {
    return 'Connection incomplete — one end must be a spendable output (right side: an unspent transaction output or any PSBT output).';
  }
  if (!target || !targetHandle) {
    return 'Connection incomplete — the other end must be a PSBT input on the left (gray dot; empty PSBTs use the hidden in-drop target). Do not release on the canvas.';
  }
  return 'Connection incomplete — missing source or target handle.';
}

/**
 * Why React Flow rejected a connection during drag (null = valid).
 *
 * There is a single connection type: a spendable output (source) funds a PSBT input (target).
 * React Flow normalizes the connection so the output is always `source` and the PSBT input is
 * always `target`, regardless of which end the user started dragging from.
 */
export function explainFlowConnectionValidity(
  connection: Connection,
  transactions: Record<string, StoredTransaction>,
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup>
): string | null {
  const { source, target, sourceHandle, targetHandle } = connection;

  if (!source || !target || !sourceHandle || !targetHandle) {
    return explainIncompleteFlowConnection(connection);
  }

  if (!isOutputHandleId(sourceHandle)) {
    return `One end must be an output on the right (got "${sourceHandle}").`;
  }

  if (!isPsbtInputHandleId(targetHandle)) {
    return `The other end must be a PSBT input on the left (got "${targetHandle}").`;
  }

  const sourceTx = transactions[source];
  const targetTx = transactions[target];

  if (!sourceTx) {
    return `Source transaction "${source}" is not on the graph.`;
  }

  if (!targetTx?.isPsbt) {
    return `Target "${target}" is not a PSBT — only PSBT inputs can spend an output.`;
  }

  return explainInputFromOutputConnection(
    source,
    target,
    sourceHandle,
    targetHandle,
    sourceTx,
    targetTx,
    transactions,
    addresses,
    groupMap
  );
}

function explainInputFromOutputConnection(
  sourceNodeId: string,
  targetNodeId: string,
  sourceHandleId: string,
  _targetHandleId: string,
  sourceTx: StoredTransaction,
  targetTx: StoredTransaction,
  transactions: Record<string, StoredTransaction>,
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup>
): string | null {
  const spendReason = explainSpendableSource(
    sourceNodeId,
    sourceHandleId,
    sourceTx,
    transactions,
    addresses,
    groupMap
  );
  if (spendReason) return spendReason;

  if (sourceNodeId === targetNodeId) {
    return 'Cannot connect a PSBT to itself — drag to a different node.';
  }

  if (connectWouldCreateCycle(transactions, sourceNodeId, targetNodeId)) {
    return (
      `Would create a cycle: "${targetNodeId}" already reaches "${sourceNodeId}" through existing outputs on the graph.`
    );
  }

  const voutIdx = resolveOutputVoutIndexFromHandle(
    sourceNodeId,
    sourceHandleId,
    sourceTx,
    transactions,
    addresses,
    groupMap
  );
  if (voutIdx === null) {
    return 'Source handle is grouped — drag from a single output, not a collapsed handle.';
  }

  if (!targetTx.psbtBase64) {
    return 'Target PSBT has no PSBT data.';
  }

  return null;
}

function explainSpendableSource(
  sourceNodeId: string,
  sourceHandleId: string,
  sourceTx: StoredTransaction,
  transactions: Record<string, StoredTransaction>,
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup>
): string | null {
  const voutIdx = resolveOutputVoutIndexFromHandle(
    sourceNodeId,
    sourceHandleId,
    sourceTx,
    transactions,
    addresses,
    groupMap
  );
  if (voutIdx === null) {
    return 'Source handle is grouped — drag from a single output, not a collapsed handle.';
  }

  const vout = sourceTx.data.vout[voutIdx];
  if (!vout) {
    return `Output index ${voutIdx} does not exist on "${sourceNodeId}".`;
  }

  if (vout.scriptpubkey_type === 'op_return') {
    return 'OP_RETURN outputs cannot be spent.';
  }

  if (!voutScriptpubkeyHex(vout)) {
    return `Output ${voutIdx} on "${sourceNodeId}" has no script or encodable address.`;
  }

  if (sourceTx.isPsbt) {
    if (
      !isPsbtOutputSpendable(
        sourceNodeId,
        sourceHandleId,
        sourceTx,
        transactions,
        addresses,
        groupMap
      )
    ) {
      return `PSBT output ${voutIdx} on "${sourceNodeId}" is not spendable.`;
    }
    return null;
  }

  if (
    !isUtxoOutputHandle(
      sourceNodeId,
      sourceHandleId,
      sourceTx,
      transactions,
      addresses,
      groupMap
    )
  ) {
    return `Output ${voutIdx} on "${sourceNodeId}" is already spent — only unspent transaction outputs can fund a PSBT input.`;
  }

  return null;
}

/** Why connectPsbtInputFromOutput would not apply the connection (null = proceed). */
export function explainConnectPsbtInputFromOutput(
  sourceNodeId: string,
  sourceHandleId: string,
  targetPsbtNodeId: string,
  targetHandleId: string,
  transactions: Record<string, StoredTransaction>,
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup>
): string | null {
  const target = transactions[targetPsbtNodeId];
  if (!target?.isPsbt || !target.psbtBase64) {
    return 'Target is not a PSBT with data.';
  }

  const source = transactions[sourceNodeId];
  if (!source) {
    return `Source "${sourceNodeId}" is not on the graph.`;
  }

  if (!isOutputHandleId(sourceHandleId) || !isPsbtInputHandleId(targetHandleId)) {
    return `Invalid handles (source "${sourceHandleId}", target "${targetHandleId}"). Use output → PSBT input (left).`;
  }

  return explainInputFromOutputConnection(
    sourceNodeId,
    targetPsbtNodeId,
    sourceHandleId,
    targetHandleId,
    source,
    target,
    transactions,
    addresses,
    groupMap
  );
}
