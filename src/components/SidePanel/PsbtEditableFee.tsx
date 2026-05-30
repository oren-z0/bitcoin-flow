import { useRef, useState } from 'react';
import { satsToBtc, btcToSats, formatFeeRate } from '../../utils/formatting';
import { updatePsbtOutputAmount } from '../../utils/psbt';
import type { MempoolVout } from '../../types';

type FeeMode = 'fee' | 'feerate';

const selectClass =
  'text-xs bg-gray-900 border border-gray-600 rounded px-1 py-0.5 text-gray-200 focus:outline-none focus:border-gray-500 cursor-pointer';
const inputClass =
  'text-xs bg-gray-900 border border-gray-600 rounded px-1 py-0.5 text-gray-200 font-mono w-28 focus:outline-none focus:border-gray-500';

interface Props {
  psbtBase64: string;
  fee: number;
  weight: number;
  vout: MempoolVout[];
  feeIsNegative: boolean;
  onPsbtUpdated: (newBase64: string) => void;
}

/** Indices of outputs that can absorb a fee change (everything except OP_RETURN). */
function editableOutputIndices(vout: MempoolVout[]): number[] {
  return vout
    .map((v, i) => (v.scriptpubkey_type === 'op_return' ? -1 : i))
    .filter(i => i >= 0);
}

/** sat/vB → target absolute fee in sats (weight is unchanged by amount edits). */
function feeRateToFee(rate: number, weight: number): number {
  return Math.round((rate * weight) / 4);
}

function parseFeeRate(input: string): number {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error('Fee rate must be a non-negative number (sat/vB)');
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('Fee rate must be a non-negative number (sat/vB)');
  }
  return n;
}

export default function PsbtEditableFee({
  psbtBase64,
  fee,
  weight,
  vout,
  feeIsNegative,
  onPsbtUpdated,
}: Props) {
  const indices = editableOutputIndices(vout);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<FeeMode>('fee');
  const [value, setValue] = useState('');
  const [outputIndex, setOutputIndex] = useState(indices[0] ?? 0);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const currentValueFor = (m: FeeMode) =>
    m === 'fee' ? satsToBtc(fee) : formatFeeRate(fee, weight);

  const open = (m: FeeMode) => {
    setMode(m);
    setValue(currentValueFor(m));
    setOutputIndex(prev => (indices.includes(prev) ? prev : indices[0] ?? 0));
    setError(null);
    setEditing(true);
  };

  const close = () => {
    setEditing(false);
    setError(null);
  };

  const changeMode = (m: FeeMode) => {
    setMode(m);
    setValue(currentValueFor(m));
    setError(null);
  };

  const commit = () => {
    setError(null);

    let targetFee: number;
    try {
      targetFee = mode === 'fee' ? btcToSats(value) : feeRateToFee(parseFeeRate(value), weight);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid value');
      setValue(currentValueFor(mode));
      return;
    }

    const oldAmount = vout[outputIndex]?.value ?? 0;
    const newAmount = oldAmount + (fee - targetFee);

    if (!Number.isSafeInteger(newAmount) || newAmount < 0) {
      setError(
        `Output #${outputIndex} would need a negative amount (${satsToBtc(newAmount)} BTC) to reach this ${
          mode === 'fee' ? 'fee' : 'fee rate'
        }. Pick another output or a smaller value.`
      );
      setValue(currentValueFor(mode));
      return;
    }

    try {
      onPsbtUpdated(updatePsbtOutputAmount(psbtBase64, outputIndex, newAmount));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update output amount');
      setValue(currentValueFor(mode));
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // Don't commit when focus moves to one of the form's own controls (e.g. the
    // mode or output-index selects) — only when the user truly leaves the form.
    if (formRef.current && e.relatedTarget && formRef.current.contains(e.relatedTarget as Node)) {
      return;
    }
    commit();
  };

  const valueColor = feeIsNegative ? 'text-red-400' : undefined;

  if (!editing) {
    return (
      <>
        <div className="flex justify-between">
          <button
            type="button"
            className="text-gray-400 underline decoration-dotted hover:text-white cursor-pointer"
            onClick={() => open('fee')}
            title="Edit fee"
          >
            Fee
          </button>
          <span className={valueColor}>{satsToBtc(fee)} BTC</span>
        </div>
        <div className="flex justify-between">
          <button
            type="button"
            className="text-gray-400 underline decoration-dotted hover:text-white cursor-pointer"
            onClick={() => open('feerate')}
            title="Edit fee rate"
          >
            Fee rate
          </button>
          <span className={valueColor}>{formatFeeRate(fee, weight)} sat/vB</span>
        </div>
      </>
    );
  }

  return (
    <div ref={formRef} className="space-y-1.5 py-1">
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <select
            className={selectClass}
            value={mode}
            aria-label="Edit fee or fee rate"
            onChange={(e) => changeMode(e.target.value as FeeMode)}
          >
            <option value="fee">Fee</option>
            <option value="feerate">Fee Rate</option>
          </select>
          <input
            type="text"
            className={inputClass}
            value={value}
            spellCheck={false}
            autoFocus
            aria-label={mode === 'fee' ? 'Fee (BTC)' : 'Fee rate (sat/vB)'}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                close();
              }
            }}
          />
          <span className="text-gray-400 shrink-0">{mode === 'fee' ? 'BTC' : 'sat/vB'}</span>
        </div>
        <button
          type="button"
          className="shrink-0 text-gray-400 hover:text-white cursor-pointer px-1"
          onClick={close}
          title="Close"
          aria-label="Close fee editor"
        >
          ✕
        </button>
      </div>

      <div className="flex items-center gap-1">
        <label className="text-gray-400 shrink-0">Update Output Index</label>
        <select
          className={selectClass}
          value={outputIndex}
          aria-label="Update output index"
          onChange={(e) => {
            setOutputIndex(Number(e.target.value));
            setError(null);
          }}
        >
          {indices.map(i => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="text-red-400 break-words">{error}</div>}
    </div>
  );
}
