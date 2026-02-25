import { HDKey } from '@scure/bip32';
import { p2pkh, p2wpkh, p2sh, p2tr } from '@scure/btc-signer';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';

export type XpubAddressFormat = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr';

const XPUB_VERSION = new Uint8Array([0x04, 0x88, 0xb2, 0x1e]);

// Convert any extended public key variant (ypub, zpub, Ypub, Zpub, etc.)
// to a standard xpub by replacing the 4-byte version prefix.
function normalizeToXpub(key: string): string {
  if (key.startsWith('xpub')) return key;
  const codec = base58check(sha256);
  const decoded = codec.decode(key); // 78 bytes
  if (decoded.length !== 78) throw new Error('Invalid extended public key length');
  const normalized = new Uint8Array(decoded);
  normalized.set(XPUB_VERSION, 0);
  return codec.encode(normalized);
}

// Recursively expand all ranges in a path template, returning every
// concrete path. Multiple ranges produce a cartesian product.
function expandRanges(ranges: number[][]): string[] {
  const [firstRange, ...restRanges] = ranges;
  if (restRanges.length === 0) return firstRange.map(String);
  return expandRanges(restRanges).flatMap(rest => firstRange.map(value => `${value}/${rest}`));
}

export interface DerivedAddress {
  address: string;
  path: string;
}

// Input format: "<xpub|ypub|zpub>/<path>" where path may contain {x...y} ranges.
// Example: "zpub.../0,1/0-10"
export function deriveAddressesFromXpub(
  input: string,
  format: XpubAddressFormat
): DerivedAddress[] {
  const trimmed = input.trim();
  const slashIdx = trimmed.indexOf('/');
  if (slashIdx === -1) throw new Error('Input must include a path after the key, e.g. xpub.../0,1/0-10');

  const extKey = trimmed.slice(0, slashIdx).trim();
  const pathTemplate = trimmed.slice(slashIdx + 1).trim();
  if (!pathTemplate) throw new Error('Path is empty');

  const xpub = normalizeToXpub(extKey);
  const hdKey = HDKey.fromExtendedKey(xpub);

  // Count total addresses before expanding to guard against huge ranges
  let total = 1;
  const ranges = pathTemplate.split('/').map((part) => {
    const subranges = part.split(',').map(v => v.trim());
    const values = new Set<number>();
    for (const subrange of subranges) {
      if (/^\d+$/.test(subrange)) {
        values.add(parseInt(subrange, 10));
        continue;
      }
      const subrangeMatch = subrange.match(/^(\d+)-(\d+)$/);
      if (subrangeMatch) {
        const rangeStart = parseInt(subrangeMatch[1], 10);
        const rangeEnd = parseInt(subrangeMatch[2], 10);
        if (rangeEnd - rangeStart > 10_000) throw new Error(`Range too large: ${subrange}. Max is 10,000.`);
        for (let i = rangeStart; i <= rangeEnd; i++) {
          values.add(i);
        }
        continue;
      }
      throw new Error(`Invalid subrange: ${subrange}`);
    }
    total *= values.size;
    if (total > 10_000) throw new Error(`Too many addresses (${total}). Max is 10,000.`);
    return [...values].sort((a, b) => a - b);
  });

  const relativePaths = expandRanges(ranges); // ranges is not empty here

  return relativePaths.map(rel => {
    const path = 'm/' + rel;
    const child = hdKey.derive(path);
    if (!child.publicKey) throw new Error(`Failed to derive key at path: ${path}`);

    let address: string;
    switch (format) {
      case 'p2pkh':
        address = p2pkh(child.publicKey).address!;
        break;
      case 'p2sh-p2wpkh':
        address = p2sh(p2wpkh(child.publicKey)).address!;
        break;
      case 'p2wpkh':
        address = p2wpkh(child.publicKey).address!;
        break;
      case 'p2tr':
        address = p2tr(child.publicKey.slice(1)).address!;
        break;
    }

    return { address, path };
  });
}
