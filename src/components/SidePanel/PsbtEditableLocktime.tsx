import { useEffect, useState } from 'react';
import { formatTimestamp } from '../../utils/formatting';
import { isLocktimeDisabled, parseLocktimeValue, showsAbsoluteLocktime } from '../../utils/sequence';
import { updatePsbtLocktime } from '../../utils/psbt';
import type { MempoolVin } from '../../types';

const fieldClass =
  'text-xs bg-gray-900 border border-gray-600 rounded px-1 py-0.5 text-gray-200 font-mono w-28 text-right focus:outline-none focus:border-gray-500';

interface Props {
  psbtBase64: string;
  locktime: number;
  vin: MempoolVin[];
  onPsbtUpdated: (newBase64: string) => void;
  onError: (message: string) => void;
}

export default function PsbtEditableLocktime({
  psbtBase64,
  locktime,
  vin,
  onPsbtUpdated,
  onError,
}: Props) {
  const fieldKey = `${psbtBase64}:${locktime}`;
  const [draft, setDraft] = useState(() => String(locktime));

  useEffect(() => {
    setDraft(String(locktime));
  }, [fieldKey, locktime]);

  const disabledSuffix = isLocktimeDisabled(vin) ? ' (disabled)' : '';
  const absoluteSuffix =
    showsAbsoluteLocktime(locktime, vin) ? ` (${formatTimestamp(locktime)})` : '';

  const commit = () => {
    if (draft.trim() === String(locktime)) return;

    try {
      const next = parseLocktimeValue(draft);
      if (next === locktime) return;
      onPsbtUpdated(updatePsbtLocktime(psbtBase64, next));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Invalid locktime');
      setDraft(String(locktime));
    }
  };

  return (
    <span className="flex flex-wrap items-center justify-end gap-1">
      <input
        type="text"
        className={fieldClass}
        value={draft}
        spellCheck={false}
        aria-label="Locktime"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            setDraft(String(locktime));
            e.currentTarget.blur();
          }
        }}
      />
      {absoluteSuffix}
      {disabledSuffix}
    </span>
  );
}
