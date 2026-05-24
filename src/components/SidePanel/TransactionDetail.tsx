import React, { useRef, useState } from 'react';
import { base64 } from '@scure/base';
import { useGlobalState, layoutRef } from '../../hooks/useGlobalState';
import { satsToBtc, truncateTxid, formatTimestamp, formatFeeRate } from '../../utils/formatting';
import { formatOpReturnDisplay } from '../../utils/opReturn';
import { formatInputSequence, isLocktimeDisabled, showsAbsoluteLocktime } from '../../utils/sequence';
import { isKnownTxid } from '../../utils/psbt';
import OpenInExplorerButton from './OpenInExplorerButton';
import PsbtDerivationFields from './PsbtDerivationFields';
import PsbtAdvancedSection from './PsbtAdvancedSection';
import PsbtMoveControls from './PsbtMoveControls';
import { EMOJI_PALETTE } from '../../utils/emoji';

const iconClass = 'shrink-0';

function SaveIcon() {
  return (
    <svg className={iconClass} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className={iconClass} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className={iconClass} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

const psbtActionClass =
  'w-full flex items-center justify-center gap-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 py-2 px-2 rounded cursor-pointer';

function copyToClipboard(text: string, successMessage = 'Copied to clipboard') {
  const { addSuccess, addError } = useGlobalState.getState();
  navigator.clipboard.writeText(text).then(() => {
    addSuccess(successMessage);
  }).catch(() => {
    addError('Could not copy to clipboard');
  });
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
    replacePsbtNode,
    movePsbtIo: movePsbtIoInState,
    addError,
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

  const showUnknownTxid = stored.isPsbt && !isKnownTxid(tx.txid);
  const displayTxid = isKnownTxid(tx.txid) ? tx.txid : selectedTxid;

  const handleSavePsbt = () => {
    if (!stored.psbtBase64) return;
    try {
      const bytes = base64.decode(stored.psbtBase64);
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const baseName = stored.name?.replace(/[^\w.-]+/g, '_') || 'transaction';
      a.download = `${baseName}.psbt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      useGlobalState.getState().addError('Could not save PSBT file');
    }
  };

  const handleCopyPsbt = () => {
    if (!stored.psbtBase64) return;
    copyToClipboard(stored.psbtBase64, 'PSBT copied to clipboard');
  };

  const handlePsbtDerivationUpdated = (newBase64: string) => {
    if (!stored.psbtBase64) return;
    replacePsbtNode(selectedTxid, newBase64);
  };

  const handlePsbtMove = (kind: 'input' | 'output', index: number, direction: 'up' | 'down') => {
    movePsbtIoInState(selectedTxid, kind, index, direction);
  };

  const inputCount = tx.vin.length;
  const outputCount = tx.vout.length;
  const showPsbtMove = stored.isPsbt && !!stored.psbtBase64;

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
        {showUnknownTxid ? (
          <div className="text-xs text-gray-500 italic">Unknown id</div>
        ) : (
          <div
            className="text-xs text-gray-400 font-mono cursor-pointer hover:text-white truncate"
            title="Click to copy"
            onClick={() => copyToClipboard(displayTxid)}
          >
            {displayTxid}
          </div>
        )}

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
          {stored.isPsbt ? (
            <div className="text-xs text-purple-400">PSBT</div>
          ) : tx.status.confirmed ? (
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
                  Add All Transactions
                </button>
              )}
              {someInputsChecked && (
                <button
                  className="text-xs text-gray-400 hover:text-white cursor-pointer"
                  onClick={() => nonCoinbaseVins.filter(vin => !!transactions[vin.txid]).forEach(vin => removeTransaction(vin.txid))}
                >
                  Remove All Transactions
                </button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {tx.vin.map((vin, i) => {
              const addr = vin.prevout?.scriptpubkey_address;
              const addrData = addr ? addresses[addr] : undefined;
              const vinTxBase = transactions[vin.txid]
                ? (transactions[vin.txid].name || truncateTxid(vin.txid))
                : truncateTxid(vin.txid);
              const vinTxLabel =
                !vin.is_coinbase && vin.txid ? `${vinTxBase} : ${vin.vout}` : vinTxBase;

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
                      className="text-blue-400 cursor-pointer hover:text-blue-300 font-mono truncate min-w-0 flex-1"
                      onClick={() => handleInputTxClick(vin)}
                    >
                      {vinTxLabel}
                    </div>
                    {showPsbtMove && (
                      <PsbtMoveControls
                        count={inputCount}
                        index={i}
                        onMove={(direction) => handlePsbtMove('input', i, direction)}
                      />
                    )}
                  </div>
                  {addr ? (
                    <div className="space-y-0.5">
                      {addrData?.name && (
                        <div className="text-gray-400">{addrData.name}</div>
                      )}
                      <div
                        className="cursor-pointer hover:text-white font-mono break-all"
                        style={{ color: addrData?.color || '#9ca3af' }}
                        onClick={() => handleAddressClick(addr)}
                      >
                        {`${i}: ${addr}`}
                      </div>
                    </div>
                  ) : stored.isPsbt && vin.txid && !transactions[vin.txid] ? null : (
                    <div className="text-gray-400">{`${i}: Non-Standard`}</div>
                  )}
                  <div className="text-gray-400 font-mono">
                    {formatInputSequence(tx.version, vin.sequence)}
                  </div>
                  <div className="text-gray-300">
                    {satsToBtc(vin.prevout?.value || 0)} BTC
                  </div>
                  {stored.isPsbt && stored.psbtBase64 && (
                    <PsbtDerivationFields
                      psbtBase64={stored.psbtBase64}
                      kind="input"
                      index={i}
                      onPsbtUpdated={handlePsbtDerivationUpdated}
                      onError={addError}
                    />
                  )}
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
                  Add All Transactions
                </button>
              )}
              {someOutputsChecked && (
                <button
                  className="text-xs text-gray-400 hover:text-white cursor-pointer"
                  onClick={() => spendingTxids.filter(txid => !!transactions[txid]).forEach(txid => removeTransaction(txid))}
                >
                  Remove All Transactions
                </button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {tx.vout.map((vout, i) => {
              const outspend = stored.outspends[i];
              const addr = vout.scriptpubkey_address;
              const addrData = addr ? addresses[addr] : undefined;
              const isOpReturn = vout.scriptpubkey_type === 'op_return';
              const opReturnContent = isOpReturn
                ? formatOpReturnDisplay(vout.scriptpubkey)
                : '';

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
                          className="cursor-pointer hover:opacity-80 font-mono truncate min-w-0 flex-1"
                          style={{ color: 'rgb(10, 171, 47)' }}
                          onClick={() => handleOutputTxClick(spendingTxid)}
                        >
                          {transactions[spendingTxid]
                            ? (transactions[spendingTxid].name || truncateTxid(spendingTxid))
                            : truncateTxid(spendingTxid)}
                        </div>
                        {showPsbtMove && (
                          <PsbtMoveControls
                            count={outputCount}
                            index={i}
                            onMove={(direction) => handlePsbtMove('output', i, direction)}
                          />
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div
                          style={{ color: 'rgb(255, 61, 0)' }}
                          className="font-semibold flex-1 min-w-0"
                        >
                          UTXO
                        </div>
                        {showPsbtMove && (
                          <PsbtMoveControls
                            count={outputCount}
                            index={i}
                            onMove={(direction) => handlePsbtMove('output', i, direction)}
                          />
                        )}
                      </div>
                    )
                  )}

                  {/* Address / OP_RETURN */}
                  {isOpReturn ? (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <div className="text-gray-400 flex-1 min-w-0">{`${i}: OP_RETURN`}</div>
                        {showPsbtMove && (
                          <PsbtMoveControls
                            count={outputCount}
                            index={i}
                            onMove={(direction) => handlePsbtMove('output', i, direction)}
                          />
                        )}
                      </div>
                      {opReturnContent ? (
                        <div className="text-gray-300 break-all whitespace-pre-wrap font-mono text-[11px]">
                          {opReturnContent}
                        </div>
                      ) : null}
                    </div>
                  ) : addr ? (
                    <div className="space-y-0.5">
                      {addrData?.name && (
                        <div className="text-gray-400">{addrData.name}</div>
                      )}
                      <div
                        className="cursor-pointer hover:text-white font-mono break-all"
                        style={{ color: addrData?.color || '#9ca3af' }}
                        onClick={() => handleAddressClick(addr)}
                      >
                        {`${i}: ${addr}`}
                      </div>
                    </div>
                  ) : null}

                  {/* Amount */}
                  {!isOpReturn && (
                    <div className="text-gray-300">
                      {`${satsToBtc(vout.value)} BTC`}
                    </div>
                  )}
                  {stored.isPsbt && stored.psbtBase64 && !isOpReturn && (
                    <PsbtDerivationFields
                      psbtBase64={stored.psbtBase64}
                      kind="output"
                      index={i}
                      showOptionalLabel
                      onPsbtUpdated={handlePsbtDerivationUpdated}
                      onError={addError}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {stored.isPsbt && stored.psbtBase64 && (
          <PsbtAdvancedSection psbtBase64={stored.psbtBase64} />
        )}

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
              <span className="text-gray-400">Fee</span>
              <span>{satsToBtc(tx.fee)} BTC</span>
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
              <span>
                {showsAbsoluteLocktime(tx.locktime, tx.vin)
                  ? `${tx.locktime} (${formatTimestamp(tx.locktime)})`
                  : tx.locktime}
                {isLocktimeDisabled(tx.vin) ? ' (disabled)' : ''}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-700 space-y-2">
        {stored.isPsbt && stored.psbtBase64 && (
          <>
            <button type="button" className={psbtActionClass} onClick={handleSavePsbt}>
              <SaveIcon />
              Save PSBT as…
            </button>
            <button type="button" className={psbtActionClass} onClick={handleCopyPsbt}>
              <CopyIcon />
              Copy PSBT to Clipboard
            </button>
          </>
        )}
        {!stored.isPsbt && isKnownTxid(displayTxid) && (
          <OpenInExplorerButton type="tx" id={displayTxid} />
        )}
        <button
          className="w-full flex items-center justify-center gap-1.5 text-xs bg-red-900 hover:bg-red-800 text-white py-1.5 rounded cursor-pointer"
          onClick={() => removeTransaction(selectedTxid)}
        >
          <TrashIcon />
          Remove Transaction
        </button>
      </div>
    </div>
  );
}
