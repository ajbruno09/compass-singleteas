import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { MaintRaise } from '../components/MaintRaise';
import { ago, type MReq } from './MaintStaff';

type R = MReq & { raiser?: string };
const URG: Record<string, [string, string]> = { wait: ['Can wait', 'off'], today: ['Today', 'late'], urgent: ['Urgent', 'flag'] };
const AREA_OF: Record<string, string> = { 'Plumbing and water': 'Plumbing' };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

function Photos({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    (async () => {
      const out: string[] = [];
      for (const p of paths) { const { data } = await supabase.storage.from('maint-photos').createSignedUrl(p, 3600); if (data?.signedUrl) out.push(data.signedUrl); }
      if (live) setUrls(out);
    })();
    return () => { live = false; };
  }, [paths.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!paths.length) return null;
  return <div className="row" style={{ gap: 8, marginTop: 8 }}>{urls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Photo of the problem" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 10 }} /></a>)}</div>;
}

export function MaintRequests() {
  const { profile } = useSession();
  const toast = useToast();
  const canAct = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'store';
  const [rows, setRows] = useState<R[]>([]);
  const [tab, setTab] = useState<'open' | 'fixed'>('open');
  const [raise, setRaise] = useState(false);
  const [job, setJob] = useState<R | null>(null);
  const [fix, setFix] = useState<R | null>(null);
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([supabase.from('maint_requests').select('*').order('created_at', { ascending: false }).limit(200), supabase.from('profiles').select('id,full_name')]);
    const nm = new Map(((b.data as { id: string; full_name: string }[]) ?? []).map((p) => [p.id, p.full_name]));
    setRows(((a.data as R[]) ?? []).map((r) => ({ ...r, raiser: nm.get(r.raised_by) })));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const open = rows.filter((r) => r.status !== 'fixed').sort((x, y) => (x.urgency === 'urgent' ? 0 : x.urgency === 'today' ? 1 : 2) - (y.urgency === 'urgent' ? 0 : y.urgency === 'today' ? 1 : 2));
  const fixed = rows.filter((r) => r.status === 'fixed');
  const list = tab === 'open' ? open : fixed;
  return (
    <>
      <div className="pagehead"><div><p className="label">Maintenance</p><h1>Maintenance requests</h1><p className="muted small" style={{ marginTop: 2 }}>Problems raised by the team, with photos. Make a job to schedule the repair, then mark it fixed.</p></div>
        <button className="btn primary" onClick={() => setRaise(true)}><Icon name="plus" /> Raise a request</button></div>
      <div className="seg"><button aria-pressed={tab === 'open'} onClick={() => setTab('open')}>Open ({open.length})</button><button aria-pressed={tab === 'fixed'} onClick={() => setTab('fixed')}>Fixed ({fixed.length})</button></div>
      {list.length === 0 ? <p className="empty card">{tab === 'open' ? 'No open requests.' : 'Nothing fixed yet.'}</p> : <div className="stack">{list.map((r) => (
        <div key={r.id} className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div><b>{r.category}</b> <span className="muted small">· {r.where_text}</span>
              {r.note && <div>{r.note}</div>}
              <div className="small muted">{r.raiser ?? 'Staff'} · {ago(r.created_at)}{r.status === 'fixed' && r.fix_note ? ` · Fixed: ${r.fix_note}` : ''}</div></div>
            <div className="row" style={{ gap: 6 }}>{r.status === 'fixed' ? <span className="chip ok">Fixed</span> : <>{r.status === 'job' && <span className="chip due">Job made</span>}<span className={'chip ' + URG[r.urgency][1]}>{URG[r.urgency][0]}</span></>}</div></div>
          <Photos paths={r.photos} />
          {canAct && r.status !== 'fixed' && <div className="row" style={{ marginTop: 10 }}>
            {r.status === 'new' && <button className="btn" onClick={() => setJob(r)}>Make a job</button>}
            <button className="btn primary" onClick={() => setFix(r)}>Mark fixed</button></div>}
        </div>))}</div>}
      {raise && <Sheet title="Raise a request" onClose={() => setRaise(false)}><MaintRaise onDone={() => { setRaise(false); void load(); }} /></Sheet>}
      {job && <JobSheet r={job} onClose={() => setJob(null)} onDone={() => { setJob(null); void load(); toast('Job made. It is under Jobs and schedules.'); }} />}
      {fix && <FixSheet r={fix} onClose={() => setFix(null)} onDone={() => { setFix(null); void load(); window.dispatchEvent(new Event('compass:maint')); toast('Marked fixed'); }} />}
    </>
  );
}

function JobSheet({ r, onClose, onDone }: { r: R; onClose: () => void; onDone: () => void }) {
  const [vendor, setVendor] = useState(''); const [by, setBy] = useState(today()); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function save() {
    setBusy(true); setErr('');
    const a = await supabase.rpc('save_maint', { p_id: null, p_title: `${r.category}: ${r.where_text}`, p_area: AREA_OF[r.category] ?? r.category, p_kind: 'repair', p_vendor: vendor, p_repeat: null, p_next: by || null, p_notes: r.note });
    if (a.error) { setBusy(false); return setErr(errText(a.error)); }
    const b = await supabase.rpc('maint_request_job', { p_id: r.id, p_task: a.data as number });
    setBusy(false); if (b.error) return setErr(errText(b.error)); onDone();
  }
  return <Sheet title="Make a job" onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Make job'}</button></>}>
    <p><b>{r.category}</b> · {r.where_text}</p>{r.note && <p className="small muted">{r.note}</p>}
    <label className="field"><span>Vendor or technician</span><input value={vendor} onChange={(e) => setVendor(e.target.value)} /></label>
    <label className="field"><span>Needed by</span><input type="date" value={by} onChange={(e) => setBy(e.target.value)} /></label>
    {err && <p className="banner bad" role="alert">{err}</p>}</Sheet>;
}

function FixSheet({ r, onClose, onDone }: { r: R; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function save() { setBusy(true); const { error } = await supabase.rpc('maint_request_fix', { p_id: r.id, p_note: note.trim() }); setBusy(false); if (error) return setErr(errText(error)); onDone(); }
  return <Sheet title="Mark fixed" onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Mark fixed'}</button></>}>
    <p><b>{r.category}</b> · {r.where_text}</p>
    <label className="field"><span>What was done (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Burner cleaned, working" /></label>
    {err && <p className="banner bad" role="alert">{err}</p>}</Sheet>;
}
