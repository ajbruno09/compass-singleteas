import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText, money } from '../lib/format';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

interface T { id: number; title: string; area: string; kind: 'repair' | 'recurring'; vendor_name: string; repeat_days: number | null; next_due: string | null; last_done: string | null; status: 'open' | 'done'; notes: string; cost: number | null }
interface Log { id: number; task_id: number; done_on: string; cost: number | null; vendor_name: string; note: string }
const AREAS = ['Burner and gas', 'Kitchen exhaust', 'Pest control', 'Electrical', 'Plumbing', 'Refrigeration', 'Equipment', 'Civil work', 'Cleaning', 'Other'];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const nice = (s: string | null) => (s ? new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(s + 'T00:00:00')) : 'no date');
const diffDays = (s: string) => Math.round((new Date(s + 'T00:00:00').getTime() - new Date(today() + 'T00:00:00').getTime()) / 86400000);

export function Maintenance() {
  const { profile } = useSession();
  const toast = useToast();
  const canDelete = profile?.role === 'owner' || profile?.role === 'manager';
  const [tasks, setTasks] = useState<T[]>([]); const [log, setLog] = useState<Log[]>([]);
  const [edit, setEdit] = useState<T | 'new' | null>(null); const [done, setDone] = useState<T | null>(null); const [msg, setMsg] = useState<T | null>(null);
  const [tab, setTab] = useState<'open' | 'history'>('open');
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([supabase.from('maint_tasks').select('*').order('next_due', { ascending: true, nullsFirst: false }), supabase.from('maint_log').select('*').order('done_on', { ascending: false }).limit(200)]);
    setTasks((a.data as T[]) ?? []); setLog((b.data as Log[]) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const open = tasks.filter((t) => t.status === 'open');
  const label = (t: T) => { if (!t.next_due) return { c: 'off', w: 'No date' }; const d = diffDays(t.next_due); return d < 0 ? { c: 'flag', w: `Overdue by ${-d} day${d === -1 ? '' : 's'}` } : d === 0 ? { c: 'late', w: 'Due today' } : d === 1 ? { c: 'late', w: 'Due tomorrow' } : d <= 7 ? { c: 'due', w: `In ${d} days` } : { c: 'off', w: `In ${d} days` }; };
  async function remove(t: T) { if (!window.confirm(`Delete "${t.title}" and its history?`)) return; const { error } = await supabase.rpc('delete_maint', { p_id: t.id }); if (error) toast(errText(error)); else { toast('Deleted'); void load(); } }
  return (
    <>
      <div className="pagehead"><div><p className="label">Store</p><h1>Maintenance</h1><p className="muted small" style={{ marginTop: 2 }}>Burners, exhaust, pest control, electrical and repairs. Repeating jobs remind you the day before.</p></div>
        <button className="btn primary" onClick={() => setEdit('new')}><Icon name="plus" /> Add job</button></div>
      <div className="seg"><button aria-pressed={tab === 'open'} onClick={() => setTab('open')}>Open jobs ({open.length})</button><button aria-pressed={tab === 'history'} onClick={() => setTab('history')}>History</button></div>
      {tab === 'open' ? (open.length === 0 ? <p className="empty card">No open jobs. Add pest control, exhaust cleaning or a repair.</p> : <div className="stack">{open.map((t) => { const l = label(t); return (
        <div key={t.id} className="card"><div className="row" style={{ justifyContent: 'space-between' }}>
          <div><b>{t.title}</b> <span className="muted small">· {t.area}{t.vendor_name ? ` · ${t.vendor_name}` : ''}</span>
            <div className="small muted">{t.kind === 'recurring' ? `Every ${t.repeat_days} days · ` : 'One time repair · '}next {nice(t.next_due)}{t.last_done ? ` · last done ${nice(t.last_done)}` : ''}</div>{t.notes && <div className="small">{t.notes}</div>}</div>
          <div className="row"><span className={'chip ' + l.c}>{l.w}</span></div></div>
          <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={() => setDone(t)}>Mark done</button><button className="btn" onClick={() => setMsg(t)}>Message for vendor</button><button className="btn quiet" onClick={() => setEdit(t)}>Edit</button>{canDelete && <button className="btn quiet" onClick={() => remove(t)} aria-label="Delete"><Icon name="trash" /></button>}</div></div>); })}</div>)
        : log.length === 0 ? <p className="empty card">Nothing done yet.</p> : <div className="tablewrap"><table><thead><tr><th>Done on</th><th>Job</th><th>Who did it</th><th className="r">Cost</th><th>Note</th></tr></thead><tbody>{log.map((x) => <tr key={x.id}><td>{nice(x.done_on)}</td><td><b>{tasks.find((t) => t.id === x.task_id)?.title ?? ''}</b></td><td>{x.vendor_name}</td><td className="r num">{x.cost != null ? money(x.cost) : '—'}</td><td className="small">{x.note}</td></tr>)}</tbody></table></div>}
      {edit && <JobForm t={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />}
      {done && <DoneForm t={done} onClose={() => setDone(null)} onSaved={() => { setDone(null); void load(); }} />}
      {msg && <MessageSheet t={msg} onClose={() => setMsg(null)} />}
    </>
  );
}

function JobForm({ t, onClose, onSaved }: { t: T | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(t?.title ?? ''); const [area, setArea] = useState(t?.area ?? AREAS[0]); const [kind, setKind] = useState<'repair' | 'recurring'>(t?.kind ?? 'recurring');
  const [vendor, setVendor] = useState(t?.vendor_name ?? ''); const [rep, setRep] = useState(t?.repeat_days?.toString() ?? '15'); const [next, setNext] = useState(t?.next_due ?? today()); const [notes, setNotes] = useState(t?.notes ?? '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function save() {
    if (!title.trim()) return setErr('Give the job a name.'); if (kind === 'recurring' && !(Number(rep) > 0)) return setErr('Say how many days between visits.');
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('save_maint', { p_id: t?.id ?? null, p_title: title, p_area: area, p_kind: kind, p_vendor: vendor, p_repeat: kind === 'recurring' ? Number(rep) : null, p_next: next || null, p_notes: notes });
    setBusy(false); if (error) return setErr(errText(error)); toast('Saved'); onSaved();
  }
  return <Sheet title={t ? 'Edit job' : 'Add job'} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save job'}</button></>}>
    <label className="field"><span>Job</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pest control, Exhaust cleaning" /></label>
    <div className="form-grid"><label className="field"><span>Area</span><select value={area} onChange={(e) => setArea(e.target.value)}>{AREAS.map((a) => <option key={a}>{a}</option>)}</select></label>
      <label className="field"><span>Type</span><select value={kind} onChange={(e) => setKind(e.target.value as 'repair' | 'recurring')}><option value="recurring">Repeats on a schedule</option><option value="repair">One time repair</option></select></label>
      {kind === 'recurring' && <label className="field"><span>Repeat every (days)</span><input inputMode="numeric" className="num" value={rep} onChange={(e) => setRep(e.target.value)} /></label>}
      <label className="field"><span>{kind === 'recurring' ? 'Next due' : 'Needed by'}</span><input type="date" value={next} onChange={(e) => setNext(e.target.value)} /></label>
      <label className="field"><span>Vendor or technician</span><input value={vendor} onChange={(e) => setVendor(e.target.value)} /></label></div>
    <label className="field"><span>Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
    {err && <p className="banner bad" role="alert">{err}</p>}</Sheet>;
}

function DoneForm({ t, onClose, onSaved }: { t: T; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [on, setOn] = useState(today()); const [cost, setCost] = useState(''); const [vendor, setVendor] = useState(t.vendor_name); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function save() { setBusy(true); const { error } = await supabase.rpc('maint_done', { p_id: t.id, p_done_on: on, p_cost: cost === '' ? null : Number(cost), p_vendor: vendor, p_note: note }); setBusy(false); if (error) return setErr(errText(error)); toast(t.kind === 'recurring' ? `Done. Next one is due in ${t.repeat_days} days.` : 'Marked done'); onSaved(); }
  return <Sheet title={`Mark done: ${t.title}`} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Mark done'}</button></>}>
    <div className="form-grid"><label className="field"><span>Done on</span><input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></label><label className="field"><span>Cost (₹)</span><input inputMode="decimal" className="num" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
      <label className="field"><span>Who did it</span><input value={vendor} onChange={(e) => setVendor(e.target.value)} /></label></div>
    <label className="field"><span>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
    {t.kind === 'recurring' && <p className="small muted">The next visit will be set {t.repeat_days} days after this date.</p>}{err && <p className="banner bad" role="alert">{err}</p>}</Sheet>;
}

function MessageSheet({ t, onClose }: { t: T; onClose: () => void }) {
  const toast = useToast();
  const text = `Hello, this is Single Teas, Bilekahalli. Our ${t.title.toLowerCase()} is due ${t.next_due ? `on ${nice(t.next_due)}` : 'soon'}. Please confirm the time you can come. Thank you.`;
  const [v, setV] = useState(text);
  return <Sheet title="Message for the vendor" onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Close</button><button className="btn" onClick={() => { void navigator.clipboard?.writeText(v).then(() => toast('Copied. Paste it in the group.')); }}>Copy</button><a className="btn primary" href={`https://wa.me/?text=${encodeURIComponent(v)}`} target="_blank" rel="noreferrer">Open WhatsApp</a></>}>
    <textarea style={{ minHeight: 140 }} value={v} onChange={(e) => setV(e.target.value)} /><p className="small muted">Copy it and paste it in the vendor's WhatsApp group, or tap Open WhatsApp and choose the group.</p></Sheet>;
}
