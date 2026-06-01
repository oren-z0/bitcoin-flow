import { useEffect, useState } from 'react';
import {
  isLocktimeDisabled,
  LOCKTIME_PARSE_ERROR,
  LOCKTIME_VALUE_FORMAT_HINT,
  locktimeDraftDisplay,
  parseLocktimeValue,
} from '../../utils/sequence';
import { updatePsbtLocktime } from '../../utils/psbt';
import type { MempoolVin } from '../../types';

const fieldClass =
  'text-xs bg-gray-900 border border-gray-600 rounded px-1 py-0.5 text-gray-200 font-mono w-[11.5rem] text-right focus:outline-none focus:border-gray-500';

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
  const [draft, setDraft] = useState(() => locktimeDraftDisplay(locktime));

  useEffect(() => {
    setDraft(locktimeDraftDisplay(locktime));
  }, [fieldKey, locktime]);

  const disabledSuffix = isLocktimeDisabled(vin) ? ' (disabled)' : '';

  const commit = () => {
    const canonical = locktimeDraftDisplay(locktime);
    if (draft.trim() === canonical || draft.trim() === String(locktime)) return;

    try {
      const next = parseLocktimeValue(draft);
      if (next === locktime) {
        setDraft(canonical);
        return;
      }
      onPsbtUpdated(updatePsbtLocktime(psbtBase64, next));
      setDraft(locktimeDraftDisplay(next));
    } catch (e) {
      onError(e instanceof Error ? e.message : LOCKTIME_PARSE_ERROR);
      setDraft(canonical);
    }
  };

  return (
    <span className="flex flex-col items-end gap-0.5">
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
              setDraft(locktimeDraftDisplay(locktime));
              e.currentTarget.blur();
            }
          }}
        />
        {disabledSuffix}
      </span>
      <span className="text-[10px] text-gray-500 max-w-[11.5rem] self-stretch text-left">
        {LOCKTIME_VALUE_FORMAT_HINT}
      </span>
    </span>
  );
}
