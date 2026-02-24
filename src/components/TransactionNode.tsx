import React, { useCallback, useMemo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { useGlobalState } from '../hooks/useGlobalState';
import { computeInputHandles, computeOutputHandles } from '../utils/handleGrouping';
import { getEffectiveColor } from '../utils/addressDisplay';
import { satsToBtc, truncateTxid, formatFeeRate, formatTimestamp } from '../utils/formatting';
import type { StoredTransaction, HandleDescriptor, StoredAddress, AddressGroup } from '../types';

interface TransactionNodeData {
  txid: string;
  stored: StoredTransaction;
}

const COLOR_RED = 'rgb(255, 61, 0)';
const COLOR_GREEN = 'rgb(10, 171, 47)';
const COLOR_GRAY = '#888';

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

function HandleLabel({
  handle,
  isInput,
  addressMap,
  groupMap,
  selectedAddresses,
  onLabelClick,
}: {
  handle: HandleDescriptor;
  isInput: boolean;
  addressMap: Record<string, StoredAddress>;
  groupMap: Record<string, AddressGroup>;
  selectedAddresses: Set<string>;
  onLabelClick: (handle: HandleDescriptor) => void;
}) {
  const isSelected = handle.addresses.some(a => selectedAddresses.has(a));
  const color = getAddressColor(handle.addresses, addressMap, groupMap);
  const handleColor = isInput
    ? COLOR_GRAY
    : handle.isOpReturn
    ? COLOR_GRAY
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
      <span style={{ color: color || handleColor }}>
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

export default function TransactionNode({ data }: NodeProps<TransactionNodeData>) {
  const { txid, stored } = data;
  const {
    addresses,
    groupMap,
    selectedAddresses,
    selectedTxid,
    addTransaction,
    updateAddress,
    setSelectedTxid,
  } = useGlobalState();

  const { data: tx, outspends, name, color } = stored;
  const isSelected = selectedTxid === txid;
  const isUnconfirmed = !tx.status.confirmed;

  const inputHandles = useMemo(
    () => computeInputHandles(tx.vin, addresses, groupMap),
    [tx.vin, addresses, groupMap]
  );

  const outputHandles = useMemo(
    () => computeOutputHandles(tx.vout, outspends, addresses, groupMap),
    [tx.vout, outspends, addresses, groupMap]
  );

  const feeRate = formatFeeRate(tx.fee, tx.weight);

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
          updateAddress(addr, { isSelected: false });
        }
        setSelectedTxid(undefined);
        window.dispatchEvent(new CustomEvent('open-address-detail', { detail: { address: addr } }));
      }
    },
    [addresses, updateAddress, setSelectedTxid]
  );

  const handleInputHandleClick = useCallback(
    (handle: HandleDescriptor) => {
      if (isMultiHandle(handle)) return;
      handle.txids.forEach(id => addTransaction(id));
    },
    [addTransaction]
  );

  const handleOutputHandleClick = useCallback(
    (handle: HandleDescriptor) => {
      if (isMultiHandle(handle)) return;
      handle.txids.forEach(id => addTransaction(id));
    },
    [addTransaction]
  );

  const nodeStyle: React.CSSProperties = {
    borderColor: color || (isSelected ? '#3b82f6' : '#374151'),
    borderWidth: isSelected ? 2 : 1,
    animation: isUnconfirmed ? 'blink 2s ease-in-out infinite' : undefined,
    boxShadow: hasSelectedAddress ? '0 0 12px 3px rgba(234, 179, 8, 0.7)' : undefined,
  };

  return (
    <div className="relative" style={{ minWidth: 260 }}>
      {/* Main node box */}
      <div
        className="bg-gray-800 rounded-lg shadow-lg border relative"
        style={{ ...nodeStyle, padding: '8px 16px', minWidth: 260 }}
      >
        {/* Title */}
        <div
          className="text-center text-xs font-semibold mb-2 truncate"
          style={{ color: color || '#e5e7eb' }}
          title={txid}
        >
          {name || truncateTxid(txid)}
        </div>

        {/* Handles area */}
        <div
          className="flex justify-between items-stretch gap-2"
          style={{ minHeight: Math.max(inputHandles.length, outputHandles.length) * 30 }}
        >
          {/* Input labels */}
          <div className="flex flex-col justify-around gap-1" style={{ flex: 1, minWidth: 0 }}>
            {inputHandles.map((handle) => (
              <HandleLabel
                key={handle.id}
                handle={handle}
                isInput={true}
                addressMap={addresses}
                groupMap={groupMap}
                selectedAddresses={selectedAddresses}
                onLabelClick={handleAddressLabelClick}
              />
            ))}
          </div>

          {/* Output labels */}
          <div className="flex flex-col justify-around gap-1" style={{ flex: 1, minWidth: 0 }}>
            {outputHandles.map((handle) => (
              <HandleLabel
                key={handle.id}
                handle={handle}
                isInput={false}
                addressMap={addresses}
                groupMap={groupMap}
                selectedAddresses={selectedAddresses}
                onLabelClick={handleAddressLabelClick}
              />
            ))}
          </div>
        </div>

        {/* Fee */}
        <div className="text-center text-xs text-gray-400 mt-2 border-t border-gray-700 pt-1">
          Fee: {feeRate} sat/vB
        </div>

        {/* Input Handles (React Flow) */}
        {inputHandles.map((handle, i) => {
          const topPercent = inputHandles.length === 1
            ? 50
            : ((i + 1) / (inputHandles.length + 1)) * 100;
          return (
            <Handle
              key={handle.id}
              type="target"
              position={Position.Left}
              id={handle.id}
              isConnectable={!handle.isCoinbase}
              style={{
                top: `${topPercent}%`,
                background: COLOR_GRAY,
                width: 10,
                height: 10,
                border: '2px solid #4b5563',
                cursor: handle.isCoinbase ? 'default' : undefined,
              }}
              onClick={handle.isCoinbase ? undefined : (e) => {
                e.stopPropagation();
                handleInputHandleClick(handle);
              }}
            />
          );
        })}

        {/* Output Handles (React Flow) */}
        {outputHandles.map((handle, i) => {
          const topPercent = outputHandles.length === 1
            ? 50
            : ((i + 1) / (outputHandles.length + 1)) * 100;
          const handleColor = handle.isOpReturn
            ? COLOR_GRAY
            : handle.txids.length > 0
            ? COLOR_RED
            : COLOR_GREEN;
          return (
            <Handle
              key={handle.id}
              type="source"
              position={Position.Right}
              id={handle.id}
              style={{
                top: `${topPercent}%`,
                background: handleColor,
                width: 10,
                height: 10,
                border: '2px solid #4b5563',
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleOutputHandleClick(handle);
              }}
            />
          );
        })}
      </div>

      {/* Below node: block info */}
      <div className="text-center text-xs mt-1" style={{ color: '#9ca3af' }}>
        {isUnconfirmed ? (
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
