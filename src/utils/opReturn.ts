function extractOpReturnPayload(scriptpubkey: string): Uint8Array {
  let i = 2; // skip OP_RETURN (6a)
  const chunks: Uint8Array[] = [];

  while (i < scriptpubkey.length) {
    const opcode = parseInt(scriptpubkey.slice(i, i + 2), 16);
    i += 2;

    let pushLen: number;
    if (opcode >= 0x01 && opcode <= 0x4b) {
      pushLen = opcode;
    } else if (opcode === 0x4c) {
      pushLen = parseInt(scriptpubkey.slice(i, i + 2), 16);
      i += 2;
    } else if (opcode === 0x4d) {
      pushLen = parseInt(scriptpubkey.slice(i + 2, i + 4) + scriptpubkey.slice(i, i + 2), 16);
      i += 4;
    } else if (opcode === 0x4e) {
      const lenHex = scriptpubkey.slice(i, i + 6);
      pushLen = parseInt(lenHex.slice(4, 6) + lenHex.slice(2, 4) + lenHex.slice(0, 2), 16);
      i += 6;
    } else if (opcode >= 0x51 && opcode <= 0x60) {
      continue;
    } else {
      break;
    }

    const hex = scriptpubkey.slice(i, i + pushLen * 2);
    if (hex.length < pushLen * 2) break;
    i += pushLen * 2;

    const bytes = new Uint8Array(pushLen);
    for (let j = 0; j < pushLen; j++) {
      bytes[j] = parseInt(hex.slice(j * 2, j * 2 + 2), 16);
    }
    chunks.push(bytes);
  }

  if (chunks.length === 0) return new Uint8Array(0);

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

function isMostlyPrintable(text: string): boolean {
  if (!text) return false;
  let printable = 0;
  for (const c of text) {
    const code = c.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 0xfffd)) {
      printable++;
    }
  }
  return printable / [...text].length >= 0.85;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** Format OP_RETURN payload as UTF-8 text, or hex when not printable. */
export function formatOpReturnDisplay(scriptpubkey: string | undefined): string {
  if (!scriptpubkey?.startsWith('6a')) return '';

  const bytes = extractOpReturnPayload(scriptpubkey);
  if (bytes.length === 0) return `hex: ${scriptpubkey.slice(2)}`;

  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (isMostlyPrintable(text)) return `string: ${text}`;

  return `hex: ${bytesToHex(bytes)}`;
}

export type OpReturnEditMode = 'text' | 'hex';

export function opReturnPayloadBytes(scriptpubkey: string | undefined): Uint8Array {
  if (!scriptpubkey?.startsWith('6a')) return new Uint8Array(0);
  return extractOpReturnPayload(scriptpubkey);
}

export function opReturnDraftFromBytes(bytes: Uint8Array, mode: OpReturnEditMode): string {
  if (bytes.length === 0) return '';
  if (mode === 'hex') return bytesToHex(bytes);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function parseHexPayload(hexStr: string): Uint8Array {
  const cleaned = hexStr.replace(/\s/g, '').replace(/^0x/i, '');
  if (!cleaned) return new Uint8Array(0);
  if (!/^[0-9a-f]*$/i.test(cleaned) || cleaned.length % 2 !== 0) {
    throw new Error('Invalid hex payload');
  }
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Parse edit field using the selected Text or Hex mode (no format guessing). */
export function parseOpReturnEditDraft(draft: string, mode: OpReturnEditMode): Uint8Array {
  const trimmed = draft.trim();
  if (!trimmed) return new Uint8Array(0);
  if (mode === 'hex') {
    return parseHexPayload(trimmed);
  }
  return new TextEncoder().encode(trimmed);
}

/** Build `OP_RETURN <pushdata> payload` script bytes. */
export function encodeOpReturnScript(payload: Uint8Array): Uint8Array {
  const MAX_STANDARD = 80;
  if (payload.length > MAX_STANDARD) {
    throw new Error(`OP_RETURN payload cannot exceed ${MAX_STANDARD} bytes`);
  }

  const script: number[] = [0x6a];
  let offset = 0;

  while (offset < payload.length) {
    const chunkLen = Math.min(payload.length - offset, 75);
    script.push(chunkLen);
    for (let i = 0; i < chunkLen; i++) {
      script.push(payload[offset++]);
    }
  }

  return Uint8Array.from(script);
}
