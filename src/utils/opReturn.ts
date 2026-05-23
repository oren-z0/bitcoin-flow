/** Decode UTF-8 payload from an OP_RETURN scriptpubkey hex string (starts with 6a). */
export function decodeOpReturnContent(scriptpubkey: string | undefined): string {
  if (!scriptpubkey || !scriptpubkey.startsWith('6a')) return '';

  let i = 2;
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

  if (chunks.length === 0) return '';

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder('utf-8', { fatal: false }).decode(combined);
}
