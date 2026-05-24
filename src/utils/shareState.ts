import LZString from 'lz-string';
import { parseStateFile, type SlimState } from './stateFile';

export const SHARE_HASH_PREFIX_Z = 'z:';
export const SHARE_HASH_PREFIX_G = 'g:';
/** @deprecated Use SHARE_HASH_PREFIX_Z */
export const SHARE_HASH_PREFIX = SHARE_HASH_PREFIX_Z;
export const MAX_SHARE_URL_LENGTH = 10_000;
export const GITHUB_GIST_URL = 'https://gist.github.com/';

export const SHARE_LINK_TOO_LONG_ERROR =
  'This state is too large to share as a link (over 10,000 characters). You can still share it via a GitHub Gist.';

export type ShareHashFromLocation =
  | { type: 'compressed'; payload: string }
  | { type: 'gist'; ref: string };

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
  return `${origin}${pathname}${search}#${SHARE_HASH_PREFIX_Z}${payload}`;
}

const GIST_USERNAME = String.raw`[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?`;
/** Gist revision ids are hexadecimal (typically 32 characters). */
const GIST_ID = String.raw`[a-f0-9]{7,32}`;
const GIST_REF_PATTERN = new RegExp(`^(${GIST_USERNAME})/(${GIST_ID})$`, 'i');
/** https://gist.github.com/username/gist-id with optional path suffix, query, or fragment */
const GIST_GITHUB_URL_PATTERN = new RegExp(
  String.raw`^https?:\/\/gist\.github\.com\/(${GIST_USERNAME})\/(${GIST_ID})(?:\/[^\s#?]*)?(?:[#?].*)?$`,
  'i'
);
const GIST_GITHUB_BARE_URL_PATTERN = new RegExp(
  String.raw`^gist\.github\.com\/(${GIST_USERNAME})\/(${GIST_ID})(?:\/[^\s#?]*)?(?:[#?].*)?$`,
  'i'
);

export const GIST_FORMAT_HINT =
  'Enter a gist URL like https://gist.github.com/username/gist-id';

function gistRefFromMatch(username: string, gistId: string): string {
  return `${username}/${gistId.toLowerCase()}`;
}

/** Validate `username/gist-id` (e.g. from `#g:…` hash). */
export function parseGistRefString(
  ref: string
): { ok: true; ref: string } | { ok: false; error: string } {
  const match = ref.trim().match(GIST_REF_PATTERN);
  if (!match) {
    return { ok: false, error: GIST_FORMAT_HINT };
  }
  return { ok: true, ref: gistRefFromMatch(match[1], match[2]) };
}

/**
 * Parse a gist.github.com URL (optional path suffix after gist-id) or `username/gist-id`.
 */
export function parseGistReference(
  input: string
): { ok: true; ref: string } | { ok: false; error: string } {
  const s = input.trim();
  if (!s) {
    return { ok: false, error: GIST_FORMAT_HINT };
  }

  const fullUrl = s.match(GIST_GITHUB_URL_PATTERN);
  if (fullUrl) {
    return { ok: true, ref: gistRefFromMatch(fullUrl[1], fullUrl[2]) };
  }

  const bareUrl = s.match(GIST_GITHUB_BARE_URL_PATTERN);
  if (bareUrl) {
    return { ok: true, ref: gistRefFromMatch(bareUrl[1], bareUrl[2]) };
  }

  const refOnly = s.match(GIST_REF_PATTERN);
  if (refOnly) {
    return { ok: true, ref: gistRefFromMatch(refOnly[1], refOnly[2]) };
  }

  if (/gist\.githubusercontent\.com/i.test(s)) {
    return {
      ok: false,
      error: 'Use the gist page URL (https://gist.github.com/username/gist-id), not a gist.githubusercontent.com link',
    };
  }
  if (/github\.com/i.test(s)) {
    return { ok: false, error: GIST_FORMAT_HINT };
  }

  return { ok: false, error: GIST_FORMAT_HINT };
}

export function buildGistShareUrl(gistRef: string): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#${SHARE_HASH_PREFIX_G}${gistRef}`;
}

export function gistRawUrl(gistRef: string): string {
  return `https://gist.githubusercontent.com/${gistRef}/raw`;
}

export async function fetchStateFromGist(
  gistRef: string
): Promise<{ ok: true; state: SlimState } | { ok: false; error: string }> {
  const parsedRef = parseGistRefString(gistRef);
  if (!parsedRef.ok) {
    return parsedRef;
  }

  try {
    const res = await fetch(gistRawUrl(parsedRef.ref));
    if (!res.ok) {
      return { ok: false, error: `Failed to load gist (${res.status})` };
    }
    const text = await res.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, error: 'Gist does not contain valid JSON' };
    }
    return parseStateFile(raw);
  } catch {
    return { ok: false, error: 'Failed to fetch gist' };
  }
}

export function getShareHashFromLocation(): ShareHashFromLocation | null {
  const hash = window.location.hash;
  if (!hash) return null;
  const body = hash.startsWith('#') ? hash.slice(1) : hash;

  if (body.startsWith(SHARE_HASH_PREFIX_Z)) {
    const payload = body.slice(SHARE_HASH_PREFIX_Z.length);
    return payload.length > 0 ? { type: 'compressed', payload } : null;
  }

  if (body.startsWith(SHARE_HASH_PREFIX_G)) {
    const rawRef = body.slice(SHARE_HASH_PREFIX_G.length);
    if (!rawRef) return null;
    const parsed = parseGistRefString(rawRef);
    return parsed.ok ? { type: 'gist', ref: parsed.ref } : null;
  }

  return null;
}

/** True when hash is `#g:…` but the reference is not `username/gist-id`. */
export function hasInvalidGistHashFromLocation(): boolean {
  const hash = window.location.hash;
  if (!hash) return false;
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!body.startsWith(SHARE_HASH_PREFIX_G)) return false;
  const rawRef = body.slice(SHARE_HASH_PREFIX_G.length);
  return rawRef.length > 0 && !parseGistRefString(rawRef).ok;
}

/** @deprecated Use getShareHashFromLocation */
export function getSharePayloadFromLocation(): string | null {
  const share = getShareHashFromLocation();
  return share?.type === 'compressed' ? share.payload : null;
}

export function clearShareHashFromUrl(): void {
  const { pathname, search } = window.location;
  history.replaceState(history.state, '', `${pathname}${search}`);
}
