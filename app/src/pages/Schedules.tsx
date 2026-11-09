import { useCallback, useEffect, useState } from 'react';
import { TimePicker } from '../components/DatePicker';
import { supabase } from '../lib/supabase';
import { errText } from '../lib/format';
import { useToast } from '../components/Toast';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
interface P { id: string; full_name: string; role: string }
interface S { profile_id: string; weekly_off: number | null; shift_start: string | null; shift_end: string | null }

// Weekly off and shift timing for each person. They see it on their home screen.
export function Schedules() {
  const toast = useToast();
  const [people, setPeople] = useState<P[]>([]);
  const [sched, setSched] = useState<Record<string, S>>({});
  const load = useCallback(async () => {
    const [p, s] = await Promise.all([
      supabase.from('profiles').select('id, full_name, role').eq('active', true).in('role', ['department', 'closing', 'store', 'manager']).order('full_name'),
      supabase.from('staff_schedule').select('profile_id, weekly_off, shift_start, shift_end')
    ]);
    setPeople((p.data as P[]) ?? []);
    setSched(Object.fromEntries(((s.data as S[]) ?? []).map((x) => [x.profile_id, x])));
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function save(id: string, patch: Partial<S>) {
    const base: S = sched[id] ?? { profile_id: id, weekly_off: null, shift_start: null, shift_end: null };
    const cur: S = { ...base, ...patch };
    setSched((m) => ({ ...m, [id]: cur }));
    const { error } = await supabase.rpc('save_staff_schedule', { p_profile: id, p_off: cur.weekly_off, p_start: cur.shift_start ?? '', p_end: cur.shift_end ?? '' });
    if (error) { toast(errText(error)); void load(); }
  }
  return (
    <>
      <div className="pagehead"><div><p className="label">Team</p><h1>Weekly offs and shifts</h1></div></div>
      <p className="muted">Each person sees their own weekly off and shift on their home screen.</p>
      <div className="tablewrap"><table>
        <thead><tr><th>Person</th><th>Weekly off</th><th>Shift starts</th><th>Shift ends</th></tr></thead>
        <tbody>{people.map((p) => { const s = sched[p.id]; return (
          <tr key={p.id}><td><b>{p.full_name}</b><div className="small muted">{p.role}</div></td>
            <td><select aria-label={`Weekly off for ${p.full_name}`} value={s?.weekly_off ?? ''} onChange={(e) => void save(p.id, { weekly_off: e.target.value === '' ? null : Number(e.target.value) })}><option value="">Not set</option>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></td>
            <td><TimePicker label="Shift start" placeholder="Start" value={s?.shift_start ?? ''} onChange={(v) => void save(p.id, { shift_start: v })} /></td>
            <td><TimePicker label="Shift end" placeholder="End" value={s?.shift_end ?? ''} onChange={(v) => void save(p.id, { shift_end: v })} /></td></tr>); })}
          {!people.length && <tr><td colSpan={4} className="muted">No staff yet.</td></tr>}</tbody>
      </table></div>
    </>
  );
}
