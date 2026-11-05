import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { dayLabel, timeOf, windowState, type Reminders } from '../lib/ist';
import { qty as fmtQty } from '../lib/format';
import type { Group } from '../lib/types';
import { DatePicker } from '../components/DatePicker';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { downloadWorkbook } from '../lib/sheets';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

interface LineRow { item_id: number; qty: number; reason: string | null }
interface IndentRow { id: string; location_id: number; status: string; submitted_at: string | null; nothing_needed: boolean; indent_lines: LineRow[] }
interface ItemRow { id: number; name: string; unit: string; group_id: number | null }

export function Indents() {
  const { locations } = useSession();
  const [date, setDate] = useState('');
  const [rows, setRows] = useState<IndentRow[]>([]);
  const [items, setItems] = useState<Record<number, ItemRow>>({});
  const [groups, setGroups] = useState<Group[]>([]);
  const [rem, setRem] = useState<Reminders>({});
  const [tab, setTab] = useState<'counter' | 'item'>('counter');
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState('');
  const toast = useToast();

  useEffect(() => {
    supabase.rpc('indent_for_date').then(({ data }) => { const d = String(data); setDate(d); setTarget(d); });
    supabase.rpc('indent_window').then(({ data }) => setRem((data as Reminders) ?? {}));
    supabase.from('item_groups').select('*').order('sort').then(({ data }) => setGroups((data as Group[]) ?? []));
    supabase.from('items').select('id, name, unit, group_id').then(({ data }) => setItems(Object.fromEntries(((data as ItemRow[]) ?? []).map((i) => [i.id, i]))));
  }, []);

  const load = useCallback(async () => {
    if (!date) return;
    const { data } = await supabase.from('indents').select('id, location_id, status, submitted_at, nothing_needed, indent_lines(item_id, qty, reason)').eq('for_date', date);
    setRows((data as IndentRow[]) ?? []); setLoading(false);
  }, [date]);
  useEffect(() => {
    void load();
    const ch = supabase.channel('indents-office').on('postgres_changes', { event: '*', schema: 'public', table: 'indents' }, () => { void load(); }).subscribe();
    const poll = window.setInterval(() => { void load(); }, 20000);
    return () => { void supabase.removeChannel(ch); window.clearInterval(poll); };
  }, [load]);

  const counters = locations.filter((l) => l.kind === 'department' && l.active);
  const byLoc = useMemo(() => new Map(rows.map((r) => [r.location_id, r])), [rows]);
  const sent = (r?: IndentRow) => r && (r.status === 'submitted' || r.status === 'locked');
  const isTomorrow = date !== '' && date === target;
  const late = isTomorrow && windowState(rem) === 'late';

  const combined = useMemo(() => {
    const m = new Map<number, { total: number; by: { loc: string; qty: number; reason: string | null }[] }>();
    for (const r of rows.filter((x) => sent(x))) {
      const loc = locations.find((l) => l.id === r.location_id)?.name ?? '';
      for (const l of r.indent_lines) {
        const e = m.get(l.item_id) ?? { total: 0, by: [] };
        e.total += Number(l.qty); e.by.push({ loc, qty: Number(l.qty), reason: l.reason }); m.set(l.item_id, e);
      }
    }
    return [...m.entries()].map(([id, v]) => ({ id, ...v, item: items[id] })).filter((x) => x.item)
      .sort((a, b) => (a.item.group_id ?? 99) - (b.item.group_id ?? 99) || a.item.name.localeCompare(b.item.name));
  }, [rows, items, locations]);

  const sentCounters = counters.filter((c) => sent(byLoc.get(c.id)) && !byLoc.get(c.id)!.nothing_needed);
  const qtyAt = (id: number, locName: string) => combined.find((x) => x.id === id)?.by.filter((b) => b.loc === locName).reduce((t, b) => t + b.qty, 0);
  const groupName = (id: number | null) => { const g = groups.find((x) => x.id === id); return g ? g.name : 'Other'; };

  async function excel() {
    if (!combined.length) { toast('Nothing has been sent yet'); return; }
    await downloadWorkbook(`Indent_${date}.xlsx`, `Single Teas indent for ${dayLabel(date)}`, ['One row per item with the total asked and what each counter asked for.', 'Use it to order by phone or WhatsApp.'], [{
      name: 'Indent',
      cols: [{ label: 'Group', width: 22 }, { label: 'Item', width: 32 }, { label: 'Unit', width: 8 }, { label: 'Total asked', width: 13 }, ...sentCounters.map((c) => ({ label: c.name, width: 14 }))],
      rows: combined.map((x) => [groupName(x.item.group_id), x.item.name, x.item.unit, x.total, ...sentCounters.map((c) => qtyAt(x.id, c.name) ?? null)])
    }]);
  }
  function print() {
    if (!combined.length) { toast('Nothing has been sent yet'); return; }
    const body = groups.map((g) => {
      const list = combined.filter((x) => x.item.group_id === g.id);
      if (!list.length) return '';
      return `<h2>${esc(g.name)}</h2><table><colgroup><col style="width:30%"><col style="width:16%"><col></colgroup><thead><tr><th>Item</th><th class="r">Total</th><th style={{ paddingLeft: 24 }}>Who asked</th></tr></thead><tbody>${list.map((x) => `<tr><td><b>${esc(x.item.name)}</b></td><td class="r"><b>${esc(fmtQty(x.total, x.item.unit))}</b></td><td>${esc(x.by.map((b) => `${b.loc} ${fmtQty(b.qty, x.item.unit)}`).join(', '))}</td></tr>`).join('')}</tbody></table>`;
    }).join('');
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print'); return; }
    w.document.write(`<!doctype html><title>Indent ${esc(date)}</title><style>body{font:13px/1.45 system-ui,sans-serif;padding:24px}h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:18px 0 6px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border-bottom:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top}th{font-size:11px;text-transform:uppercase;color:#555}.r{text-align:right}</style><h1>Single Teas indent for ${esc(dayLabel(date))}</h1><p>${sentCounters.length} counters: ${esc(sentCounters.map((c) => c.name).join(', '))}</p>${body}`);
    w.document.close(); w.focus(); w.print();
  }

  const doneCount = counters.filter((c) => sent(byLoc.get(c.id))).length;
  const missing = counters.filter((c) => !sent(byLoc.get(c.id)));

  return (
    <>
      <div className="pagehead">
        <div><p className="label">Store view</p><h1>Indents for {date ? dayLabel(date) : '…'}</h1><p className="muted small" style={{ marginTop: 2 }}>{doneCount} of {counters.length} counters have sent. Counters can still change theirs until the store starts.</p></div>
        <div className="row">
          <button className="btn" onClick={() => void excel()}><Icon name="layers" /> Excel</button>
          <button className="btn" onClick={print}>Print</button>
          <DatePicker value={date} onChange={setDate} tomorrow={target} label="Indent date" />
          <div className="seg"><button aria-pressed={tab === 'counter'} onClick={() => setTab('counter')}>By counter</button><button aria-pressed={tab === 'item'} onClick={() => setTab('item')}>All counters together</button></div>
        </div>
      </div>

      {late && missing.length > 0 && <p className="banner bad">Past 5:00 pm. Still waiting on: {missing.map((m) => m.name).join(', ')}.</p>}
      {loading ? <p className="muted">Loading…</p> : tab === 'counter' ? (
        <div className="stack">
          {counters.map((c) => {
            const r = byLoc.get(c.id);
            const n = r?.indent_lines.length ?? 0;
            const chip = sent(r) ? (r!.nothing_needed ? <span className="chip off">Nothing needed</span> : <span className="chip done">Sent {timeOf(r!.submitted_at)}</span>)
              : r && n > 0 ? <span className="chip due">Drafting, {n} items</span> : late ? <span className="chip flag">Not sent</span> : <span className="chip off">Not started</span>;
            const expanded = openId === c.id.toString() + 'x';
            return (
              <div key={c.id} className="card">
                <div className="row" style={{ justifyContent: 'space-between', cursor: n ? 'pointer' : 'default' }} onClick={() => n && setOpenId(expanded ? null : c.id.toString() + 'x')}>
                  <div><b>{c.name}</b> {sent(r) && !r!.nothing_needed ? <span className="muted small">· {n} items</span> : null}</div>{chip}
                </div>
                {expanded && r && (
                  <div className="tablewrap" style={{ marginTop: 10 }}><table><tbody>
                    {r.indent_lines.map((l) => { const it = items[l.item_id]; return it ? (
                      <tr key={l.item_id}><td>{it.name}</td><td className="r num">{fmtQty(Number(l.qty), it.unit)}</td><td className="muted small">{l.reason ?? ''}</td></tr>) : null; })}
                  </tbody></table></div>
                )}
              </div>
            );
          })}
        </div>
      ) : combined.length === 0 ? <p className="empty card">Nothing has been sent yet.</p> : (
        <div className="stack">
          {groups.map((g) => {
            const list = combined.filter((x) => x.item.group_id === g.id);
            if (!list.length) return null;
            return (
              <div key={g.id}>
                <h2 style={{ marginBottom: 8 }}>{g.icon} {g.name}</h2>
                <div className="tablewrap"><table style={{ tableLayout: 'fixed', width: '100%' }}>
                  <colgroup><col style={{ width: '28%' }} /><col style={{ width: '14%' }} /><col /></colgroup>
                  <thead><tr><th>Item</th><th className="r">Total asked</th><th style={{ paddingLeft: 24 }}>Who asked</th></tr></thead>
                  <tbody>{list.map((x) => (
                    <tr key={x.id}><td><b>{x.item.name}</b></td><td className="r num"><b>{fmtQty(x.total, x.item.unit)}</b></td>
                      <td className="small" style={{ paddingLeft: 24 }}>{x.by.map((b) => `${b.loc} ${fmtQty(b.qty, x.item.unit)}${b.reason ? ` (${b.reason})` : ''}`).join(' · ')}</td></tr>))}</tbody>
                </table></div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
