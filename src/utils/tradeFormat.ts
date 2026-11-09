/**
 * The server reports a value the copier service did not give as 0. A real price, stop or target is never 0,
 * so 0 is shown as a dash rather than as a figure that was never reported.
 */
export function price(value: number | undefined | null, decimals: number): string {
  return typeof value === 'number' && Number.isFinite(value) && value !== 0 ? value.toFixed(decimals) : '\u2014';
}

/** Commission and swap: nothing is shown when neither was reported (both 0). */
export function hasCosts(t: { commission: number; swap: number }): boolean {
  return Boolean(t.commission) || Boolean(t.swap);
}
