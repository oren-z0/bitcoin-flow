import { btcToSats, satsToBtc } from './formatting';
import {
  opReturnDraftFromBytes,
  opReturnPayloadBytes,
  parseOpReturnEditDraft,
  type OpReturnEditMode,
} from './opReturn';
import { formatSequenceHex, parseSequenceValue } from './sequence';
import {
  PSBT_INPUT_SCRIPT_TYPES,
  PSBT_OUTPUT_SCRIPT_TYPES,
  PSBT_SCRIPT_TYPE_LABELS,
  addressFromPubkeyAndScriptKind,
  canPersistPsbtIoDerivation,
  readPsbtIoDerivation,
  readPsbtIoPubkey,
  readPsbtIoScriptType,
  updatePsbtIoDerivation,
  updatePsbtOpReturnPayload,
  updatePsbtOutputAddress,
  updatePsbtOutputAmount,
  updatePsbtOutputScriptKind,
  updatePsbtInputSequence,
  validateFingerprintField,
  validatePathField,
  validatePubkeyField,
  type PsbtScriptKind,
} from './psbt';

export type PsbtIoFormDraft = {
  scriptType: PsbtScriptKind;
  fingerprint: string;
  path: string;
  pubkey: string;
  address: string;
  amountBtc: string;
  opReturnDraft: string;
  opReturnMode: OpReturnEditMode;
  sequenceHex: string;
};

export type PsbtIoFormMempoolContext = {
  address?: string;
  amountSats?: number;
  scriptpubkey?: string;
  sequence?: number;
};

export function scriptTypeOptions(
  kind: 'input' | 'output',
  current: PsbtScriptKind
): PsbtScriptKind[] {
  const base = kind === 'input' ? PSBT_INPUT_SCRIPT_TYPES : PSBT_OUTPUT_SCRIPT_TYPES;
  if (base.includes(current)) return base;
  return [current, ...base];
}

export function loadPsbtIoFormDraft(
  psbtBase64: string,
  kind: 'input' | 'output',
  index: number,
  mempool?: PsbtIoFormMempoolContext
): PsbtIoFormDraft {
  const der = readPsbtIoDerivation(psbtBase64, kind, index);
  const scriptType = readPsbtIoScriptType(psbtBase64, kind, index);
  const opBytes =
    kind === 'output' ? opReturnPayloadBytes(mempool?.scriptpubkey) : new Uint8Array(0);

  return {
    scriptType,
    fingerprint: der.fingerprint,
    path: der.path,
    pubkey: readPsbtIoPubkey(psbtBase64, kind, index) ?? '',
    address: mempool?.address ?? '',
    amountBtc: satsToBtc(mempool?.amountSats ?? 0),
    opReturnDraft: opReturnDraftFromBytes(opBytes, 'text'),
    opReturnMode: 'text',
    sequenceHex:
      kind === 'input' && mempool?.sequence !== undefined
        ? formatSequenceHex(mempool.sequence)
        : '',
  };
}

function derivationFieldErrors(draft: Pick<PsbtIoFormDraft, 'fingerprint' | 'path' | 'pubkey'>): string[] {
  const errors: string[] = [];
  const fpErr = validateFingerprintField(draft.fingerprint);
  const pathErr = validatePathField(draft.path, draft.fingerprint);
  const pkErr = validatePubkeyField(draft.pubkey);
  if (fpErr) errors.push(fpErr);
  if (pathErr) errors.push(pathErr);
  if (pkErr) errors.push(pkErr);
  return errors;
}

function hasAnyDerivation(draft: Pick<PsbtIoFormDraft, 'fingerprint' | 'path' | 'pubkey'>): boolean {
  return !!(draft.fingerprint.trim() || draft.path.trim() || draft.pubkey.trim());
}

function hasAllDerivation(draft: Pick<PsbtIoFormDraft, 'fingerprint' | 'path' | 'pubkey'>): boolean {
  return !!(
    draft.fingerprint.trim() &&
    draft.path.trim() &&
    draft.pubkey.trim()
  );
}

export function validatePsbtOutputFormDraft(
  psbtBase64: string,
  index: number,
  draft: PsbtIoFormDraft
): string[] {
  const errors: string[] = [];
  const currentType = readPsbtIoScriptType(psbtBase64, 'output', index);

  if (draft.scriptType === 'op_return') {
    try {
      parseOpReturnEditDraft(draft.opReturnDraft, draft.opReturnMode);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'Invalid OP_RETURN data');
    }
    return errors;
  }

  try {
    const sats = btcToSats(draft.amountBtc);
    if (sats < 0) errors.push('Output amount cannot be negative');
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'Invalid amount');
  }

  const addr = draft.address.trim();
  if (!addr && !draft.pubkey.trim()) {
    errors.push('Address or public key is required for payment outputs');
  }

  if (hasAnyDerivation(draft)) {
    errors.push(...derivationFieldErrors(draft));
    if (!hasAllDerivation(draft)) {
      errors.push(
        'Derivation requires master fingerprint, path, and public key together, or leave all three empty'
      );
    }
  }

  if (draft.scriptType !== currentType) {
    if (currentType === 'op_return' && !addr && !draft.pubkey.trim()) {
      errors.push('Address or public key is required when switching from OP_RETURN');
    } else if (
      !draft.pubkey.trim() &&
      !canPersistPsbtIoDerivation(
        psbtBase64,
        'output',
        index,
        draft.fingerprint,
        draft.path,
        undefined,
        draft.scriptType
      )
    ) {
      errors.push(
        `Public key is required to change script type to ${PSBT_SCRIPT_TYPE_LABELS[draft.scriptType]}`
      );
    }
  }

  return errors;
}

export function validatePsbtInputFormDraft(
  psbtBase64: string,
  index: number,
  draft: PsbtIoFormDraft,
  parentOutputAddress?: string
): string[] {
  const errors: string[] = [];
  const currentType = readPsbtIoScriptType(psbtBase64, 'input', index);

  try {
    parseSequenceValue(draft.sequenceHex);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'Invalid sequence');
  }

  if (hasAnyDerivation(draft)) {
    errors.push(...derivationFieldErrors(draft));
    if (!hasAllDerivation(draft)) {
      errors.push(
        'Derivation requires master fingerprint, path, and public key together, or leave all three empty'
      );
    }
  }

  if (draft.scriptType !== currentType) {
    if (
      !draft.pubkey.trim() &&
      !canPersistPsbtIoDerivation(
        psbtBase64,
        'input',
        index,
        draft.fingerprint,
        draft.path,
        undefined,
        draft.scriptType
      )
    ) {
      errors.push(
        `Public key is required to change script type to ${PSBT_SCRIPT_TYPE_LABELS[draft.scriptType]}`
      );
    }
  }

  if (parentOutputAddress && hasAllDerivation(draft) && derivationFieldErrors(draft).length === 0) {
    const derived = addressFromPubkeyAndScriptKind(draft.pubkey.trim(), draft.scriptType);
    if (
      derived &&
      derived.toLowerCase() !== parentOutputAddress.toLowerCase()
    ) {
      errors.push(
        `Address derived from public key (${derived}) differs from the previous output (${parentOutputAddress})`
      );
    }
  }

  return errors;
}

export function applyPsbtOutputFormDraft(
  psbtBase64: string,
  index: number,
  draft: PsbtIoFormDraft
): string {
  let b64 = psbtBase64;
  const currentType = readPsbtIoScriptType(b64, 'output', index);

  if (draft.scriptType !== currentType) {
    if (draft.scriptType === 'op_return') {
      b64 = updatePsbtOutputScriptKind(b64, index, 'op_return');
    } else if (currentType === 'op_return') {
      if (draft.address.trim()) {
        b64 = updatePsbtOutputAddress(b64, index, draft.address.trim());
      } else {
        b64 = updatePsbtIoDerivation(
          b64,
          'output',
          index,
          draft.fingerprint,
          draft.path,
          draft.pubkey.trim(),
          draft.scriptType
        );
      }
    } else if (draft.pubkey.trim()) {
      b64 = updatePsbtIoDerivation(
        b64,
        'output',
        index,
        draft.fingerprint,
        draft.path,
        draft.pubkey.trim(),
        draft.scriptType
      );
    } else {
      b64 = updatePsbtIoDerivation(
        b64,
        'output',
        index,
        draft.fingerprint,
        draft.path,
        undefined,
        draft.scriptType
      );
    }
  }

  if (draft.scriptType === 'op_return') {
    return updatePsbtOpReturnPayload(b64, index, draft.opReturnDraft, draft.opReturnMode);
  }

  const amountSats = btcToSats(draft.amountBtc);
  b64 = updatePsbtOutputAmount(b64, index, amountSats);
  if (draft.address.trim()) {
    b64 = updatePsbtOutputAddress(b64, index, draft.address.trim());
  }

  if (hasAnyDerivation(draft)) {
    b64 = updatePsbtIoDerivation(
      b64,
      'output',
      index,
      draft.fingerprint,
      draft.path,
      draft.pubkey.trim(),
      draft.scriptType
    );
  } else if (!hasAnyDerivation(draft)) {
    b64 = updatePsbtIoDerivation(
      b64,
      'output',
      index,
      '',
      '',
      undefined,
      draft.scriptType
    );
  }

  return b64;
}

export function applyPsbtInputFormDraft(
  psbtBase64: string,
  index: number,
  draft: PsbtIoFormDraft,
  savedSequence: number
): string {
  let b64 = psbtBase64;
  const nextSeq = parseSequenceValue(draft.sequenceHex);
  if (nextSeq !== (savedSequence >>> 0)) {
    b64 = updatePsbtInputSequence(b64, index, nextSeq);
  }

  const currentType = readPsbtIoScriptType(b64, 'input', index);
  const scriptChanged = draft.scriptType !== currentType;
  const derivationChanged =
    draft.fingerprint !== readPsbtIoDerivation(b64, 'input', index).fingerprint ||
    draft.path !== readPsbtIoDerivation(b64, 'input', index).path ||
    (draft.pubkey.trim() || '') !== (readPsbtIoPubkey(b64, 'input', index) ?? '');

  if (scriptChanged || derivationChanged || hasAnyDerivation(draft)) {
    if (hasAnyDerivation(draft)) {
      b64 = updatePsbtIoDerivation(
        b64,
        'input',
        index,
        draft.fingerprint,
        draft.path,
        draft.pubkey.trim() || undefined,
        draft.scriptType
      );
    } else {
      b64 = updatePsbtIoDerivation(
        b64,
        'input',
        index,
        '',
        '',
        undefined,
        draft.scriptType
      );
    }
  }

  return b64;
}

export function savePsbtOutputForm(
  psbtBase64: string,
  index: number,
  draft: PsbtIoFormDraft
): { ok: true; base64: string } | { ok: false; errors: string[] } {
  const errors = validatePsbtOutputFormDraft(psbtBase64, index, draft);
  if (errors.length) return { ok: false, errors };
  try {
    return { ok: true, base64: applyPsbtOutputFormDraft(psbtBase64, index, draft) };
  } catch (e) {
    return {
      ok: false,
      errors: [e instanceof Error ? e.message : 'Failed to update PSBT output'],
    };
  }
}

export function savePsbtInputForm(
  psbtBase64: string,
  index: number,
  draft: PsbtIoFormDraft,
  savedSequence: number,
  parentOutputAddress?: string
): { ok: true; base64: string } | { ok: false; errors: string[] } {
  const errors = validatePsbtInputFormDraft(psbtBase64, index, draft, parentOutputAddress);
  if (errors.length) return { ok: false, errors };
  try {
    return {
      ok: true,
      base64: applyPsbtInputFormDraft(psbtBase64, index, draft, savedSequence),
    };
  } catch (e) {
    return {
      ok: false,
      errors: [e instanceof Error ? e.message : 'Failed to update PSBT input'],
    };
  }
}
