import type { Connection } from 'reactflow';
import type { StoredAddress, AddressGroup, StoredTransaction } from '../types';
import { connectWouldCreateCycle } from './graphConnections';
import {
  isOutputHandleId,
  isPsbtInputHandleId,
  isPsbtOutputDropTargetHandleId,
  isPsbtOutputSpendable,
  isUtxoOutputHandle,
  resolveOutputVoutIndexFromHandle,
} from './handleGrouping';
import { voutScriptpubkeyHex } from './psbt';

const LOG = '[bitcoin-flow connect]';

export function logConnectRejected(reason: string): void {
  console.info(`${LOG} ${reason}`);
}

/** Why React Flow rejected a connection during drag (null = valid). */
export function explainFlowConnectionValidity(
  connection: Connection,
  transactions: Record<string, StoredTransaction>,
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup>
): string | null {
  const { source, target, sourceHandle, targetHandle } = connection;

  if (!source || !target || !sourceHandle || !targetHandle) {
    return 'Connection incomplete — release the line on a PSBT input (left, gray) or output drop target.';
  }

  if (!isOutputHandleId(sourceHandle)) {
    if (isPsbtOutputDropTargetHandleId(sourceHandle)) {
      return `Drag must start from the green output dot (handle "${sourceHandle}" is an output drop zone, not a source).`;
    }
    return `Drag must start from an output handle on the right (got "${sourceHandle}").`;
  }

  const isInputTarget = isPsbtInputHandleId(targetHandle);
  const isOutputDropTarget = isPsbtOutputDropTargetHandleId(targetHandle);

  if (!isInputTarget && !isOutputDropTarget) {
    return `Drop must end on a PSBT input handle on the left (in-…) or an output drop target (out-…-in), not "${targetHandle}".`;
  }

  const sourceTx = transactions[source];
  const targetTx = transactions[target];

  if (!sourceTx) {
    return `Source transaction "${source}" is not on the graph.`;
  }

  if (!targetTx?.isPsbt) {
    return `Target "${target}" is not a PSBT — only PSBT nodes accept this connection.`;
  }

  if (isOutputDropTarget) {
    return explainOutputDropConnection(source, sourceHandle, sourceTx, transactions, addresses, groupMap);
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

function explainOutputDropConnection(
  sourceNodeId: string,
  sourceHandleId: string,
  sourceTx: StoredTransaction,
  transactions: Record<string, StoredTransaction>,
  addresses: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup>
): string | null {
  const reason = explainSpendableSource(
    sourceNodeId,
    sourceHandleId,
    sourceTx,
    transactions,
    addresses,
    groupMap
  );
  if (reason) return `Output drop: ${reason}`;
  return null;
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
    return 'Cannot connect a PSBT to itself — drag to a different PSBT’s input on the left.';
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
      return `PSBT output ${voutIdx} on "${sourceNodeId}" is already spent on the graph (red/orange handle) or not spendable.`;
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
    return `Output ${voutIdx} on "${sourceNodeId}" is not an unspent UTXO (mempool spent).`;
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
