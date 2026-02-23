export function computeEdgeWidth(amount: number, allAmounts: number[]): number {
  if (allAmounts.length === 0 || amount <= 0) return 2;
  const positiveAmounts = allAmounts.filter(a => a > 0);
  if (positiveAmounts.length === 0) return 2;

  const logMin = Math.log(Math.min(...positiveAmounts));
  const logMax = Math.log(Math.max(...positiveAmounts));

  if (logMin === logMax) return 4;

  const logAmount = Math.log(Math.max(amount, 1));
  return 2 + 6 * (logAmount - logMin) / (logMax - logMin);
}
