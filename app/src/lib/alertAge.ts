// How many whole days (India time) an alert has been open.
const ist = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
export function alertAge(created: string, now: Date = new Date()): number {
  return Math.max(0, Math.round((Date.parse(ist(now) + 'T00:00:00Z') - Date.parse(ist(new Date(created)) + 'T00:00:00Z')) / 86400000));
}
export const ageText = (n: number) => (n === 0 ? 'Today' : n === 1 ? '1 day' : n + ' days');
export const ageClass = (n: number) => (n > 5 ? 'flag' : n >= 2 ? 'late' : 'done');
export const DROP_AFTER = 5;
