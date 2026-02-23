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

// Recursively expand all {x...y} ranges in a path template, returning every
// concrete path. Multiple ranges produce a cartesian product.
function expandRanges(template: string): string[] {
  const match = template.match(/\{(\d+)\.\.\.(\d+)\}/);
  if (!match) return [template];

  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10);
  if (start > end) throw new Error(`Invalid range {${start}...${end}}: start must be ≤ end`);

  const results: string[] = [];
  for (let i = start; i <= end; i++) {
    // Replace only the first occurrence, then recurse for the rest
    const expanded = template.replace(/\{\d+\.\.\.\d+\}/, String(i));
    results.push(...expandRanges(expanded));
  }
  return results;
}

export interface DerivedAddress {
  address: string;
  path: string;
}

// Input format: "<xpub|ypub|zpub>/<path>" where path may contain {x...y} ranges.
// Example: "zpub.../{0...1}/{0...9}"
export function deriveAddressesFromXpub(
  input: string,
  format: XpubAddressFormat
): DerivedAddress[] {
  const trimmed = input.trim();
  const slashIdx = trimmed.indexOf('/');
  if (slashIdx === -1) throw new Error('Input must include a path after the key, e.g. xpub.../0/{0...10}');

  const extKey = trimmed.slice(0, slashIdx).trim();
  const pathTemplate = trimmed.slice(slashIdx + 1).trim();
  if (!pathTemplate) throw new Error('Path is empty');

  const xpub = normalizeToXpub(extKey);
  const hdKey = HDKey.fromExtendedKey(xpub);

  // Count total addresses before expanding to guard against huge ranges
  const rangeMatches = [...pathTemplate.matchAll(/\{(\d+)\.\.\.(\d+)\}/g)];
  const total = rangeMatches.reduce((acc, m) => {
    const size = parseInt(m[2], 10) - parseInt(m[1], 10) + 1;
    return acc * size;
  }, 1);
  if (total > 10_000) throw new Error(`Too many addresses (${total}). Max is 10,000.`);

  const relativePaths = expandRanges(pathTemplate);

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
