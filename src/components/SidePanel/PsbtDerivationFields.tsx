import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PSBT_INPUT_SCRIPT_TYPES,
  PSBT_OUTPUT_SCRIPT_TYPES,
  PSBT_SCRIPT_TYPE_LABELS,
  addressFromPubkeyAndScriptKind,
  readPsbtIoDerivation,
  readPsbtIoPubkey,
  readPsbtIoScriptType,
  updatePsbtIoDerivation,
  validateFingerprintField,
  validatePathField,
  validatePathSyntaxField,
  validatePubkeyField,
  type PsbtScriptKind,
} from '../../utils/psbt';

const fieldClass =
  'w-full text-xs bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-gray-500 font-mono';

const selectClass =
  'w-full text-xs bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 focus:outline-none focus:border-gray-500 cursor-pointer';

type DerivationField = 'fingerprint' | 'path' | 'pubkey';

type DerivationDraft = {
  fingerprint: string;
  path: string;
  pubkey: string;
};

interface Props {
  psbtBase64: string;
  kind: 'input' | 'output';
  index: number;
  showOptionalLabel?: boolean;
  /** Fired when the script type dropdown changes (including after PSBT reload). */
  onScriptTypeChange?: (scriptType: PsbtScriptKind) => void;
  /** Graph node id — resets sticky fingerprint when switching transactions. */
  transactionKey?: string;
  /** Set after an output address edit so the fingerprint field stays while path/pubkey clear. */
  preservedFingerprint?: string;
  onPreserveApplied?: () => void;
  /** Parent tx output address when the previous transaction/PSBT is on the graph. */
  parentOutputAddress?: string;
  onPsbtUpdated: (newBase64: string) => void;
  onError: (message: string) => void;
}

function scriptTypeOptions(
  kind: 'input' | 'output',
  current: PsbtScriptKind
): PsbtScriptKind[] {
  const base = kind === 'input' ? PSBT_INPUT_SCRIPT_TYPES : PSBT_OUTPUT_SCRIPT_TYPES;
  if (base.includes(current)) return base;
  return [current, ...base];
}

/** Format-only validation for the field being committed (empty is OK). */
function fieldFormatError(
  field: DerivationField,
  draft: DerivationDraft
): string | null {
  if (field === 'fingerprint') return validateFingerprintField(draft.fingerprint);
  if (field === 'path') return validatePathSyntaxField(draft.path);
  return validatePubkeyField(draft.pubkey);
}

function fieldValue(draft: DerivationDraft, field: DerivationField): string {
  return draft[field];
}

function allDerivationFieldsFilled(draft: DerivationDraft): boolean {
  return (
    draft.fingerprint.trim().length > 0 &&
    draft.path.trim().length > 0 &&
    draft.pubkey.trim().length > 0
  );
}

function allDerivationFieldsEmpty(draft: DerivationDraft): boolean {
  return (
    !draft.fingerprint.trim() &&
    !draft.path.trim() &&
    !draft.pubkey.trim()
  );
}

function allDerivationFieldsValid(draft: DerivationDraft): boolean {
  return (
    !validateFingerprintField(draft.fingerprint) &&
    !validatePathField(draft.path, draft.fingerprint) &&
    !validatePubkeyField(draft.pubkey)
  );
}

function readDerivationDraftFromPsbt(
  psbtBase64: string,
  kind: 'input' | 'output',
  index: number
): DerivationDraft {
  const der = readPsbtIoDerivation(psbtBase64, kind, index);
  return {
    fingerprint: der.fingerprint,
    path: der.path,
    pubkey: readPsbtIoPubkey(psbtBase64, kind, index) ?? '',
  };
}

export default function PsbtDerivationFields({
  psbtBase64,
  kind,
  index,
  showOptionalLabel,
  transactionKey,
  preservedFingerprint,
  onPreserveApplied,
  parentOutputAddress,
  onScriptTypeChange,
  onPsbtUpdated,
  onError,
}: Props) {
  const derivationKey = `${psbtBase64}:${kind}:${index}`;
  const initial = readDerivationDraftFromPsbt(psbtBase64, kind, index);
  const initialScriptType = readPsbtIoScriptType(psbtBase64, kind, index);

  const [fingerprint, setFingerprint] = useState(initial.fingerprint);
  const [path, setPath] = useState(initial.path);
  const [pubkey, setPubkey] = useState(initial.pubkey);
  const [scriptType, setScriptType] = useState<PsbtScriptKind>(initialScriptType);

  const lastValidRef = useRef<DerivationDraft>({ ...initial });
  const draftTouchedRef = useRef(false);
  const stickyFingerprintIoRef = useRef<string | null>(null);
  const ioKey = `${transactionKey ?? ''}:${kind}:${index}`;

  const draft = useMemo(
    (): DerivationDraft => ({ fingerprint, path, pubkey }),
    [fingerprint, path, pubkey]
  );

  const typeOptions = useMemo(
    () => scriptTypeOptions(kind, scriptType),
    [kind, scriptType]
  );

  const syncLastValidFromPsbt = () => {
    lastValidRef.current = readDerivationDraftFromPsbt(psbtBase64, kind, index);
  };

  useEffect(() => {
    stickyFingerprintIoRef.current = null;
    draftTouchedRef.current = false;
    syncLastValidFromPsbt();
  }, [transactionKey]);

  useEffect(() => {
    const next = readDerivationDraftFromPsbt(psbtBase64, kind, index);
    const nextScriptType = readPsbtIoScriptType(psbtBase64, kind, index);

    setScriptType(nextScriptType);
    onScriptTypeChange?.(nextScriptType);

    if (preservedFingerprint !== undefined) {
      draftTouchedRef.current = true;
      const preserved: DerivationDraft = {
        fingerprint: preservedFingerprint,
        path: '',
        pubkey: next.pubkey,
      };
      setFingerprint(preserved.fingerprint);
      setPath(preserved.path);
      setPubkey(preserved.pubkey);
      lastValidRef.current = { ...preserved };
      stickyFingerprintIoRef.current = ioKey;
      onPreserveApplied?.();
      return;
    }

    if (draftTouchedRef.current) return;

    setFingerprint(next.fingerprint);
    setPath(next.path);
    setPubkey(next.pubkey);
    lastValidRef.current = { ...next };

    if (next.fingerprint) {
      stickyFingerprintIoRef.current = null;
    } else if (stickyFingerprintIoRef.current !== ioKey) {
      setFingerprint(next.fingerprint);
    }
  }, [derivationKey, psbtBase64, kind, index, ioKey, preservedFingerprint, onPreserveApplied, onScriptTypeChange]);

  const revertField = (field: DerivationField) => {
    const v = lastValidRef.current[field];
    if (field === 'fingerprint') setFingerprint(v);
    else if (field === 'path') setPath(v);
    else setPubkey(v);
  };

  const commitFullDerivation = () => {
    const nextFingerprint = fingerprint;
    const nextPath = path;
    const nextPubkey = pubkey;

    const current = readDerivationDraftFromPsbt(psbtBase64, kind, index);
    const currentScriptType = readPsbtIoScriptType(psbtBase64, kind, index);

    const scriptTypeForSave =
      scriptType !== currentScriptType &&
      scriptType !== 'op_return' &&
      !nextPubkey.trim()
        ? currentScriptType
        : scriptType;

    if (
      nextFingerprint === current.fingerprint &&
      nextPath === current.path &&
      nextPubkey === current.pubkey &&
      scriptTypeForSave === currentScriptType
    ) {
      return;
    }

    try {
      const updated = updatePsbtIoDerivation(
        psbtBase64,
        kind,
        index,
        nextFingerprint,
        nextPath,
        nextPubkey.trim(),
        scriptTypeForSave
      );
      onPsbtUpdated(updated);
      draftTouchedRef.current = false;
      const saved = readDerivationDraftFromPsbt(updated, kind, index);
      lastValidRef.current = saved;
      setFingerprint(saved.fingerprint);
      setPath(saved.path);
      setPubkey(saved.pubkey);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to update PSBT');
      setFingerprint(lastValidRef.current.fingerprint);
      setPath(lastValidRef.current.path);
      setPubkey(lastValidRef.current.pubkey);
    }
  };

  const clearDerivationInPsbtIfNeeded = () => {
    const current = readDerivationDraftFromPsbt(psbtBase64, kind, index);
    const hadDerivation =
      current.fingerprint.length > 0 ||
      current.path.length > 0 ||
      current.pubkey.length > 0;
    if (!hadDerivation) return;

    try {
      const updated = updatePsbtIoDerivation(
        psbtBase64,
        kind,
        index,
        '',
        '',
        undefined,
        scriptType
      );
      onPsbtUpdated(updated);
      draftTouchedRef.current = false;
      const saved = readDerivationDraftFromPsbt(updated, kind, index);
      lastValidRef.current = saved;
      setFingerprint(saved.fingerprint);
      setPath(saved.path);
      setPubkey(saved.pubkey);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to update PSBT');
      setFingerprint(lastValidRef.current.fingerprint);
      setPath(lastValidRef.current.path);
      setPubkey(lastValidRef.current.pubkey);
    }
  };

  const commitOnBlur = (field: DerivationField) => {
    const value = fieldValue(draft, field);
    const formatErr = fieldFormatError(field, draft);

    if (value.trim() && formatErr) {
      onError(formatErr);
      revertField(field);
      return;
    }

    if (!allDerivationFieldsFilled(draft)) {
      draftTouchedRef.current = true;
      if (allDerivationFieldsEmpty(draft)) {
        clearDerivationInPsbtIfNeeded();
      }
      return;
    }

    if (!allDerivationFieldsValid(draft)) {
      const fpErr = validateFingerprintField(fingerprint);
      const pathErr = validatePathField(path, fingerprint);
      const pkErr = validatePubkeyField(pubkey);
      const err = fpErr ?? pathErr ?? pkErr;
      if (err) onError(err);
      setFingerprint(lastValidRef.current.fingerprint);
      setPath(lastValidRef.current.path);
      setPubkey(lastValidRef.current.pubkey);
      return;
    }

    commitFullDerivation();
  };

  const markDraftTouched = () => {
    draftTouchedRef.current = true;
  };

  const handleScriptTypeChange = (next: PsbtScriptKind) => {
    setScriptType(next);
    onScriptTypeChange?.(next);
    markDraftTouched();
    if (next === 'op_return' || pubkey.trim()) {
      if (allDerivationFieldsFilled(draft) && allDerivationFieldsValid(draft)) {
        commitFullDerivation();
      }
    }
  };

  const showDerivationFields = scriptType !== 'op_return';

  const pubkeyParentAddressMismatch = useMemo(() => {
    if (kind !== 'input' || !parentOutputAddress) return null;
    if (!allDerivationFieldsFilled(draft) || !allDerivationFieldsValid(draft)) return null;

    const derived = addressFromPubkeyAndScriptKind(pubkey.trim(), scriptType);
    if (!derived) return null;

    if (derived.toLowerCase() === parentOutputAddress.toLowerCase()) return null;
    return `Address derived from public key (${derived}) is different from the previous transaction output address (${parentOutputAddress}).`;
  }, [kind, draft, pubkey, scriptType, parentOutputAddress]);

  const blurEnterProps = (field: DerivationField) => ({
    onBlur: () => commitOnBlur(field),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.currentTarget.blur();
      }
    },
  });

  return (
    <div className="space-y-1.5 pt-1.5 border-t border-gray-600">
      <div>
        <label className="text-[10px] text-gray-500 block mb-0.5">Script type</label>
        <select
          className={selectClass}
          value={scriptType}
          aria-label={`${kind} ${index} script type`}
          onChange={(e) => handleScriptTypeChange(e.target.value as PsbtScriptKind)}
        >
          {typeOptions.map(t => (
            <option key={t} value={t}>
              {PSBT_SCRIPT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {showDerivationFields && (
        <>
          {showOptionalLabel && (
            <div className="text-[10px] text-gray-500 italic">
              Optional — for change addresses
            </div>
          )}
          <div>
            <label className="text-[10px] text-gray-500 block mb-0.5">
              Master Public Key Fingerprint
            </label>
            <input
              type="text"
              className={fieldClass}
              value={fingerprint}
              placeholder="8 hex chars"
              onChange={(e) => {
                markDraftTouched();
                setFingerprint(e.target.value);
              }}
              {...blurEnterProps('fingerprint')}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block mb-0.5">Derivation Path</label>
            <input
              type="text"
              className={fieldClass}
              value={path}
              placeholder="i.e. m/0h/0/0"
              onChange={(e) => {
                markDraftTouched();
                setPath(e.target.value);
              }}
              {...blurEnterProps('path')}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block mb-0.5">Public key</label>
            <input
              type="text"
              className={fieldClass}
              value={pubkey}
              placeholder="33-byte compressed pubkey (hex)"
              onChange={(e) => {
                markDraftTouched();
                setPubkey(e.target.value);
              }}
              {...blurEnterProps('pubkey')}
            />
            {pubkeyParentAddressMismatch && (
              <p className="text-sm text-red-400 mt-1 break-all">
                {pubkeyParentAddressMismatch}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
