import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface Person { id: string; name: string; role: string; minutes: number; days: number; last: string | null }
const ROLE: Record<string, string> = { owner: 'Owner', manager: 'Manager', store: 'Store', department: 'Counter or kitchen', accounts: 'Accounts' };
type Per = 1 | 7 | 30;
const hm = (m: number) => m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m` : `${m} min`;
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
};

export function TeamUsage() {
  const [per, setPer] = useState<Per>(7);
  const [rows, setRows] = useState<Person[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setRows(null);
    supabase.rpc('usage_summary', { p_days: per }).then(({ data, error }) => { if (error) setErr(error.message); else setRows((data as Person[]) ?? []); });
  }, [per]);
  const mx = Math.max(1, ...(rows ?? []).map((r) => r.minutes));
  const quiet = (r: Person) => r.minutes === 0 || (r.last != null && Date.now() - new Date(r.last).getTime() > 3 * 86400000);
  const lows = (rows ?? []).filter(quiet).map((r) => r.name);
  const since = new Date('2026-11-13T00:00:00+05:30');
  return (
    <>
      <div className="pagehead"><div><p className="label">Team</p><h1>Who is using Compass</h1></div>
        <div className="seg" role="group" aria-label="Period">
          {([[1, 'Today'], [7, '7 days'], [30, '30 days']] as [Per, string][]).map(([v, l]) => <button key={v} aria-pressed={per === v} onClick={() => setPer(v)}>{l}</button>)}
        </div></div>
      {err && <p className="banner bad" role="alert">{err}</p>}
      {rows && (lows.length > 0
        ? <p className="banner warn">{lows.join(', ')} {lows.length === 1 ? 'has' : 'have'} barely used Compass. That is the one to talk to.</p>
        : <p className="banner">Everyone is using Compass.</p>)}
      {rows && new Date() < new Date(since.getTime() + 7 * 86400000) && <p className="small muted">Time counting started on 13 Nov, so the numbers are low for now and fill up over the coming days.</p>}
      <div className="tablewrap"><table>
        <thead><tr><th>Person</th><th>Role</th><th>Time in Compass</th><th className="r">Days opened</th><th>Last opened</th><th></th></tr></thead>
        <tbody>{(rows ?? []).map((r) => (
          <tr key={r.id}>
            <td><b>{r.name}</b></td><td className="small muted">{ROLE[r.role] ?? r.role}</td>
            <td><div className="row" style={{ gap: 8 }}><div style={{ width: 130, height: 8, background: 'var(--sunken, #EEF1EF)', borderRadius: 99, overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${Math.round(r.minutes / mx * 100)}%`, background: quiet(r) ? 'var(--bad)' : 'var(--ok, #1B6A4D)', borderRadius: 99 }} /></div><span className="num">{hm(r.minutes)}</span></div></td>
            <td className="r num">{r.days} of {per}</td><td className="small">{ago(r.last)}</td>
            <td>{quiet(r) ? <span className="chip late">Needs a talk</span> : <span className="chip done">Good</span>}</td>
          </tr>))}</tbody>
      </table></div>
      <p className="small muted">Time counts only while a person is really using the app: tapping, scrolling or typing, with the app in front. If the app is just left open, it stops counting after 2 minutes. Time alone does not mean good work, so use it together with the store scorecard.</p>
    </>
  );
}
