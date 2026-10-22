const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n: number | null | undefined) => (n == null ? '—' : inr.format(Number(n)));
export const money2 = (n: number | null | undefined) => (n == null ? '—' : inr2.format(Number(n)));
export function qty(n: number | null | undefined, unit?: string) {
  if (n == null) return '—';
  const v = Number(n);
  if (unit === 'kg' && v > 0 && v < 1) return `${Math.round(v * 1000)} g`;
  if (unit === 'L' && v > 0 && v < 1) return `${Math.round(v * 1000)} ml`;
  const s = Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return unit ? `${s} ${unit}` : s;
}
export function quick(n: number, unit: string) {
  if (unit === 'kg' && n < 1) return `+${Math.round(n * 1000)}g`;
  if (unit === 'L' && n < 1) return `+${Math.round(n * 1000)}ml`;
  return `+${n}${unit === 'kg' || unit === 'L' ? unit : ''}`;
}
const dfmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const date = (s: string | null | undefined) => (s ? dfmt.format(new Date(s + (s.length === 10 ? 'T00:00:00' : ''))) : '—');
export const errText = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'Something went wrong. Try again.');
