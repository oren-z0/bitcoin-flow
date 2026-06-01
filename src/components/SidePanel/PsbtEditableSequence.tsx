import { useEffect, useState } from 'react';
import {
  formatSequenceHex,
  inputSequenceHintSuffix,
  parseSequenceValue,
  SEQUENCE_PARSE_ERROR,
  SEQUENCE_VALUE_FORMAT_HINT,
} from '../../utils/sequence';
import { updatePsbtInputSequence } from '../../utils/psbt';

const fieldClass =
  'text-xs bg-gray-900 border border-gray-600 rounded px-1 py-0.5 text-gray-200 font-mono w-[9.5rem] focus:outline-none focus:border-gray-500';

interface Props {
  psbtBase64: string;
  inputIndex: number;
  txVersion: number;
  sequence: number;
  onPsbtUpdated: (newBase64: string) => void;
  onError: (message: string) => void;
}

export default function PsbtEditableSequence({
  psbtBase64,
  inputIndex,
  txVersion,
  sequence,
  onPsbtUpdated,
  onError,
}: Props) {
  const fieldKey = `${psbtBase64}:${inputIndex}`;
  const [draft, setDraft] = useState(() => formatSequenceHex(sequence));

  useEffect(() => {
    setDraft(formatSequenceHex(sequence));
  }, [fieldKey, sequence]);

  const commit = () => {
    const currentHex = formatSequenceHex(sequence);
    if (draft.trim() === currentHex) return;

    try {
      const next = parseSequenceValue(draft);
      if (next === (sequence >>> 0)) {
        setDraft(currentHex);
        return;
      }
      onPsbtUpdated(updatePsbtInputSequence(psbtBase64, inputIndex, next));
      setDraft(formatSequenceHex(next));
    } catch (e) {
      onError(e instanceof Error ? e.message : SEQUENCE_PARSE_ERROR);
      setDraft(currentHex);
    }
  };

  const hintSuffix = inputSequenceHintSuffix(txVersion, sequence).trim();

  return (
    <div className="text-gray-400 font-mono">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
        <span>Sequence:</span>
        <input
          type="text"
          className={fieldClass}
          value={draft}
          spellCheck={false}
          aria-label={`Input ${inputIndex} sequence`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              setDraft(formatSequenceHex(sequence));
              e.currentTarget.blur();
            }
          }}
        />
      </div>
      {hintSuffix ? <div className="mt-0.5 text-gray-500">{hintSuffix}</div> : null}
      <div className="mt-0.5 text-[10px] text-gray-500">{SEQUENCE_VALUE_FORMAT_HINT}</div>
    </div>
  );
}
