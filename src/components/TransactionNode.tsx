import React, { memo, useCallback, useMemo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { useGlobalState } from '../hooks/useGlobalState';
import {
  computeInputHandles,
  computeOutputHandles,
  isPsbtOutputSpendable,
} from '../utils/handleGrouping';
import { getEffectiveColor } from '../utils/addressDisplay';
import { satsToBtc, truncateTxid, formatFee, formatTimestamp } from '../utils/formatting';
import { inputHasRelativeLocktime, showsAbsoluteLocktime } from '../utils/sequence';
import type { StoredTransaction, HandleDescriptor, StoredAddress, AddressGroup, MempoolVin } from '../types';

interface TransactionNodeData {
  txid: string;
  stored: StoredTransaction;
  isSelected: boolean;
}

const COLOR_RED = 'rgb(255, 61, 0)';
const COLOR_GREEN = 'rgb(10, 171, 47)';
const COLOR_GRAY = '#888';

const HANDLE_DOT_STYLE: React.CSSProperties = {
  width: 10,
  height: 10,
  border: '2px solid #4b5563',
};

function outputDotColor(
  handle: HandleDescriptor,
  psbtSpendable: boolean
): string {
  if (handle.isOpReturn) return COLOR_GRAY;
  if (psbtSpendable) return COLOR_GREEN;
  return handle.txids.length > 0 ? COLOR_RED : COLOR_GRAY;
}

function isUtxoOutputHandleDescriptor(
  handle: HandleDescriptor,
  outspends: StoredTransaction['outspends']
): boolean {
  if (handle.isOpReturn || (handle.voutIndices?.length ?? 0) !== 1) return false;
  const voutIdx = handle.voutIndices![0];
  const outspend = outspends[voutIdx];
  return !(outspend?.spent && outspend.txid);
}

function HourglassIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M5 22h14" />
      <path d="M5 2h14" />
      <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
      <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
    </svg>
  );
}

function AlarmClockIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2 2" />
      <path d="M5 3 2 6" />
      <path d="m22 6-3-3" />
      <path d="M6.38 18.7 4 21" />
      <path d="M17.64 18.67 20 21" />
    </svg>
  );
}

function getAddressColor(
  addresses: string[],
  addressMap: Record<string, StoredAddress>,
  groupMap: Record<string, AddressGroup>
): string | undefined {
  const colors = addresses
    .map(a => getEffectiveColor(addressMap[a], groupMap))
    .filter(Boolean) as string[];
  if (colors.length === 0) return undefined;
  return colors[0];
}

function handleShowsTimelock(
  txVersion: number,
  vin: MempoolVin[],
  handle: HandleDescriptor
): boolean {
  if (!handle.vinIndices?.length) return false;
  return handle.vinIndices.some(i => inputHasRelativeLocktime(txVersion, vin[i]?.sequence ?? 0xffffffff));
}

function HandleLabel({
  handle,
  isInput,
  txVersion,
  vin,
  addressMap,
  groupMap,
  selectedAddresses,
  onLabelClick,
  psbtOutputSpendable,
}: {
  handle: HandleDescriptor;
  isInput: boolean;
  txVersion: number;
  vin: MempoolVin[];
  addressMap: Record<string, StoredAddress>;
  groupMap: Record<string, AddressGroup>;
  selectedAddresses: Set<string>;
  onLabelClick: (handle: HandleDescriptor) => void;
  /** When set, drives green/red/gray for PSBT outputs (matches drag-connect rules). */
  psbtOutputSpendable?: boolean;
}) {
  const isSelected = handle.addresses.some(a => selectedAddresses.has(a));
  const color = getAddressColor(handle.addresses, addressMap, groupMap);
  const handleColor = isInput
    ? COLOR_GRAY
    : handle.isOpReturn
    ? COLOR_GRAY
    : psbtOutputSpendable !== undefined
    ? psbtOutputSpendable
      ? COLOR_GREEN
      : handle.txids.length > 0
      ? COLOR_RED
      : COLOR_GRAY
    : handle.txids.length > 0
    ? COLOR_RED
    : COLOR_GREEN;

  if (handle.isCoinbase) {
    return (
      <div className={`flex flex-col text-xs leading-tight ${isInput ? 'items-start' : 'items-end'}`}>
        <span style={{ color: COLOR_GRAY }}>Coinbase</span>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col text-xs leading-tight cursor-pointer ${isInput ? 'items-start' : 'items-end'}`}
      style={{ textDecoration: isSelected ? 'underline' : 'none' }}
      onClick={(e) => {
        e.stopPropagation();
        onLabelClick(handle);
      }}
    >
      <span
        style={{ color: color || handleColor }}
        className="inline-flex items-center gap-0.5"
      >
        {isInput && handleShowsTimelock(txVersion, vin, handle) && <HourglassIcon />}
        {handle.isOpReturn ? 'OP_RETURN' : handle.label}
      </span>
      {!handle.isOpReturn && (
        <span className="text-gray-400 whitespace-nowrap">
          {satsToBtc(handle.amount)} BTC
        </span>
      )}
    </div>
  );
}

function TransactionNode({ data }: NodeProps<TransactionNodeData>) {
  const { txid, stored, isSelected } = data;
  const transactions = useGlobalState(s => s.transactions);
  const addresses = useGlobalState(s => s.addresses);
  const groupMap = useGlobalState(s => s.groupMap);
  const selectedAddresses = useGlobalState(s => s.selectedAddresses);

  const { data: tx, outspends, name, color, isPsbt } = stored;
  const isUnconfirmed = !tx.status.confirmed && !isPsbt;

  const inputHandles = useMemo(
    () => computeInputHandles(tx.vin, addresses, groupMap, new Set(Object.keys(transactions)), !!isPsbt),
    [tx.vin, addresses, groupMap, transactions, isPsbt]
  );

  const outputHandles = useMemo(
    () =>
      computeOutputHandles(
        txid,
        tx.vout,
        outspends,
        transactions,
        addresses,
        groupMap,
        new Set(Object.keys(transactions)),
        !!isPsbt
      ),
    [txid, tx.vout, outspends, addresses, groupMap, transactions, isPsbt]
  );

  const hasSelectedAddress = useMemo(() => {
    const allHandles = [...inputHandles, ...outputHandles];
    return allHandles.some(h => h.addresses.some(a => selectedAddresses.has(a)));
  }, [inputHandles, outputHandles, selectedAddresses]);

  const isMultiHandle = (handle: HandleDescriptor) =>
    (handle.vinIndices?.length ?? 1) > 1 || (handle.voutIndices?.length ?? 1) > 1;

  const handleAddressLabelClick = useCallback(
    (handle: HandleDescriptor) => {
      if (isMultiHandle(handle)) return;
      if (handle.addresses.length >= 1) {
        const addr = handle.addresses[0];
        if (!addresses[addr]) {
          useGlobalState.getState().updateAddress(addr, { isSelected: false });
        }
        useGlobalState.getState().setSelectedTxid(undefined);
        window.dispatchEvent(new CustomEvent('open-address-detail', { detail: { address: addr } }));
      }
    },
    [addresses]
  );

  const handleInputHandleClick = useCallback((handle: HandleDescriptor) => {
    if (isMultiHandle(handle)) return;
    const { addTransaction } = useGlobalState.getState();
    handle.txids.forEach(id => void addTransaction(id));
  }, []);

  const handleOutputHandleClick = useCallback((handle: HandleDescriptor) => {
    if (isMultiHandle(handle)) return;
    const { addTransaction } = useGlobalState.getState();
    handle.txids.forEach(id => void addTransaction(id));
  }, []);

  const nodeStyle: React.CSSProperties = {
    borderColor: color || (isSelected ? '#3b82f6' : '#374151'),
    borderWidth: isSelected ? 2 : 1,
    borderStyle: isPsbt ? 'dashed' : 'solid',
    animation: isUnconfirmed ? 'blink 2s ease-in-out infinite' : undefined,
    boxShadow: hasSelectedAddress ? '0 0 12px 3px rgba(234, 179, 8, 0.7)' : undefined,
  };

  return (
    <div className="relative" style={{ minWidth: 260 }}>
      {/* Main node box */}
      <div
        className="bg-gray-800 rounded-lg shadow-lg border relative"
        style={{ ...nodeStyle, padding: '8px 0', minWidth: 260 }}
      >
        {/* Title */}
        <div
          className="text-center text-xs font-semibold mb-2 truncate px-3"
          style={{ color: color || '#e5e7eb' }}
          title={txid}
        >
          {name || truncateTxid(txid)}
        </div>

        {/* Handles area — each handle sits inline with its label row */}
        <div className="flex justify-between gap-3">
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            {inputHandles.map((handle) => (
              <div
                key={handle.id}
                className={`relative flex items-center gap-1 min-w-0 ${
                  handle.isDropPlaceholder ? 'min-h-[36px]' : 'min-h-[22px]'
                }`}
              >
                {isPsbt && !handle.isCoinbase ? (
                  <>
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={handle.id}
                      isConnectable
                      isConnectableStart
                      isConnectableEnd
                      className={`psbt-connect-handle nodrag${
                        handle.isDropPlaceholder ? ' psbt-input-drop-handle' : ''
                      }`}
                      style={{ top: '50%' }}
                    />
                    <div
                      className="shrink-0 rounded-full ml-[-5px]"
                      style={{ ...HANDLE_DOT_STYLE, background: COLOR_GRAY }}
                    />
                  </>
                ) : (
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={handle.id}
                    isConnectable={false}
                    isConnectableStart={false}
                    isConnectableEnd={false}
                    className="handle-inline nodrag"
                    style={{
                      ...HANDLE_DOT_STYLE,
                      background: COLOR_GRAY,
                      cursor: handle.isCoinbase ? 'default' : undefined,
                    }}
                    onClick={handle.isCoinbase ? undefined : (e) => {
                      e.stopPropagation();
                      handleInputHandleClick(handle);
                    }}
                  />
                )}
                {!handle.isDropPlaceholder && (
                  <HandleLabel
                    handle={handle}
                    isInput={true}
                    txVersion={tx.version}
                    vin={tx.vin}
                    addressMap={addresses}
                    groupMap={groupMap}
                    selectedAddresses={selectedAddresses}
                    onLabelClick={handleAddressLabelClick}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1 flex-1 min-w-0">
            {outputHandles.map((handle) => {
              const isPsbtPaymentOutput = isPsbt && !handle.isOpReturn;
              const psbtSpendable =
                isPsbtPaymentOutput &&
                isPsbtOutputSpendable(
                  txid,
                  handle.id,
                  stored,
                  transactions,
                  addresses,
                  groupMap
                );
              const isUtxo =
                !isPsbt &&
                isUtxoOutputHandleDescriptor(handle, outspends);
              // A spendable output can fund a PSBT input: any spendable PSBT output, or an
              // unspent transaction UTXO. Rendered as a drag source that can also receive a
              // drag started from a PSBT input (connectable start AND end).
              const spendableSource = isPsbtPaymentOutput ? !!psbtSpendable : isUtxo;
              // Spent by a real transaction (not a PSBT): click adds the spending transaction.
              const isSpentByTx =
                !isPsbt &&
                !handle.isOpReturn &&
                (handle.voutIndices?.length ?? 0) === 1 &&
                handle.txids.length > 0;
              const dotColor = outputDotColor(handle, !!psbtSpendable);

              return (
                <div
                  key={handle.id}
                  className="relative flex items-center gap-1 justify-end min-w-0 min-h-[22px]"
                >
                  {!handle.isDropPlaceholder && (
                    <HandleLabel
                      handle={handle}
                      isInput={false}
                      txVersion={tx.version}
                      vin={tx.vin}
                      addressMap={addresses}
                      groupMap={groupMap}
                      selectedAddresses={selectedAddresses}
                      onLabelClick={handleAddressLabelClick}
                      psbtOutputSpendable={
                        isPsbtPaymentOutput ? psbtSpendable : undefined
                      }
                    />
                  )}
                  {spendableSource ? (
                    <>
                      <Handle
                        type="source"
                        position={Position.Right}
                        id={handle.id}
                        isConnectable
                        isConnectableStart
                        isConnectableEnd
                        className="psbt-connect-handle nodrag"
                        style={{ top: '50%' }}
                      />
                      <div
                        className="shrink-0 rounded-full mr-[-5px]"
                        style={{ ...HANDLE_DOT_STYLE, background: dotColor }}
                      />
                    </>
                  ) : isSpentByTx ? (
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={handle.id}
                      isConnectable={false}
                      isConnectableStart={false}
                      isConnectableEnd={false}
                      className="handle-inline nodrag"
                      style={{ ...HANDLE_DOT_STYLE, background: dotColor }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOutputHandleClick(handle);
                      }}
                    />
                  ) : (
                    <div
                      className="shrink-0 rounded-full mr-[-5px]"
                      style={{ ...HANDLE_DOT_STYLE, background: dotColor }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Fee */}
        <div
          className={`flex items-center justify-center gap-0.5 text-xs mt-2 border-t border-gray-700 pt-1 px-3 ${
            tx.fee < 0 ? 'text-red-400' : 'text-gray-400'
          }`}
        >
          {showsAbsoluteLocktime(tx.locktime, tx.vin) && <AlarmClockIcon />}
          <span>Fee: {formatFee(tx.fee, tx.weight)}</span>
        </div>
      </div>

      {/* Below node: block info */}
      <div className="text-center text-xs mt-1" style={{ color: '#9ca3af' }}>
        {isPsbt ? (
          <span>PSBT</span>
        ) : isUnconfirmed ? (
          <span style={{ animation: 'blink 2s ease-in-out infinite' }}>
            Unconfirmed
          </span>
        ) : (
          <>
            <div>Block {tx.status.block_height}</div>
            {tx.status.block_time && (
              <div>{formatTimestamp(tx.status.block_time)}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default memo(TransactionNode, (prev, next) => {
  const p = prev.data as TransactionNodeData;
  const n = next.data as TransactionNodeData;
  return p.txid === n.txid && p.stored === n.stored && p.isSelected === n.isSelected;
});
