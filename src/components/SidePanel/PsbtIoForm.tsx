import { useEffect, useMemo, useRef, useState } from 'react';
import {
  opReturnDraftFromBytes,
  opReturnPayloadBytes,
  parseOpReturnEditDraft,
  type OpReturnEditMode,
} from '../../utils/opReturn';
import {
  formatSequenceHex,
  inputSequenceHintSuffix,
  parseSequenceValue,
  SEQUENCE_VALUE_FORMAT_HINT,
} from '../../utils/sequence';
import {
  PSBT_SCRIPT_TYPE_LABELS,
  derivePubkeyFromPsbtGlobalMasterKeys,
  type PsbtScriptKind,
} from '../../utils/psbt';
import {
  loadPsbtIoFormDraft,
  savePsbtInputForm,
  savePsbtOutputForm,
  scriptTypeOptions,
  type PsbtIoFormDraft,
  type PsbtIoFormMempoolContext,
} from '../../utils/psbtIoForm';

const fieldClass =
  'w-full text-xs bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 placeholder:text-gray-400 focus:outline-none focus:border-gray-500 font-mono';

const selectClass =
  'w-full text-xs bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 focus:outline-none focus:border-gray-500 cursor-pointer';

const amountFieldClass =
  'text-xs bg-gray-900 border border-gray-600 rounded px-1 py-0.5 text-gray-200 font-mono w-[9.5rem] focus:outline-none focus:border-gray-500';

const SPAM_LINK_URL = 'https://www.youtube.com/watch?v=anwy2MPT5RE';
const OP_RETURN_STANDARD_MAX_BYTES = 80;

const modeButtonClass = (active: boolean) =>
  `text-[10px] px-2 py-0.5 rounded border cursor-pointer ${
    active
      ? 'bg-gray-600 border-gray-500 text-gray-100'
      : 'bg-gray-800 border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-500'
  }`;

function InfoIcon() {
  return (
    <svg
      className="shrink-0"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

interface Props {
  psbtBase64: string;
  kind: 'input' | 'output';
  index: number;
  transactionKey?: string;
  mempool?: PsbtIoFormMempoolContext;
  showOptionalDerivationLabel?: boolean;
  parentOutputAddress?: string;
  txVersion?: number;
  savedSequence?: number;
  onScriptTypeChange?: (scriptType: PsbtScriptKind) => void;
  onAddressInfo?: (address: string) => void;
  onPsbtUpdated: (newBase64: string) => void;
}

export default function PsbtIoForm({
  psbtBase64,
  kind,
  index,
  transactionKey,
  mempool,
  showOptionalDerivationLabel,
  parentOutputAddress,
  txVersion,
  savedSequence = 0,
  onScriptTypeChange,
  onAddressInfo,
  onPsbtUpdated,
}: Props) {
  const formKey = `${transactionKey ?? ''}:${psbtBase64}:${kind}:${index}`;
  const dirtyRef = useRef(false);

  const [draft, setDraft] = useState<PsbtIoFormDraft>(() =>
    loadPsbtIoFormDraft(psbtBase64, kind, index, mempool)
  );
  const [opReturnPayloadBytesState, setOpReturnPayloadBytesState] = useState(() =>
    copyBytes(opReturnPayloadBytes(mempool?.scriptpubkey))
  );
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [derivePubkeyError, setDerivePubkeyError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const reloadFromPsbt = () => {
    const next = loadPsbtIoFormDraft(psbtBase64, kind, index, mempool);
    setDraft(next);
    setOpReturnPayloadBytesState(copyBytes(opReturnPayloadBytes(mempool?.scriptpubkey)));
    onScriptTypeChange?.(next.scriptType);
    setSaveErrors([]);
    setDerivePubkeyError(null);
    setSaving(false);
    setDirty(false);
  };

  useEffect(() => {
    dirtyRef.current = false;
    reloadFromPsbt();
  }, [transactionKey]);

  useEffect(() => {
    if (dirtyRef.current) return;
    reloadFromPsbt();
  }, [formKey]);

  const patchDraft = (partial: Partial<PsbtIoFormDraft>) => {
    dirtyRef.current = true;
    setDirty(true);
    setSaveErrors([]);
    setDerivePubkeyError(null);
    setDraft(prev => ({ ...prev, ...partial }));
  };

  const handleDerivePubkeyFromGlobal = () => {
    setDerivePubkeyError(null);
    try {
      const pubkeyHex = derivePubkeyFromPsbtGlobalMasterKeys(
        psbtBase64,
        draft.fingerprint,
        draft.path
      );
      patchDraft({ pubkey: pubkeyHex });
    } catch (e) {
      setDerivePubkeyError(
        e instanceof Error ? e.message : 'Failed to derive public key'
      );
    }
  };

  const typeOptions = useMemo(
    () => scriptTypeOptions(kind, draft.scriptType),
    [kind, draft.scriptType]
  );

  const isOpReturn = kind === 'output' && draft.scriptType === 'op_return';
  const showDerivation = !isOpReturn;

  const switchOpReturnMode = (next: OpReturnEditMode) => {
    if (next === draft.opReturnMode) return;
    patchDraft({
      opReturnMode: next,
      opReturnDraft: opReturnDraftFromBytes(opReturnPayloadBytesState, next),
    });
  };

  const opReturnByteLength = useMemo(() => {
    try {
      return parseOpReturnEditDraft(draft.opReturnDraft, draft.opReturnMode).length;
    } catch {
      return opReturnPayloadBytesState.length;
    }
  }, [draft.opReturnDraft, draft.opReturnMode, opReturnPayloadBytesState]);

  const sequenceHint =
    kind === 'input' && txVersion !== undefined
      ? inputSequenceHintSuffix(txVersion, savedSequence).trim()
      : '';

  const handleSave = () => {
    setSaving(true);
    setSaveErrors([]);

    const result =
      kind === 'output'
        ? savePsbtOutputForm(psbtBase64, index, draft)
        : savePsbtInputForm(
            psbtBase64,
            index,
            draft,
            savedSequence,
            parentOutputAddress
          );

    setSaving(false);

    if (!result.ok) {
      setSaveErrors(result.errors);
      return;
    }

    dirtyRef.current = false;
    setDirty(false);
    onPsbtUpdated(result.base64);
    if (kind === 'input') {
      try {
        const parsed = parseSequenceValue(draft.sequenceHex);
        setDraft(prev => ({ ...prev, sequenceHex: formatSequenceHex(parsed) }));
      } catch {
        // validated before save
      }
    }
    setSaveErrors([]);
  };

  // Enter in a single-line field commits the form, mirroring the Update button.
  const handleFieldKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!saving && dirty) handleSave();
    }
  };

  const trimmedAddress = draft.address.trim();
  const canOpenAddressInfo = !!trimmedAddress && !!onAddressInfo;

  return (
    <div className="space-y-1.5 pt-1.5 border-t border-gray-600">
      <div>
        <label className="text-[10px] text-gray-400 block mb-0.5">Script type</label>
        <select
          className={selectClass}
          value={draft.scriptType}
          aria-label={`${kind} ${index} script type`}
          onChange={(e) => {
            const next = e.target.value as PsbtScriptKind;
            patchDraft({ scriptType: next });
            onScriptTypeChange?.(next);
          }}
        >
          {typeOptions.map(t => (
            <option key={t} value={t}>
              {PSBT_SCRIPT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {kind === 'input' && (
        <div className="text-gray-400 font-mono">
          <label className="text-[10px] text-gray-400 block mb-0.5">Sequence</label>
          <input
            type="text"
            className={amountFieldClass}
            value={draft.sequenceHex}
            spellCheck={false}
            aria-label={`Input ${index} sequence`}
            onChange={(e) => patchDraft({ sequenceHex: e.target.value })}
            onKeyDown={handleFieldKeyDown}
          />
          {sequenceHint ? (
            <div className="mt-0.5 text-[10px] text-gray-400">{sequenceHint}</div>
          ) : null}
          <div className="mt-0.5 text-[10px] text-gray-400">{SEQUENCE_VALUE_FORMAT_HINT}</div>
        </div>
      )}

      {isOpReturn && (
        <div className="space-y-1">
          <div className="text-[10px] text-gray-400">OP_RETURN</div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={modeButtonClass(draft.opReturnMode === 'text')}
              aria-pressed={draft.opReturnMode === 'text'}
              onClick={() => switchOpReturnMode('text')}
            >
              Text
            </button>
            <button
              type="button"
              className={modeButtonClass(draft.opReturnMode === 'hex')}
              aria-pressed={draft.opReturnMode === 'hex'}
              onClick={() => switchOpReturnMode('hex')}
            >
              Hex
            </button>
          </div>
          <textarea
            className={`${fieldClass} min-h-[3rem] resize-y`}
            value={draft.opReturnDraft}
            spellCheck={draft.opReturnMode === 'text'}
            placeholder={draft.opReturnMode === 'text' ? 'UTF-8 text' : 'Hex'}
            aria-label={`Output ${index} OP_RETURN data (${draft.opReturnMode})`}
            onChange={(e) => {
              patchDraft({ opReturnDraft: e.target.value });
              try {
                const bytes = parseOpReturnEditDraft(
                  e.target.value,
                  draft.opReturnMode
                );
                setOpReturnPayloadBytesState(copyBytes(bytes));
              } catch {
                // keep last known payload bytes for mode switching
              }
            }}
          />
          {opReturnByteLength > OP_RETURN_STANDARD_MAX_BYTES && (
            <a
              href={SPAM_LINK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-blue-400 hover:text-blue-300"
            >
              SPAM SPAM SPAM
            </a>
          )}
        </div>
      )}

      {showDerivation && (
        <>
          {showOptionalDerivationLabel && (
            <div className="text-[10px] text-gray-400 italic">
              Optional — for change addresses
            </div>
          )}
          <div>
            <label className="text-[10px] text-gray-400 block mb-0.5">
              Master Public Key Fingerprint
            </label>
            <input
              type="text"
              className={fieldClass}
              value={draft.fingerprint}
              placeholder="8 hex chars"
              onChange={(e) => patchDraft({ fingerprint: e.target.value })}
              onKeyDown={handleFieldKeyDown}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-400 block mb-0.5">Derivation Path</label>
            <input
              type="text"
              className={fieldClass}
              value={draft.path}
              placeholder="i.e. m/0h/0/0"
              onChange={(e) => patchDraft({ path: e.target.value })}
              onKeyDown={handleFieldKeyDown}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-400 block mb-0.5">Public key</label>
            <input
              type="text"
              className={fieldClass}
              value={draft.pubkey}
              placeholder="33-byte compressed pubkey (hex)"
              onChange={(e) => patchDraft({ pubkey: e.target.value })}
              onKeyDown={handleFieldKeyDown}
            />
            <button
              type="button"
              className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer mt-0.5"
              onClick={handleDerivePubkeyFromGlobal}
            >
              Derive from Master Public Key
            </button>
            {derivePubkeyError ? (
              <p className="text-sm text-red-400 mt-1 break-words">{derivePubkeyError}</p>
            ) : null}
          </div>
        </>
      )}

      {kind === 'output' && !isOpReturn && (
        <>
          <div>
            <label className="text-[10px] text-gray-400 block mb-0.5">Address</label>
            <div className="flex items-start gap-1">
              <input
                type="text"
                className={`${fieldClass} flex-1 min-w-0`}
                value={draft.address}
                spellCheck={false}
                placeholder="Leave blank to derive from public key"
                onChange={(e) => patchDraft({ address: e.target.value })}
                onKeyDown={handleFieldKeyDown}
              />
              {onAddressInfo && (
                <button
                  type="button"
                  className="shrink-0 p-1 mt-0.5 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  title="Address details"
                  aria-label="Open address details"
                  disabled={!canOpenAddressInfo}
                  onClick={() => {
                    if (canOpenAddressInfo) onAddressInfo(trimmedAddress);
                  }}
                >
                  <InfoIcon />
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="text-[10px] text-gray-400 block mb-0.5">Amount</label>
            <span className="inline-flex items-center gap-1 text-gray-300">
              <input
                type="text"
                className={amountFieldClass}
                value={draft.amountBtc}
                spellCheck={false}
                onChange={(e) => patchDraft({ amountBtc: e.target.value })}
                onKeyDown={handleFieldKeyDown}
              />
              <span>BTC</span>
            </span>
          </div>
        </>
      )}

      {saveErrors.length > 0 && (
        <ul className="text-sm text-red-400 space-y-1 list-disc list-inside break-words">
          {saveErrors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="text-xs bg-blue-700 hover:bg-blue-600 text-white py-1.5 px-4 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={saving || !dirty}
        onClick={handleSave}
      >
        {saving ? 'Updating…' : 'Update'}
      </button>
    </div>
  );
}
