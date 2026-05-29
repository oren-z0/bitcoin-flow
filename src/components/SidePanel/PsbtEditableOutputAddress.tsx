import { useEffect, useState } from 'react';
import { updatePsbtOutputAddress } from '../../utils/psbt';

const fieldClass =
  'w-full text-xs bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-gray-500 font-mono break-all';

interface Props {
  psbtBase64: string;
  outputIndex: number;
  address: string;
  addressColor?: string;
  onPsbtUpdated: (newBase64: string) => void;
  onError: (message: string) => void;
  onAddressClick?: (address: string) => void;
}

export default function PsbtEditableOutputAddress({
  psbtBase64,
  outputIndex,
  address,
  addressColor,
  onPsbtUpdated,
  onError,
  onAddressClick,
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
      onPsbtUpdated(updatePsbtOutputAddress(psbtBase64, outputIndex, trimmed));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Invalid address');
      setDraft(address);
    }
  };

  return (
    <input
      type="text"
      className={fieldClass}
      style={{ color: addressColor || '#9ca3af' }}
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
      onDoubleClick={() => {
        const trimmed = draft.trim();
        if (trimmed && onAddressClick) onAddressClick(trimmed);
      }}
    />
  );
}
