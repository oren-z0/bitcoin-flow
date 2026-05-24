import { useEffect, useState } from 'react';
import {
  formatSequenceHex,
  inputSequenceHintSuffix,
  parseSequenceValue,
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => formatSequenceHex(sequence));

  useEffect(() => {
    if (!editing) {
      setDraft(formatSequenceHex(sequence));
    }
  }, [fieldKey, sequence, editing]);

  const commit = () => {
    setEditing(false);
    const currentHex = formatSequenceHex(sequence);
    if (draft.trim() === currentHex) return;

    try {
      const next = parseSequenceValue(draft);
      if (next === (sequence >>> 0)) return;
      onPsbtUpdated(updatePsbtInputSequence(psbtBase64, inputIndex, next));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Invalid sequence');
      setDraft(currentHex);
    }
  };

  const suffix = inputSequenceHintSuffix(txVersion, sequence);

  if (editing) {
    return (
      <span>
        Sequence:{' '}
        <input
          type="text"
          className={fieldClass}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              setDraft(formatSequenceHex(sequence));
              setEditing(false);
            }
          }}
        />
        {suffix}
      </span>
    );
  }

  return (
    <span>
      Sequence:{' '}
      <button
        type="button"
        className="text-gray-300 hover:text-white underline decoration-dotted underline-offset-2 cursor-pointer font-mono"
        onClick={() => {
          setDraft(formatSequenceHex(sequence));
          setEditing(true);
        }}
      >
        {formatSequenceHex(sequence)}
      </button>
      {suffix}
    </span>
  );
}
