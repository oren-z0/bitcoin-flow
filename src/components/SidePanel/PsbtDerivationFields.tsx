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
  type PsbtScriptKind,
} from '../../utils/psbt';

const fieldClass =
  'w-full text-xs bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-gray-500 font-mono';

const selectClass =
  'w-full text-xs bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 focus:outline-none focus:border-gray-500 cursor-pointer';

interface Props {
  psbtBase64: string;
  kind: 'input' | 'output';
  index: number;
  /** When true, only script type is shown (e.g. OP_RETURN outputs). */
  hideDerivation?: boolean;
  showOptionalLabel?: boolean;
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

export default function PsbtDerivationFields({
  psbtBase64,
  kind,
  index,
  hideDerivation = false,
  showOptionalLabel,
  transactionKey,
  preservedFingerprint,
  onPreserveApplied,
  parentOutputAddress,
  onPsbtUpdated,
  onError,
}: Props) {
  const derivationKey = `${psbtBase64}:${kind}:${index}`;
  const initial = readPsbtIoDerivation(psbtBase64, kind, index);
  const initialPubkey = readPsbtIoPubkey(psbtBase64, kind, index) ?? '';
  const initialScriptType = readPsbtIoScriptType(psbtBase64, kind, index);

  const [fingerprint, setFingerprint] = useState(initial.fingerprint);
  const [path, setPath] = useState(initial.path);
  const [pubkey, setPubkey] = useState(initialPubkey);
  const [scriptType, setScriptType] = useState<PsbtScriptKind>(initialScriptType);

  const stickyFingerprintIoRef = useRef<string | null>(null);
  const ioKey = `${transactionKey ?? ''}:${kind}:${index}`;

  const typeOptions = useMemo(
    () => scriptTypeOptions(kind, scriptType),
    [kind, scriptType]
  );

  useEffect(() => {
    stickyFingerprintIoRef.current = null;
  }, [transactionKey]);

  useEffect(() => {
    const next = readPsbtIoDerivation(psbtBase64, kind, index);
    const nextPubkey = readPsbtIoPubkey(psbtBase64, kind, index) ?? '';
    const nextScriptType = readPsbtIoScriptType(psbtBase64, kind, index);

    setPath(next.path);
    setPubkey(nextPubkey);
    setScriptType(nextScriptType);

    if (preservedFingerprint !== undefined) {
      setFingerprint(preservedFingerprint);
      setPath('');
      stickyFingerprintIoRef.current = ioKey;
      onPreserveApplied?.();
      return;
    }

    if (next.fingerprint) {
      stickyFingerprintIoRef.current = null;
      setFingerprint(next.fingerprint);
    } else if (stickyFingerprintIoRef.current !== ioKey) {
      setFingerprint(next.fingerprint);
    }
  }, [derivationKey, psbtBase64, kind, index, ioKey, preservedFingerprint, onPreserveApplied]);

  const commit = (overrides?: {
    fingerprint?: string;
    path?: string;
    pubkey?: string;
    scriptType?: PsbtScriptKind;
  }) => {
    const nextFingerprint = overrides?.fingerprint ?? fingerprint;
    const nextPath = overrides?.path ?? path;
    const nextPubkey = overrides?.pubkey ?? pubkey;
    const nextScriptType = overrides?.scriptType ?? scriptType;

    const current = readPsbtIoDerivation(psbtBase64, kind, index);
    const currentPubkey = readPsbtIoPubkey(psbtBase64, kind, index) ?? '';
    const currentScriptType = readPsbtIoScriptType(psbtBase64, kind, index);

    if (
      nextFingerprint === current.fingerprint &&
      nextPath === current.path &&
      nextPubkey === currentPubkey &&
      nextScriptType === currentScriptType
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
        nextPubkey.trim() || undefined,
        nextScriptType
      );
      onPsbtUpdated(updated);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to update PSBT');
      setFingerprint(current.fingerprint);
      setPath(current.path);
      setPubkey(currentPubkey);
      setScriptType(currentScriptType);
    }
  };

  const handleScriptTypeChange = (next: PsbtScriptKind) => {
    setScriptType(next);
    commit({ scriptType: next });
  };

  const pubkeyParentAddressMismatch = useMemo(() => {
    if (kind !== 'input' || !parentOutputAddress) return null;
    const trimmed = pubkey.trim();
    if (!trimmed) return null;

    const derived = addressFromPubkeyAndScriptKind(trimmed, scriptType);
    if (!derived) return null;

    if (derived.toLowerCase() === parentOutputAddress.toLowerCase()) return null;
    return `Address derived from public key (${derived}) is different from the previous transaction output address (${parentOutputAddress}).`;
  }, [kind, pubkey, scriptType, parentOutputAddress]);

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

      {!hideDerivation && (
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
              onChange={(e) => setFingerprint(e.target.value)}
              onBlur={() => commit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block mb-0.5">Derivation Path</label>
            <input
              type="text"
              className={fieldClass}
              value={path}
              placeholder="i.e. m/0h/0/0"
              onChange={(e) => setPath(e.target.value)}
              onBlur={() => commit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block mb-0.5">Public key</label>
            <input
              type="text"
              className={fieldClass}
              value={pubkey}
              placeholder="33-byte compressed pubkey (hex)"
              onChange={(e) => setPubkey(e.target.value)}
              onBlur={() => commit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
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
