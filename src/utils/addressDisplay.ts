import type { StoredAddress, AddressGroup } from '../types';

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
