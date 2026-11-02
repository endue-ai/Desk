// Small statistics for the perf runner. Pure: unit tested in stats.test.ts under `just test-unit`.

/** The nearest-rank percentile: the smallest value with at least `p` of the values at or below it. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error("percentile of no values");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1] as number;
}

/** The middle value, or the mean of the two middle ones. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of no values");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return Number.isInteger(middle)
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : (sorted[Math.floor(middle)] as number);
}

/** One decimal, as budgets.json and results.json keep values. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
