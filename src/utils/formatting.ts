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

export function formatFeeRate(fee: number, weight: number): string {
  if (weight === 0) return '0.00';
  const rate = (fee * 4) / weight; // sat/vB = fee / vsize, vsize = weight/4
  return rate.toFixed(2);
}

export function formatTimestamp(blockTime: number): string {
  return new Date(blockTime * 1000).toLocaleString();
}
