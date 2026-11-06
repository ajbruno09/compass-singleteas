import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { timeOf, dayLabel } from '../lib/ist';

interface Row { location_id: number; location_name: string; on_time: number; late: number; missed: number; sos_count: number; sos_extra: number }
interface Mute { id: string; minutes: number; muted_at: string; profile_id: string }

// How each counter is doing on indents and SOS. Everything is recorded, so it can be looked at any time.
export function Scorecard() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Row[]>([]);
  const [mutes, setMutes] = useState<Mute[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const { data } = await supabase.rpc('counter_scorecard', { p_days: days });
    setRows((data as Row[]) ?? []);
    const m = await supabase.from('sos_mute_log').select('id, minutes, muted_at, profile_id').gte('muted_at', new Date(Date.now() - days * 86400000).toISOString()).order('muted_at', { ascending: false }).limit(20);
    const list = (m.data as Mute[]) ?? [];
    setMutes(list);
    if (list.length) { const p = await supabase.from('profiles').select('id, full_name').in('id', [...new Set(list.map((x) => x.profile_id))]); setNames(Object.fromEntries(((p.data as { id: string; full_name: string }[]) ?? []).map((x) => [x.id, x.full_name]))); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);
  const bad = (n: number) => (n > 0 ? { color: 'var(--bad, #B42335)', fontWeight: 700 } : undefined);
  return (
    <>
      <div className="pagehead">
        <div><p className="label">Performance</p><h1>Counter record</h1><p className="muted small" style={{ marginTop: 2 }}>Indents sent on time, late or missed, and how often each counter used SOS.</p></div>
        <div className="seg">{[7, 30, 90].map((d) => <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>)}</div>
      </div>
      <div className="tablewrap"><table>
        <thead><tr><th>Counter</th><th className="r">On time</th><th className="r">Late</th><th className="r">Missed</th><th className="r">SOS used</th><th className="r">Asked for extra SOS</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.location_id}><td><b>{r.location_name}</b></td><td className="r num">{r.on_time}</td><td className="r num" style={bad(r.late)}>{r.late}</td><td className="r num" style={bad(r.missed)}>{r.missed}</td><td className="r num">{r.sos_count}</td><td className="r num" style={bad(r.sos_extra)}>{r.sos_extra}</td></tr>)}
          {!rows.length && <tr><td colSpan={6} className="muted">Nothing recorded yet.</td></tr>}
        </tbody>
      </table></div>
      <p className="muted small">Frequent SOS usually means the indent was not planned well. Indents sealed before this was switched on are not counted.</p>
      <h2>SOS alarm mutes</h2>
      {mutes.length === 0 ? <p className="muted">Nobody has muted the alarm.</p> : (
        <div className="tablewrap"><table><thead><tr><th>Who</th><th>When</th><th className="r">Minutes</th></tr></thead>
          <tbody>{mutes.map((m) => <tr key={m.id}><td>{names[m.profile_id] ?? '—'}</td><td>{dayLabel(m.muted_at.slice(0, 10))} {timeOf(m.muted_at)}</td><td className="r num">{m.minutes}</td></tr>)}</tbody></table></div>
      )}
    </>
  );
}
