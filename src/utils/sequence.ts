/** nSequence indicates a relative locktime (BIP 68) when version >= 2. */
export function isRelativeLocktimeSequence(sequence: number): boolean {
  if (sequence <= 0x0000ffff) return true;
  if (sequence >= 0x00400000 && sequence <= 0x0040ffff) return true;
  return false;
}

export function inputHasRelativeLocktime(txVersion: number, sequence: number): boolean {
  return txVersion >= 2 && isRelativeLocktimeSequence(sequence);
}

export function showsAbsoluteLocktime(locktime: number, vins: { sequence: number }[]): boolean {
  return locktime >= 500000000 && vins.some(vin => vin.sequence <= 0xfffffffe);
}

/** Locktime is not enforced when every input has nSequence 0xFFFFFFFF. */
export function isLocktimeDisabled(vins: { sequence: number }[]): boolean {
  return vins.length > 0 && vins.every(vin => (vin.sequence >>> 0) === 0xffffffff);
}

export function formatSequenceHex(sequence: number): string {
  return `0x${(sequence >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
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
