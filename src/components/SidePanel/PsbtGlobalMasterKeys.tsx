import { useEffect, useState } from 'react';
import { useGlobalState } from '../../hooks/useGlobalState';
import { truncateTxid } from '../../utils/formatting';
import {
  addPsbtGlobalMasterKey,
  readPsbtGlobalMasterKeys,
  removePsbtGlobalMasterKey,
  type PsbtGlobalMasterKey,
} from '../../utils/psbt';
import PsbtRemoveIoButton from './PsbtRemoveIoButton';

const fieldClass =
  'w-full text-xs bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 placeholder:text-gray-400 focus:outline-none focus:border-gray-500 font-mono';

interface Props {
  psbtBase64: string;
  onPsbtUpdated: (newBase64: string) => void;
}

export default function PsbtGlobalMasterKeys({ psbtBase64, onPsbtUpdated }: Props) {
  const [entries, setEntries] = useState<PsbtGlobalMasterKey[]>(() =>
    readPsbtGlobalMasterKeys(psbtBase64)
  );
  const [showForm, setShowForm] = useState(false);
  const [extendedKey, setExtendedKey] = useState('');
  const [path, setPath] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setEntries(readPsbtGlobalMasterKeys(psbtBase64));
    setShowForm(false);
    setFormError(null);
  }, [psbtBase64]);

  const handleAdd = () => {
    setFormError(null);
    try {
      const next = addPsbtGlobalMasterKey(psbtBase64, extendedKey, path, fingerprint);
      onPsbtUpdated(next);
      setExtendedKey('');
      setPath('');
      setFingerprint('');
      setShowForm(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to add master public key');
    }
  };

  const handleRemove = (index: number) => {
    setFormError(null);
    try {
      onPsbtUpdated(removePsbtGlobalMasterKey(psbtBase64, index));
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to remove master public key');
    }
  };

  const copyExtendedKey = (key: string) => {
    const { addSuccess, addError } = useGlobalState.getState();
    navigator.clipboard.writeText(key).then(() => {
      addSuccess('Copied to clipboard');
    }).catch(() => {
      addError('Could not copy to clipboard');
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[10px] font-semibold text-gray-400 uppercase">
          Master public keys
        </h4>
        {!showForm && (
          <button
            type="button"
            className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer shrink-0"
            onClick={() => {
              setShowForm(true);
              setFormError(null);
            }}
          >
            Add Master Public Key
          </button>
        )}
      </div>

      {entries.length > 0 && (
        <ul className="space-y-1.5">
          {entries.map((entry, i) => (
            <li
              key={`${entry.fingerprint}:${entry.path}:${entry.extendedKey.slice(0, 12)}`}
              className="bg-gray-800 rounded p-2 text-xs font-mono space-y-0.5"
            >
              <div className="flex items-start gap-1">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div
                    className="text-gray-300 break-all cursor-pointer hover:text-white"
                    title="Click to copy"
                    onClick={() => copyExtendedKey(entry.extendedKey)}
                  >
                    {truncateTxid(entry.extendedKey)}
                  </div>
                  <div className="text-gray-400">
                    Path: {entry.path || '(root)'}
                  </div>
                  <div className="text-gray-400">
                    Root fingerprint: {entry.fingerprint}
                  </div>
                </div>
                <PsbtRemoveIoButton
                  label="Remove master public key"
                  onRemove={() => handleRemove(i)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <div className="bg-gray-800 rounded p-2 space-y-1.5">
          <div>
            <label className="text-[10px] text-gray-400 block mb-0.5">
              Master Public Key
            </label>
            <input
              type="text"
              className={fieldClass}
              value={extendedKey}
              spellCheck={false}
              placeholder="xpub…, ypub…, zpub…"
              onChange={(e) => setExtendedKey(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-400 block mb-0.5">Derivation Path</label>
            <input
              type="text"
              className={fieldClass}
              value={path}
              placeholder="i.e. m/0h"
              onChange={(e) => setPath(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-400 block mb-0.5">
              BIP32 Root Fingerprint
            </label>
            <input
              type="text"
              className={fieldClass}
              value={fingerprint}
              placeholder="8 hex chars"
              onChange={(e) => setFingerprint(e.target.value)}
            />
          </div>
          {formError && (
            <p className="text-sm text-red-400 break-words">{formError}</p>
          )}
          <div className="flex gap-2 pt-0.5">
            <button
              type="button"
              className="text-xs bg-blue-700 hover:bg-blue-600 text-white py-1 px-3 rounded cursor-pointer"
              onClick={handleAdd}
            >
              Add
            </button>
            <button
              type="button"
              className="text-xs text-gray-400 hover:text-white cursor-pointer"
              onClick={() => {
                setShowForm(false);
                setFormError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 && !showForm && (
        <p className="text-[10px] text-gray-400 italic">No master public keys in PSBT globals.</p>
      )}
    </div>
  );
}
