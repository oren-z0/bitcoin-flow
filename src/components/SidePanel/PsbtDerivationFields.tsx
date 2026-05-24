import { useEffect, useState } from 'react';
import { readPsbtIoDerivation, readPsbtIoPubkey, updatePsbtIoDerivation } from '../../utils/psbt';
import PsbtReadOnlyField from './PsbtReadOnlyField';

const fieldClass =
  'w-full text-xs bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-gray-500 font-mono';

interface Props {
  psbtBase64: string;
  kind: 'input' | 'output';
  index: number;
  showOptionalLabel?: boolean;
  onPsbtUpdated: (newBase64: string) => void;
  onError: (message: string) => void;
}

export default function PsbtDerivationFields({
  psbtBase64,
  kind,
  index,
  showOptionalLabel,
  onPsbtUpdated,
  onError,
}: Props) {
  const derivationKey = `${psbtBase64}:${kind}:${index}`;
  const initial = readPsbtIoDerivation(psbtBase64, kind, index);
  const pubkey = readPsbtIoPubkey(psbtBase64, kind, index);

  const [fingerprint, setFingerprint] = useState(initial.fingerprint);
  const [path, setPath] = useState(initial.path);

  useEffect(() => {
    const next = readPsbtIoDerivation(psbtBase64, kind, index);
    setFingerprint(next.fingerprint);
    setPath(next.path);
  }, [derivationKey, psbtBase64, kind, index]);

  const commit = () => {
    const current = readPsbtIoDerivation(psbtBase64, kind, index);
    if (fingerprint === current.fingerprint && path === current.path) return;

    try {
      const updated = updatePsbtIoDerivation(psbtBase64, kind, index, fingerprint, path);
      onPsbtUpdated(updated);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to update PSBT');
      setFingerprint(current.fingerprint);
      setPath(current.path);
    }
  };

  return (
    <div className="space-y-1.5 pt-1.5 border-t border-gray-600">
      {showOptionalLabel && (
        <div className="text-[10px] text-gray-500 italic">Optional — for change addresses</div>
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
          onBlur={commit}
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
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
          }}
        />
      </div>
      {pubkey && <PsbtReadOnlyField label="Public key" value={pubkey} />}
    </div>
  );
}
