import React, { useRef, useState } from 'react';
import { useGlobalState, layoutRef } from '../../hooks/useGlobalState';
import { satsToBtc, truncateTxid, truncateAddress, formatTimestamp, formatFeeRate } from '../../utils/formatting';
import { EMOJI_PALETTE } from '../../utils/emoji';

function copyToClipboard(text: string, e: React.MouseEvent) {
  navigator.clipboard.writeText(text).then(() => {
    window.dispatchEvent(new CustomEvent('copy-success', { detail: { x: e.clientX, y: e.clientY } }));
  }).catch(() => {});
}

interface Props {
  onOpenAddressDetail: (address: string) => void;
  onHide: () => void;
}

export default function TransactionDetail({ onOpenAddressDetail, onHide }: Props) {
  const {
    transactions,
    addresses,
    selectedTxid,
    setSelectedTxid,
    updateTransaction,
    removeTransaction,
    addTransaction,
    addTransactions,
  } = useGlobalState();

  const stored = selectedTxid ? transactions[selectedTxid] : undefined;
  const [nameInput, setNameInput] = useState('');
  const [showEmojiPalette, setShowEmojiPalette] = useState(false);
  const cursorPosRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (stored) setNameInput(stored.name || '');
  }, [selectedTxid, stored]);

  if (!stored || !selectedTxid) return null;

  const tx = stored.data;

  const nonCoinbaseVins = tx.vin.filter(vin => !vin.is_coinbase);
  const someInputsUnchecked = nonCoinbaseVins.some(vin => !transactions[vin.txid]);
  const someInputsChecked = nonCoinbaseVins.some(vin => !!transactions[vin.txid]);

  const spendingTxids = tx.vout
    .map((_, i) => (stored.outspends[i]?.spent ? stored.outspends[i].txid : undefined))
    .filter((t): t is string => !!t);
  const someOutputsUnchecked = spendingTxids.some(txid => !transactions[txid]);
  const someOutputsChecked = spendingTxids.some(txid => !!transactions[txid]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNameInput(e.target.value);
    cursorPosRef.current = e.target.selectionStart ?? 0;
  };

  const handleNameBlur = () => {
    cursorPosRef.current = inputRef.current?.selectionStart ?? 0;
    updateTransaction(selectedTxid, { name: nameInput || undefined });
  };

  const insertEmoji = (emoji: string) => {
    const pos = cursorPosRef.current;
    const next = nameInput.slice(0, pos) + emoji + nameInput.slice(pos);
    setNameInput(next);
    updateTransaction(selectedTxid, { name: next || undefined });
    setShowEmojiPalette(false);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const newPos = pos + emoji.length;
      inputRef.current?.setSelectionRange(newPos, newPos);
      cursorPosRef.current = newPos;
    });
  };

  const handleInputTxClick = async (vin: typeof tx.vin[0]) => {
    const vinTxid = vin.txid;
    if (transactions[vinTxid]) {
      layoutRef.focusNode(vinTxid);
      setSelectedTxid(vinTxid);
    } else {
      await addTransaction(vinTxid);
    }
  };

  const handleOutputTxClick = async (spendingTxid: string) => {
    if (transactions[spendingTxid]) {
      layoutRef.focusNode(spendingTxid);
      setSelectedTxid(spendingTxid);
    } else {
      await addTransaction(spendingTxid);
    }
  };

  const handleAddressClick = (address: string) => {
    if (!addresses[address]) {
      useGlobalState.getState().updateAddress(address, { isSelected: false });
    }
    onOpenAddressDetail(address);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-gray-700">
        <div className="flex items-center gap-2 mb-2">
          <button
            className="text-gray-400 hover:text-white text-xs cursor-pointer"
            onClick={() => setSelectedTxid(undefined)}
          >
            ← Back
          </button>
          <span className="text-xs text-gray-500 flex-1">Transaction Details</span>
          <button
            className="text-gray-500 hover:text-white transition-colors cursor-pointer"
            onClick={onHide}
            title="Hide panel"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </button>
        </div>

        {/* Txid */}
        <div
          className="text-xs text-gray-400 font-mono cursor-pointer hover:text-white truncate"
          title="Click to copy"
          onClick={e => copyToClipboard(selectedTxid, e)}
        >
          {selectedTxid}
        </div>

        {/* Name input */}
        <div className="mt-2 relative flex items-center gap-1 bg-gray-700 rounded border border-gray-600 focus-within:border-blue-500">
          <input
            ref={inputRef}
            className="flex-1 min-w-0 bg-transparent text-white text-sm px-2 py-1 focus:outline-none"
            placeholder="Name (optional)"
            value={nameInput}
            onChange={handleNameChange}
            onBlur={handleNameBlur}
            onSelect={() => { cursorPosRef.current = inputRef.current?.selectionStart ?? 0; }}
            onKeyDown={e => { if (e.key === 'Enter') { handleNameBlur(); e.currentTarget.blur(); } }}
          />
          <button
            type="button"
            className="shrink-0 p-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded-r transition-colors cursor-pointer"
            onClick={() => setShowEmojiPalette(prev => !prev)}
            title="Insert emoji"
          >
            <span className="text-base" aria-hidden>😀</span>
          </button>
          {showEmojiPalette && (
            <>
              <div
                className="fixed inset-0 z-10"
                aria-hidden
                onClick={() => setShowEmojiPalette(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-20 p-2 bg-gray-800 border border-gray-600 rounded-lg shadow-xl grid grid-cols-8 gap-1 max-h-40 overflow-y-auto">
                {EMOJI_PALETTE.map((emoji, i) => (
                  <button
                    key={i}
                    type="button"
                    className="w-7 h-7 flex items-center justify-center text-lg hover:bg-gray-600 rounded transition-colors cursor-pointer"
                    onClick={() => insertEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Color */}
        <div className="flex items-center gap-2 mt-2">
          <label className="text-xs text-gray-400">Color:</label>
          <input
            type="color"
            className="w-8 h-6 rounded cursor-pointer bg-transparent border border-gray-600"
            value={stored.color || '#6b7280'}
            onChange={(e) => updateTransaction(selectedTxid, { color: e.target.value })}
          />
          {stored.color && (
            <button
              className="text-xs text-gray-400 hover:text-white cursor-pointer"
              onClick={() => updateTransaction(selectedTxid, { color: undefined })}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Status */}
        <div>
          {tx.status.confirmed ? (
            <>
              <div className="text-xs text-green-400">
                Confirmed — Block {tx.status.block_height}
              </div>
              {tx.status.block_time && (
                <div className="text-xs text-gray-400">{formatTimestamp(tx.status.block_time)}</div>
              )}
            </>
          ) : (
            <div className="text-xs text-yellow-400 animate-pulse">Unconfirmed</div>
          )}
        </div>

        {/* Inputs */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase">
              Inputs ({tx.vin.length})
            </h3>
            <div className="flex gap-3">
              {someInputsUnchecked && (
                <button
                  className="text-xs text-gray-400 hover:text-white cursor-pointer"
                  onClick={() => addTransactions(nonCoinbaseVins.filter(vin => !transactions[vin.txid]).map(vin => vin.txid))}
                >
                  Add All
                </button>
              )}
              {someInputsChecked && (
                <button
                  className="text-xs text-gray-400 hover:text-white cursor-pointer"
                  onClick={() => nonCoinbaseVins.filter(vin => !!transactions[vin.txid]).forEach(vin => removeTransaction(vin.txid))}
                >
                  Remove All
                </button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {tx.vin.map((vin, i) => {
              const addr = vin.prevout?.scriptpubkey_address;
              const addrData = addr ? addresses[addr] : undefined;
              const addrLabel = addrData?.name || (addr ? truncateAddress(addr) : 'Unknown');
              const vinTxLabel = transactions[vin.txid]
                ? (transactions[vin.txid].name || truncateTxid(vin.txid))
                : truncateTxid(vin.txid);

              const vinInState = !!transactions[vin.txid];

              return (
                <div key={i} className="bg-gray-700 rounded p-2 text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={vinInState}
                      onChange={() => {
                        if (vinInState) {
                          removeTransaction(vin.txid);
                        } else {
                          addTransaction(vin.txid, { noFocus: true });
                        }
                      }}
                      className="shrink-0 cursor-pointer accent-blue-500"
                    />
                    <div
                      className="text-blue-400 cursor-pointer hover:text-blue-300 font-mono truncate"
                      onClick={() => handleInputTxClick(vin)}
                    >
                      {vinTxLabel}
                    </div>
                  </div>
                  {addr && (
                    <div
                      className="cursor-pointer hover:text-white truncate"
                      style={{ color: addrData?.color || '#9ca3af' }}
                      onClick={() => handleAddressClick(addr)}
                      title={addr}
                    >
                      {addrLabel}
                    </div>
                  )}
                  <div className="text-gray-300">
                    {satsToBtc(vin.prevout?.value || 0)} BTC
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Outputs */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase">
              Outputs ({tx.vout.length})
            </h3>
            <div className="flex gap-3">
              {someOutputsUnchecked && (
                <button
                  className="text-xs text-gray-400 hover:text-white cursor-pointer"
                  onClick={() => addTransactions(spendingTxids.filter(txid => !transactions[txid]))}
                >
                  Add All
                </button>
              )}
              {someOutputsChecked && (
                <button
                  className="text-xs text-gray-400 hover:text-white cursor-pointer"
                  onClick={() => spendingTxids.filter(txid => !!transactions[txid]).forEach(txid => removeTransaction(txid))}
                >
                  Remove All
                </button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {tx.vout.map((vout, i) => {
              const outspend = stored.outspends[i];
              const addr = vout.scriptpubkey_address;
              const addrData = addr ? addresses[addr] : undefined;
              const addrLabel = addrData?.name || (addr ? truncateAddress(addr) : undefined);
              const isOpReturn = vout.scriptpubkey_type === 'op_return';

              const spendingTxid = outspend?.spent ? outspend.txid : undefined;
              const spendingInState = spendingTxid ? !!transactions[spendingTxid] : false;

              return (
                <div key={i} className="bg-gray-700 rounded p-2 text-xs space-y-1">
                  {/* Spending tx or UTXO */}
                  {!isOpReturn && (
                    spendingTxid ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={spendingInState}
                          onChange={() => {
                            if (spendingInState) {
                              removeTransaction(spendingTxid);
                            } else {
                              addTransaction(spendingTxid, { noFocus: true });
                            }
                          }}
                          className="shrink-0 cursor-pointer accent-blue-500"
                        />
                        <div
                          className="cursor-pointer hover:opacity-80 font-mono truncate"
                          style={{ color: 'rgb(10, 171, 47)' }}
                          onClick={() => handleOutputTxClick(spendingTxid)}
                        >
                          {transactions[spendingTxid]
                            ? (transactions[spendingTxid].name || truncateTxid(spendingTxid))
                            : truncateTxid(spendingTxid)}
                        </div>
                      </div>
                    ) : (
                      <div style={{ color: 'rgb(255, 61, 0)' }} className="font-semibold">
                        UTXO
                      </div>
                    )
                  )}

                  {/* Address */}
                  {isOpReturn ? (
                    <div className="text-gray-400">OP_RETURN</div>
                  ) : addr ? (
                    <div
                      className="cursor-pointer hover:text-white truncate"
                      style={{ color: addrData?.color || '#9ca3af' }}
                      onClick={() => handleAddressClick(addr)}
                      title={addr}
                    >
                      {addrLabel || truncateAddress(addr)}
                    </div>
                  ) : null}

                  {/* Amount */}
                  <div className="text-gray-300">
                    {isOpReturn ? 'OP_RETURN' : `${satsToBtc(vout.value)} BTC`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Details */}
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Details</h3>
          <div className="bg-gray-700 rounded p-2 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-400">Size</span>
              <span>{tx.size} bytes</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Weight</span>
              <span>{tx.weight} WU</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Fee rate</span>
              <span>{formatFeeRate(tx.fee, tx.weight)} sat/vB</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Version</span>
              <span>{tx.version}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Locktime</span>
              <span>{tx.locktime}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-700 space-y-2">
        <a
          href={`https://mempool.space/tx/${selectedTxid}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center text-xs bg-blue-700 hover:bg-blue-600 text-white py-1.5 rounded"
        >
          Open on Mempool.space
        </a>
        <button
          className="w-full text-xs bg-red-900 hover:bg-red-800 text-white py-1.5 rounded"
          onClick={() => removeTransaction(selectedTxid)}
        >
          Remove Transaction
        </button>
      </div>
    </div>
  );
}
