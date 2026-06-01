/** nSequence indicates a relative locktime (BIP 68) when version >= 2. */
export function inputHasRelativeLocktime(txVersion: number, sequence: number): boolean {
  // Ignore sequences that are exactly 0 or 0x00400000 because the relative locktime is 0 blcoks/seconds.
  return txVersion >= 2 && ((0 < sequence && sequence <= 0x0000ffff) || (0x00400000 < sequence && sequence <= 0x0040ffff));
}

/** Locktime values >= this are interpreted as Unix timestamps rather than block heights (BIP 65). */
export const LOCKTIME_TIMESTAMP_THRESHOLD = 500000000;

export function showsAbsoluteLocktime(locktime: number, vins: { sequence: number }[]): boolean {
  return locktime >= LOCKTIME_TIMESTAMP_THRESHOLD && vins.some(vin => vin.sequence < 0xffffffff);
}

/** Whether a raw locktime value falls in the range interpreted as a Unix timestamp. */
export function isTimestampLocktime(locktime: number): boolean {
  return (
    Number.isSafeInteger(locktime) &&
    locktime >= LOCKTIME_TIMESTAMP_THRESHOLD &&
    locktime <= 0xffffffff
  );
}

/** Locktime is not enforced when every input has nSequence 0xFFFFFFFF. */
export function isLocktimeDisabled(vins: { sequence: number }[]): boolean {
  return vins.length > 0 && vins.every(vin => (vin.sequence >>> 0) === 0xffffffff);
}

export function formatSequenceHex(sequence: number): string {
  return `0x${(sequence >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

export const SEQUENCE_PARSE_ERROR = 'Could not parse Sequence value';

export const SEQUENCE_VALUE_FORMAT_HINT =
  'Format: digits, hex (starting with "0x"), or duration: "W days, X hours, Y minutes, Z seconds"';

const TIME_UNIT_SECONDS: Record<string, number> = {
  second: 1,
  seconds: 1,
  minute: 60,
  minutes: 60,
  hour: 3600,
  hours: 3600,
  day: 86400,
  days: 86400,
};

function parseTimeUnitMultiplier(nonDigitPart: string): number {
  const tokens = nonDigitPart.toLowerCase().match(/[a-z]+|[^a-z]+/g) ?? [];
  for (const token of tokens) {
    const mult = TIME_UNIT_SECONDS[token];
    if (mult !== undefined) return mult;
  }
  throw new Error(SEQUENCE_PARSE_ERROR);
}

/** BIP68 time-based relative locktime from a duration phrase (e.g. "7 days, 1 hour"). */
function parseSequenceDurationPhrase(input: string): number {
  const parts = input.match(/\d+|\D+/g);
  if (!parts || parts.length === 0 || parts.length % 2 !== 0) {
    throw new Error(SEQUENCE_PARSE_ERROR);
  }
  if (!/^\d/.test(input)) {
    throw new Error(SEQUENCE_PARSE_ERROR);
  }

  let totalSeconds = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const digitPart = parts[i];
    const unitPart = parts[i + 1] ?? '';
    if (!/^\d+$/.test(digitPart)) {
      throw new Error(SEQUENCE_PARSE_ERROR);
    }
    const amount = Number(digitPart);
    if (!Number.isSafeInteger(amount)) {
      throw new Error(SEQUENCE_PARSE_ERROR);
    }
    totalSeconds += amount * parseTimeUnitMultiplier(unitPart);
  }

  const scaled = Math.round(totalSeconds / 512);
  if (scaled > 0xffff) {
    throw new Error(SEQUENCE_PARSE_ERROR);
  }
  return (0x00400000 + scaled) >>> 0;
}

export function parseSequenceValue(input: string): number {
  const s = input.trim();
  if (s === '') {
    throw new Error(SEQUENCE_PARSE_ERROR);
  }

  if (/^0x[0-9a-f]+$/i.test(s)) {
    const n = Number.parseInt(s.slice(2), 16);
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) {
      throw new Error(SEQUENCE_PARSE_ERROR);
    }
    return n >>> 0;
  }

  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) {
      throw new Error(SEQUENCE_PARSE_ERROR);
    }
    return n >>> 0;
  }

  return parseSequenceDurationPhrase(s);
}

export const LOCKTIME_PARSE_ERROR = 'Could not parse locktime value';

export const LOCKTIME_VALUE_FORMAT_HINT =
  'Format: non-negative integer (block height), or UTC date: YYYY-MM-DD hh:mm:ss';

/** UTC `YYYY-MM-DD hh:mm:ss` for a timestamp locktime. */
export function formatLocktimeUtc(locktime: number): string {
  const d = new Date(locktime * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function parseLocktimeUtcDateTime(input: string): number {
  const parts = input.match(/\d+/g);
  if (!parts || parts.length !== 6) {
    throw new Error(LOCKTIME_PARSE_ERROR);
  }

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const hour = Number(parts[3]);
  const minute = Number(parts[4]);
  const second = Number(parts[5]);

  if (
    !Number.isSafeInteger(year) ||
    !Number.isSafeInteger(month) ||
    !Number.isSafeInteger(day) ||
    !Number.isSafeInteger(hour) ||
    !Number.isSafeInteger(minute) ||
    !Number.isSafeInteger(second)
  ) {
    throw new Error(LOCKTIME_PARSE_ERROR);
  }

  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const d = new Date(ms);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hour ||
    d.getUTCMinutes() !== minute ||
    d.getUTCSeconds() !== second
  ) {
    throw new Error(LOCKTIME_PARSE_ERROR);
  }

  const seconds = Math.floor(ms / 1000);
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 0xffffffff) {
    throw new Error('Locktime must be a 32-bit value');
  }
  return seconds >>> 0;
}

export function parseLocktimeValue(input: string): number {
  const s = input.trim();
  if (s === '') {
    throw new Error(LOCKTIME_PARSE_ERROR);
  }

  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) {
      throw new Error('Locktime must be a 32-bit value');
    }
    return n >>> 0;
  }

  return parseLocktimeUtcDateTime(s);
}

export function locktimeDraftDisplay(locktime: number): string {
  return isTimestampLocktime(locktime) ? formatLocktimeUtc(locktime) : String(locktime);
}

/** Text after the hex in `formatInputSequence` (e.g. relative locktime hint). */
export function inputSequenceHintSuffix(txVersion: number, sequence: number): string {
  const full = formatInputSequence(txVersion, sequence);
  const prefix = `Sequence: ${formatSequenceHex(sequence)}`;
  return full.length > prefix.length ? full.slice(prefix.length) : '';
}

function formatDurationParts(totalSeconds: number): string {
  let remaining = totalSeconds;
  const days = Math.floor(remaining / 86400);
  remaining %= 86400;
  const hours = Math.floor(remaining / 3600);
  remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
  }
  return parts.join(', ');
}

export function formatInputSequence(txVersion: number, sequence: number): string {
  const hex = formatSequenceHex(sequence);
  if (txVersion < 2) return `Sequence: ${hex}`;

  if (sequence <= 0x0000ffff) {
    const blocks = sequence;
    return `Sequence: ${hex} (${blocks} ${blocks === 1 ? 'block' : 'blocks'})`;
  }

  if (sequence >= 0x00400000 && sequence <= 0x0040ffff) {
    const seconds = (sequence - 0x00400000) * 512;
    return `Sequence: ${hex} (${formatDurationParts(seconds)})`;
  }

  return `Sequence: ${hex}`;
}
