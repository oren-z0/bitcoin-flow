export function truncateTxid(txid: string): string {
  if (!txid || txid.length < 16) return txid;
  return `${txid.slice(0, 8)}...${txid.slice(-8)}`;
}

export function truncateAddress(address: string): string {
  if (!address || address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

export function satsToBtc(sats: number): string {
  return (sats / 1e8).toFixed(8);
}

/** Parse a BTC decimal string (up to 8 fractional digits) to satoshis. */
export function btcToSats(btc: string): number {
  const trimmed = btc.trim();
  if (!trimmed) throw new Error('Amount is required');
  if (!/^\d+(\.\d{0,8})?$/.test(trimmed)) {
    throw new Error('Invalid BTC amount (use up to 8 decimal places)');
  }
  const [whole, frac = ''] = trimmed.split('.');
  const sats =
    BigInt(whole) * 100_000_000n +
    BigInt((frac + '00000000').slice(0, 8));
  const n = Number(sats);
  if (!Number.isSafeInteger(n)) throw new Error('Amount is too large');
  return n;
}

export function formatFeeRate(fee: number, weight: number): string {
  if (weight === 0) return '0.00';
  const rate = (fee * 4) / weight; // sat/vB = fee / vsize, vsize = weight/4
  return rate.toFixed(2);
}

export function formatFee(fee: number, weight: number): string {
  return `${satsToBtc(fee)} BTC (${formatFeeRate(fee, weight)} sat/vB)`;
}

export function formatTimestamp(blockTime: number): string {
  const d = new Date(blockTime * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
