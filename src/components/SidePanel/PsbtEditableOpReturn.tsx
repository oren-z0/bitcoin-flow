import { useEffect, useMemo, useState } from 'react';
import {
  opReturnDraftFromBytes,
  opReturnPayloadBytes,
  parseOpReturnEditDraft,
  type OpReturnEditMode,
} from '../../utils/opReturn';
import { updatePsbtOpReturnPayload } from '../../utils/psbt';

const fieldClass =
  'w-full text-xs bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 placeholder:text-gray-400 focus:outline-none focus:border-gray-500 font-mono break-all';

const SPAM_LINK_URL = 'https://www.youtube.com/watch?v=anwy2MPT5RE';
const OP_RETURN_STANDARD_MAX_BYTES = 80;

const modeButtonClass = (active: boolean) =>
  `text-[10px] px-2 py-0.5 rounded border cursor-pointer ${
    active
      ? 'bg-gray-600 border-gray-500 text-gray-100'
      : 'bg-gray-800 border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-500'
  }`;

interface Props {
  psbtBase64: string;
  outputIndex: number;
  scriptpubkey: string | undefined;
  onPsbtUpdated: (newBase64: string) => void;
  onError: (message: string) => void;
}

function payloadsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

export default function PsbtEditableOpReturn({
  psbtBase64,
  outputIndex,
  scriptpubkey,
  onPsbtUpdated,
  onError,
}: Props) {
  const fieldKey = `${psbtBase64}:${outputIndex}`;
  const [mode, setMode] = useState<OpReturnEditMode>('text');
  const [payloadBytes, setPayloadBytes] = useState(() =>
    copyBytes(opReturnPayloadBytes(scriptpubkey))
  );
  const [draft, setDraft] = useState(() =>
    opReturnDraftFromBytes(opReturnPayloadBytes(scriptpubkey), 'text')
  );

  useEffect(() => {
    const bytes = opReturnPayloadBytes(scriptpubkey);
    setPayloadBytes(copyBytes(bytes));
    setDraft(opReturnDraftFromBytes(bytes, mode));
  }, [fieldKey, scriptpubkey]);

  const switchMode = (next: OpReturnEditMode) => {
    if (next === mode) return;
    setMode(next);
    setDraft(opReturnDraftFromBytes(payloadBytes, next));
  };

  const revertToSaved = () => {
    const saved = opReturnPayloadBytes(scriptpubkey);
    setPayloadBytes(copyBytes(saved));
    setDraft(opReturnDraftFromBytes(saved, mode));
  };

  const commit = () => {
    const savedBytes = opReturnPayloadBytes(scriptpubkey);

    let draftBytes: Uint8Array;
    try {
      draftBytes = parseOpReturnEditDraft(draft, mode);
    } catch (e) {
      if (mode === 'hex') {
        onError(e instanceof Error ? e.message : 'Invalid hex payload');
        revertToSaved();
      }
      return;
    }

    setPayloadBytes(copyBytes(draftBytes));

    if (payloadsEqual(draftBytes, savedBytes)) return;

    try {
      onPsbtUpdated(updatePsbtOpReturnPayload(psbtBase64, outputIndex, draft, mode));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Invalid OP_RETURN data');
      revertToSaved();
    }
  };

  const resetDraft = () => {
    setDraft(opReturnDraftFromBytes(payloadBytes, mode));
  };

  const contentByteLength = useMemo(() => {
    try {
      return parseOpReturnEditDraft(draft, mode).length;
    } catch {
      return payloadBytes.length;
    }
  }, [draft, mode, payloadBytes]);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={modeButtonClass(mode === 'text')}
          aria-pressed={mode === 'text'}
          onClick={() => switchMode('text')}
        >
          Text
        </button>
        <button
          type="button"
          className={modeButtonClass(mode === 'hex')}
          aria-pressed={mode === 'hex'}
          onClick={() => switchMode('hex')}
        >
          Hex
        </button>
      </div>
      <textarea
        className={`${fieldClass} min-h-[3rem] resize-y`}
        value={draft}
        spellCheck={mode === 'text'}
        placeholder={mode === 'text' ? 'UTF-8 text' : 'Hex'}
        aria-label={`Output ${outputIndex} OP_RETURN data (${mode})`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            resetDraft();
            e.currentTarget.blur();
          }
        }}
      />
      {contentByteLength > OP_RETURN_STANDARD_MAX_BYTES && (
        <a
          href={SPAM_LINK_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-blue-400 hover:text-blue-300"
        >
          SPAM SPAM SPAM
        </a>
      )}
    </div>
  );
}
