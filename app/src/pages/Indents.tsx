import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { dayLabel, timeOf, windowState, type Reminders } from '../lib/ist';
import { qty as fmtQty } from '../lib/format';
import type { Group } from '../lib/types';

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

  const doneCount = counters.filter((c) => sent(byLoc.get(c.id))).length;
  const missing = counters.filter((c) => !sent(byLoc.get(c.id)));

  return (
    <>
      <div className="pagehead">
        <div><h1>Indents</h1><p className="muted">For {date ? dayLabel(date) : '…'} · {doneCount} of {counters.length} counters have sent</p></div>
        <div className="row">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} aria-label="Indent date" />
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
                <div className="tablewrap"><table>
                  <thead><tr><th>Item</th><th className="r">Total asked</th><th>Who asked</th></tr></thead>
                  <tbody>{list.map((x) => (
                    <tr key={x.id}><td><b>{x.item.name}</b></td><td className="r num"><b>{fmtQty(x.total, x.item.unit)}</b></td>
                      <td className="small">{x.by.map((b) => `${b.loc} ${fmtQty(b.qty, x.item.unit)}${b.reason ? ` (${b.reason})` : ''}`).join(' · ')}</td></tr>))}</tbody>
                </table></div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
