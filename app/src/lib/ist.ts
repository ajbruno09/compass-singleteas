// Times in the app always follow Indian time, whatever the phone's own clock says.
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
export function istMinutes(d: Date = new Date()): number {
  const parts = fmt.formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}
export const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
export const clock12 = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${ap}`;
};
export const timeOf = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)) : '';
export const dayLabel = (isoDate: string) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(isoDate + 'T00:00:00'));

export interface Reminders { indent_open?: string; indent_due?: string }
export type WindowState = 'early' | 'open' | 'late';
export function windowState(r: Reminders, now: Date = new Date()): WindowState {
  const open = toMinutes(r.indent_open ?? '15:30');
  const due = toMinutes(r.indent_due ?? '17:00');
  const t = istMinutes(now);
  if (t < open) return 'early';
  if (t <= due) return 'open';
  return 'late';
}
