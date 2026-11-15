import { supabase } from './supabase';

export interface CountLine { item: string; unit: string; expected: number; counted: number; diff: number; reason: string }
export interface CountDetail { location: string; date: string; lines: CountLine[] }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const n = (x: number) => Number(x).toLocaleString('en-IN', { maximumFractionDigits: 3 });

// What was counted against what the books expected, item by item, with the likely reason.
export async function loadCountDetail(alertId: string): Promise<CountDetail | null> {
  const { data, error } = await supabase.rpc('count_alert_detail', { p_alert_id: alertId });
  if (error || !data) return null;
  return data as CountDetail;
}

export function countDetailHtml(d: CountDetail): string {
  const day = new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const rows = d.lines.map((l) => `<tr><td><b>${esc(l.item)}</b><div class="sm mut">${esc(l.reason)}</div></td><td class="r num">${n(l.expected)} ${esc(l.unit)}</td><td class="r num">${n(l.counted)} ${esc(l.unit)}</td><td class="r num" style="color:var(--bad)">+${n(l.diff)}</td></tr>`).join('');
  return `<p class="sm mut" style="margin-bottom:8px">${esc(d.location)}, count of ${day}. ${d.lines.length} item${d.lines.length === 1 ? '' : 's'} counted above the books, biggest gap first.</p><table><tr><th>Item</th><th class="r">Books</th><th class="r">Counted</th><th class="r">More by</th></tr>${rows}</table><p class="sm mut" style="margin-top:10px">Nothing was changed. The books already took the counted figure.</p>`;
}
