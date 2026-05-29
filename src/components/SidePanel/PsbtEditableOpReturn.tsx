import { useEffect, useState } from 'react';
import { opReturnPayloadForEdit } from '../../utils/opReturn';
import { updatePsbtOpReturnPayload } from '../../utils/psbt';

const fieldClass =
  'w-full text-xs bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-gray-500 font-mono break-all';

interface Props {
  psbtBase64: string;
  outputIndex: number;
  scriptpubkey: string | undefined;
  onPsbtUpdated: (newBase64: string) => void;
  onError: (message: string) => void;
}

export default function PsbtEditableOpReturn({
  psbtBase64,
  outputIndex,
  scriptpubkey,
  onPsbtUpdated,
  onError,
}: Props) {
  const fieldKey = `${psbtBase64}:${outputIndex}`;
  const [draft, setDraft] = useState(() => opReturnPayloadForEdit(scriptpubkey));

  useEffect(() => {
    setDraft(opReturnPayloadForEdit(scriptpubkey));
  }, [fieldKey, scriptpubkey]);

  const commit = () => {
    const current = opReturnPayloadForEdit(scriptpubkey);
    if (draft.trim() === current.trim()) return;

    try {
      onPsbtUpdated(updatePsbtOpReturnPayload(psbtBase64, outputIndex, draft));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Invalid OP_RETURN data');
      setDraft(current);
    }
  };

  return (
    <div className="space-y-0.5">
      <label className="text-[10px] text-gray-500 block">Data (text or hex)</label>
      <textarea
        className={`${fieldClass} min-h-[3rem] resize-y`}
        value={draft}
        spellCheck={false}
        placeholder="Text or hex (max 80 bytes)"
        aria-label={`Output ${outputIndex} OP_RETURN data`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft(opReturnPayloadForEdit(scriptpubkey));
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
