// Probabilities are never shown as a flat 0% or 100%: anything that would round
// there reads "<1%" / ">99%" (or "<0.1%" / ">99.9%" with one decimal).

/** p is 0..1. */
export function pctLabel(p, decimals = 0) {
  if (p == null || Number.isNaN(p)) return '–';
  const scale = 10 ** decimals;
  const v = Math.round(p * 100 * scale) / scale;
  const lo = 1 / scale; const hi = 100 - lo;
  if (v >= 100 || p * 100 > hi + lo / 2) return `>${hi.toFixed(decimals)}%`;
  if (v <= 0 || p * 100 < lo / 2) return `<${lo.toFixed(decimals)}%`;
  return `${v.toFixed(decimals)}%`;
}

/** v is 0..100 (percent). */
export const pctLabel100 = (v, decimals = 0) => (v == null ? '–' : pctLabel(v / 100, decimals));
