import { useEffect, useState } from 'react';
import { btcToSats, satsToBtc } from '../../utils/formatting';
import { updatePsbtOutputAmount } from '../../utils/psbt';

const fieldClass =
  'text-xs bg-gray-900 border border-gray-600 rounded px-1 py-0.5 text-gray-200 font-mono w-[9.5rem] focus:outline-none focus:border-gray-500';

interface Props {
  psbtBase64: string;
  outputIndex: number;
  valueSats: number;
  onPsbtUpdated: (newBase64: string) => void;
  onError: (message: string) => void;
}

export default function PsbtEditableOutputAmount({
  psbtBase64,
  outputIndex,
  valueSats,
  onPsbtUpdated,
  onError,
}: Props) {
  const fieldKey = `${psbtBase64}:${outputIndex}`;
  const [draft, setDraft] = useState(() => satsToBtc(valueSats));

  useEffect(() => {
    setDraft(satsToBtc(valueSats));
  }, [fieldKey, valueSats]);

  const commit = () => {
    const currentBtc = satsToBtc(valueSats);
    try {
      const nextSats = btcToSats(draft);
      if (nextSats < 0) throw new Error('Output amount cannot be negative');
      const formatted = satsToBtc(nextSats);
      setDraft(formatted);
      if (nextSats !== valueSats) {
        onPsbtUpdated(updatePsbtOutputAmount(psbtBase64, outputIndex, nextSats));
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Invalid amount');
      setDraft(currentBtc);
    }
  };

  return (
    <div>
      <label className="text-[10px] text-gray-400 block mb-0.5">Amount</label>
      <span className="inline-flex items-center gap-1 text-gray-300">
        <input
          type="text"
          className={fieldClass}
          value={draft}
          spellCheck={false}
          aria-label={`Output ${outputIndex} amount in BTC`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              setDraft(satsToBtc(valueSats));
              e.currentTarget.blur();
            }
          }}
        />
        <span>BTC</span>
      </span>
    </div>
  );
}
