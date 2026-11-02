import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { timeOf, dayLabel } from '../lib/ist';
import type { Notice } from '../lib/types';
import { useToast } from '../components/Toast';

export function Notices() {
  const { locations } = useSession();
  const toast = useToast();
  const counters = locations.filter((l) => l.kind === 'department' && l.active);
  const [rows, setRows] = useState<Notice[]>([]);
  const [reads, setReads] = useState<Record<string, number>>({});
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [to, setTo] = useState<number[]>([]);
  const [days, setDays] = useState('7');
  const [pin, setPin] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('notices').select('*').order('created_at', { ascending: false }).limit(30);
    const n = (data as Notice[]) ?? []; setRows(n);
    if (n.length) {
      const r = await supabase.from('notice_reads').select('notice_id').in('notice_id', n.map((x) => x.id));
      const c: Record<string, number> = {}; for (const x of (r.data as { notice_id: string }[]) ?? []) c[x.notice_id] = (c[x.notice_id] ?? 0) + 1;
      setReads(c);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function post() {
    if (!title.trim()) { toast('Write a short heading first'); return; }
    setBusy(true);
    const exp = days === '0' ? null : new Date(Date.now() + Number(days) * 86400e3).toISOString();
    const { error } = await supabase.from('notices').insert({ title: title.trim(), body: body.trim(), location_ids: to.length ? to : null, pinned: pin, expires_at: exp });
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    setTitle(''); setBody(''); setTo([]); setPin(false); toast('Notice sent. It shows first on their screen.'); void load();
  }
  async function remove(id: string) { await supabase.from('notices').delete().eq('id', id); void load(); }
  const who = (n: Notice) => n.location_ids?.length ? n.location_ids.map((i) => counters.find((c) => c.id === i)?.name ?? '').filter(Boolean).join(', ') : 'Everyone';

  return (
    <>
      <div className="pagehead"><div><p className="label">Messages to the team</p><h1>Notices</h1></div></div>
      <p className="muted">A notice shows at the very top of the screen for the people you choose, above everything else, until they tap “Got it”.</p>
      <section className="card" style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
        <label className="field"><span>Heading</span><input id="n-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /></label>
        <label className="field"><span>Message (optional)</span><textarea id="n-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} /></label>
        <fieldset className="card" style={{ display: 'grid', gap: 8 }}>
          <legend className="label">Who should see it</legend>
          <div className="chips">
            <button className="btn secondary" aria-pressed={to.length === 0} onClick={() => setTo([])}>Everyone</button>
            {counters.map((c) => <button key={c.id} className="btn secondary" aria-pressed={to.includes(c.id)} onClick={() => setTo((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}>{c.name}</button>)}
          </div>
        </fieldset>
        <div className="row" style={{ gap: 12 }}>
          <label className="field"><span>Show for</span><select id="n-days" value={days} onChange={(e) => setDays(e.target.value)}><option value="1">1 day</option><option value="3">3 days</option><option value="7">7 days</option><option value="30">30 days</option><option value="0">Until I remove it</option></select></label>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />Keep it on top even after they read it</label>
        </div>
        <button className="btn primary" style={{ justifySelf: 'start' }} disabled={busy} onClick={() => void post()}>{busy ? 'Sending…' : 'Send notice'}</button>
      </section>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Notice</th><th>For</th><th>Read by</th><th style={{ width: 80 }}></th></tr></thead>
          <tbody>
            {rows.map((n) => <tr key={n.id}><td><strong>{n.title}</strong>{n.body && <div className="small muted">{n.body}</div>}<div className="small muted">{dayLabel(n.created_at.slice(0, 10))} {timeOf(n.created_at)}</div></td><td className="small">{who(n)}</td><td className="num">{reads[n.id] ?? 0}</td><td><button className="btn quiet" onClick={() => void remove(n.id)}>Remove</button></td></tr>)}
            {!rows.length && <tr><td colSpan={4} className="muted">No notices yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
