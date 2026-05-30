import type { StoredAddress, AddressGroup } from '../types';

/** Description from xpub-derived addresses: `xpub…/0/1/2` (also ypub, zpub, …). */
const XPUB_DESCRIPTION_RE =
  /^(xpub|ypub|zpub|Ypub|Zpub)[1-9A-HJ-NP-Za-km-z]+\/(.+)$/;

/** Default display name when description encodes a derivation path under an extended public key. */
export function defaultAddressNameFromDescription(
  groupName: string,
  description: string | undefined
): string | undefined {
  const d = description?.trim();
  if (!d) return undefined;
  const m = XPUB_DESCRIPTION_RE.exec(d);
  if (!m) return undefined;
  return `${groupName}/${m[2]}`;
}

export function getEffectiveName(
  addr: string,
  stored: StoredAddress | undefined,
  groupMap: Record<string, AddressGroup>
): string | undefined {
  if (stored?.name) return stored.name;
  const groupId = stored?.groupId;
  if (groupId !== undefined && groupId !== '') {
    const group = groupMap[groupId];
    if (group) {
      const fromDesc = defaultAddressNameFromDescription(group.name, stored?.description);
      if (fromDesc) return fromDesc;
      const idx = group.addresses.indexOf(addr);
      if (idx !== -1) return `${group.name} #${idx + 1}`;
    }
  }
  return undefined;
}

export function getEffectiveColor(
  stored: StoredAddress | undefined,
  groupMap: Record<string, AddressGroup>
): string | undefined {
  if (stored?.color) return stored.color;
  const groupId = stored?.groupId;
  if (groupId !== undefined && groupId !== '') {
    const group = groupMap[groupId];
    if (group?.color) return group.color;
  }
  return undefined;
}
