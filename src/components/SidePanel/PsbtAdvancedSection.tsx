import { useMemo, useState } from 'react';
import {
  psbtAdvancedHasContent,
  readPsbtAdvancedMeta,
  type PsbtIoAdvancedDisplay,
} from '../../utils/psbt';
import PsbtReadOnlyField from './PsbtReadOnlyField';

function IoAdvancedBlock({
  title,
  advanced,
}: {
  title: string;
  advanced: PsbtIoAdvancedDisplay;
}) {
  if (!Object.keys(advanced).length) return null;

  return (
    <div className="bg-gray-800/60 rounded p-2 space-y-1.5">
      <div className="text-[10px] font-semibold text-gray-400 uppercase">{title}</div>
      {advanced.pubkey && <PsbtReadOnlyField label="Public key" value={advanced.pubkey} />}
      {advanced.sighashType && (
        <PsbtReadOnlyField label="Sighash type" value={advanced.sighashType} />
      )}
      {advanced.finalizedInput && (
        <div className="text-[11px] text-gray-400">Input finalized (finalScriptSig present)</div>
      )}
      {advanced.partialSigCount !== undefined && advanced.partialSigCount > 0 && (
        <div className="text-[11px] text-gray-400">
          Partial signatures: {advanced.partialSigCount}
        </div>
      )}
      {advanced.tapInternalKey && (
        <PsbtReadOnlyField label="Tap internal key" value={advanced.tapInternalKey} />
      )}
      {advanced.tapBip32DerivationCount !== undefined && advanced.tapBip32DerivationCount > 0 && (
        <div className="text-[11px] text-gray-400">
          Tap BIP32 derivations: {advanced.tapBip32DerivationCount}
        </div>
      )}
      {advanced.redeemScript && (
        <PsbtReadOnlyField label="Redeem script" value={advanced.redeemScript} />
      )}
      {advanced.witnessScript && (
        <PsbtReadOnlyField label="Witness script" value={advanced.witnessScript} />
      )}
    </div>
  );
}

interface Props {
  psbtBase64: string;
}

export default function PsbtAdvancedSection({ psbtBase64 }: Props) {
  const [open, setOpen] = useState(false);

  const meta = useMemo(() => readPsbtAdvancedMeta(psbtBase64), [psbtBase64]);
  const hasExtra = psbtAdvancedHasContent(meta);

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="inline-block w-3 text-center">{open ? '▼' : '▶'}</span>
        Advanced
        {!hasExtra && (
          <span className="text-gray-500 font-normal">(PSBT v{meta.psbtVersion} only)</span>
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-2 pl-1">
          <div className="text-[11px] text-gray-400">
            PSBT version: <span className="text-gray-200">{meta.psbtVersion}</span>
          </div>

          {meta.globalXpubs.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold text-gray-400 uppercase">
                Global extended public keys
              </div>
              {meta.globalXpubs.map((xpub, i) => (
                <div key={i} className="bg-gray-800/60 rounded p-2 space-y-1.5">
                  <div className="text-[10px] text-gray-500">XPUB {i + 1}</div>
                  <PsbtReadOnlyField label="Fingerprint" value={xpub.fingerprint} />
                  <PsbtReadOnlyField label="Path prefix" value={xpub.path || 'm'} />
                  <div className="text-[11px] text-gray-400">Depth: {xpub.depth}</div>
                  <PsbtReadOnlyField label="Public key (from xpub)" value={xpub.publicKey} />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-gray-500 italic">No PSBT_GLOBAL_XPUB entries</div>
          )}

          {meta.inputs.map((inp, i) => (
            <IoAdvancedBlock key={`in-${i}`} title={`Input ${i}`} advanced={inp} />
          ))}
          {meta.outputs.map((out, i) => (
            <IoAdvancedBlock key={`out-${i}`} title={`Output ${i}`} advanced={out} />
          ))}
        </div>
      )}
    </div>
  );
}
