import { useEffect, useState } from 'react';
import { readPsbtIoDerivation, updatePsbtOutputAddress } from '../../utils/psbt';

const inputClass =
  'flex-1 min-w-0 text-xs bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-gray-500 font-mono break-all';

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

interface Props {
  psbtBase64: string;
  outputIndex: number;
  address: string;
  onPsbtUpdated: (newBase64: string, meta?: { preservedFingerprint?: string }) => void;
  onError: (message: string) => void;
  onAddressInfo?: (address: string) => void;
}

export default function PsbtEditableOutputAddress({
  psbtBase64,
  outputIndex,
  address,
  onPsbtUpdated,
  onError,
  onAddressInfo,
}: Props) {
  const fieldKey = `${psbtBase64}:${outputIndex}`;
  const [draft, setDraft] = useState(address);

  useEffect(() => {
    setDraft(address);
  }, [fieldKey, address]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === address) return;

    try {
      const preservedFingerprint = readPsbtIoDerivation(
        psbtBase64,
        'output',
        outputIndex
      ).fingerprint;
      const updated = updatePsbtOutputAddress(psbtBase64, outputIndex, trimmed);
      onPsbtUpdated(
        updated,
        preservedFingerprint ? { preservedFingerprint } : undefined
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Invalid address');
      setDraft(address);
    }
  };

  const trimmed = draft.trim();
  const canOpenInfo = !!trimmed && !!onAddressInfo;

  return (
    <div>
      <label className="text-[10px] text-gray-500 block mb-0.5">Address</label>
      <div className="flex items-start gap-1">
        <input
          type="text"
          className={inputClass}
          value={draft}
          spellCheck={false}
          placeholder="Bitcoin address"
          aria-label={`Output ${outputIndex} address`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              setDraft(address);
              e.currentTarget.blur();
            }
          }}
        />
        {onAddressInfo && (
          <button
            type="button"
            className="shrink-0 p-1 mt-0.5 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            title="Address details"
            aria-label="Open address details"
            disabled={!canOpenInfo}
            onClick={() => {
              if (canOpenInfo) onAddressInfo(trimmed);
            }}
          >
            <InfoIcon />
          </button>
        )}
      </div>
    </div>
  );
}
