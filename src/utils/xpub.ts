import { HDKey, type Versions } from '@scure/bip32';
import { p2pkh, p2wpkh, p2sh, p2tr } from '@scure/btc-signer';

export type XpubAddressFormat = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr';

// SLIP-0132 version bytes for Bitcoin mainnet extended public keys.
const EXTENDED_KEY_VERSIONS: Record<string, Versions> = {
  xpub: { private: 0x0488ade4, public: 0x0488b21e },
  ypub: { private: 0x049d7838, public: 0x049d7cb2 },
  zpub: { private: 0x04b2430c, public: 0x04b24746 },
  Ypub: { private: 0x0295b005, public: 0x0295b43f },
  Zpub: { private: 0x02aa7a99, public: 0x02aa7ed3 },
};

const PUBLIC_VERSION_TO_VERSIONS = new Map<number, Versions>(
  Object.values(EXTENDED_KEY_VERSIONS).map(v => [v.public, v])
);

export type PsbtGlobalXpubKeyFields = {
  version: number;
  depth: number;
  parentFingerprint: number;
  childNumber: number;
  chainCode: Uint8Array;
  publicKey: Uint8Array;
};

export function hdKeyFromExtendedKey(key: string): HDKey {
  const prefix = key.slice(0, 4);
  const versions = EXTENDED_KEY_VERSIONS[prefix];
  if (!versions) throw new Error(`Unknown extended public key prefix: ${prefix}`);
  return HDKey.fromExtendedKey(key, versions);
}

/** Reconstruct an HDKey from PSBT global `xpub` key fields (for display / derive). */
export function hdKeyFromPsbtGlobalXpubKey(fields: PsbtGlobalXpubKeyFields): HDKey {
  const versions = PUBLIC_VERSION_TO_VERSIONS.get(fields.version);
  if (!versions) {
    throw new Error(`Unsupported extended public key version: 0x${fields.version.toString(16)}`);
  }
  return new HDKey({
    versions,
    depth: fields.depth,
    index: fields.childNumber,
    parentFingerprint: fields.parentFingerprint,
    chainCode: fields.chainCode,
    publicKey: fields.publicKey,
  });
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

  const hdKey = hdKeyFromExtendedKey(extKey);

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
