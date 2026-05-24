import LZString from 'lz-string';
import { parseStateFile, type SlimState } from './stateFile';

export const SHARE_HASH_PREFIX = 'z:';
export const MAX_SHARE_URL_LENGTH = 10_000;

export const SHARE_LINK_TOO_LONG_ERROR =
  'This state is too large to share as a link (over 10,000 characters). You can still share it via a GitHub Gist (coming soon).';

export function compressStateToSharePayload(state: SlimState): string {
  const json = JSON.stringify(state);
  return LZString.compressToEncodedURIComponent(json);
}

export function decompressSharePayload(
  payload: string
): { ok: true; state: SlimState } | { ok: false; error: string } {
  let json: string | null;
  try {
    json = LZString.decompressFromEncodedURIComponent(payload);
  } catch {
    return { ok: false, error: 'Invalid or corrupted share link' };
  }
  if (!json) {
    return { ok: false, error: 'Invalid or corrupted share link' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Invalid share link data' };
  }

  return parseStateFile(raw);
}

export function buildShareUrl(state: SlimState): string {
  const payload = compressStateToSharePayload(state);
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#${SHARE_HASH_PREFIX}${payload}`;
}

/** Returns compressed payload from `location.hash`, or null if not a share link. */
export function getSharePayloadFromLocation(): string | null {
  const hash = window.location.hash;
  if (!hash) return null;
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!body.startsWith(SHARE_HASH_PREFIX)) return null;
  const payload = body.slice(SHARE_HASH_PREFIX.length);
  return payload.length > 0 ? payload : null;
}

export function clearShareHashFromUrl(): void {
  const { pathname, search } = window.location;
  history.replaceState(history.state, '', `${pathname}${search}`);
}
