import { Fragment, useCallback, useEffect, useState } from 'react';
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
  const [people, setPeople] = useState<{ id: string; full_name: string; role: string; profile_locations: { location_id: number }[] }[]>([]);
  const [who2, setWho2] = useState<string[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => { supabase.from('profiles').select('id, full_name, role, profile_locations(location_id)').eq('active', true).neq('role', 'owner').order('full_name').then(({ data }) => setPeople((data as typeof people) ?? [])); }, []);
  const [rows, setRows] = useState<Notice[]>([]);
  const [reads, setReads] = useState<Record<string, number>>({});
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [days, setDays] = useState('7');
  const [pin, setPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, { profile_id: string; full_name: string; seen_at: string | null; read_at: string | null }[]>>({});
  async function showStatus(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    const { data } = await supabase.rpc('notice_status', { p_id: id });
    setStatus((s) => ({ ...s, [id]: (data as typeof status[string]) ?? [] }));
  }
  const stamp = (t: string | null) => (t ? `${dayLabel(t.slice(0, 10))} ${timeOf(t)}` : '');

  const load = useCallback(async () => {
    const { data } = await supabase.from('notices').select('*').order('created_at', { ascending: false }).limit(30);
    const n = (data as Notice[]) ?? []; setRows(n);
    if (n.length) {
      const r = await supabase.from('notice_reads').select('notice_id').not('read_at', 'is', null).in('notice_id', n.map((x) => x.id));
      const c: Record<string, number> = {}; for (const x of (r.data as { notice_id: string }[]) ?? []) c[x.notice_id] = (c[x.notice_id] ?? 0) + 1;
      setReads(c);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function post() {
    if (!title.trim()) { toast('Write a short heading first'); return; }
    setBusy(true);
    const exp = days === '0' ? null : new Date(Date.now() + Number(days) * 86400e3).toISOString();
    const { error } = await supabase.from('notices').insert({ title: title.trim(), body: body.trim(), location_ids: null, profile_ids: who2.length ? who2 : null, pinned: pin, expires_at: exp });
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    setTitle(''); setBody(''); setWho2([]); setPin(false); toast('Notice sent. It shows first on their screen.'); void load();
  }
  async function remove(id: string) { await supabase.from('notices').delete().eq('id', id); void load(); }
  const who = (n: Notice) => n.profile_ids?.length ? n.profile_ids.map((i) => people.find((p) => p.id === i)?.full_name ?? '').filter(Boolean).join(', ') : n.location_ids?.length ? n.location_ids.map((i) => counters.find((c) => c.id === i)?.name ?? '').filter(Boolean).join(', ') : 'Everyone';
  const shownPeople = people.filter((p) => p.full_name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => setWho2((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const addCounter = (cid: number) => { const ids = people.filter((p) => p.profile_locations.some((l) => l.location_id === cid)).map((p) => p.id); setWho2((s) => Array.from(new Set([...s, ...ids]))); };

  return (
    <>
      <div className="pagehead"><div><p className="label">Messages to the team</p><h1>Notices</h1></div></div>
      <p className="muted">A notice shows at the very top of the screen for the people you choose, above everything else, until they tap “Got it”.</p>
      <section className="card" style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
        <label className="field"><span>Heading</span><input id="n-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /></label>
        <label className="field"><span>Message (optional)</span><textarea id="n-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} /></label>
        <fieldset className="card" style={{ display: 'grid', gap: 10 }}>
          <legend className="label">Who should see it</legend>
          <div className="chips">
            <button className={'btn secondary pick' + (who2.length === 0 ? ' on' : '')} aria-pressed={who2.length === 0} onClick={() => setWho2([])}>{who2.length === 0 ? '✓ ' : ''}Everyone</button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Or choose people. The notice follows the person on every counter they handle.</p>
          <input placeholder="Search a name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search a name" />
          <div className="chips">
            {shownPeople.map((p) => { const on = who2.includes(p.id); return <button key={p.id} className={'btn secondary pick' + (on ? ' on' : '')} aria-pressed={on} onClick={() => toggle(p.id)}>{on ? '✓ ' : ''}{p.full_name}<span className="small muted"> · {p.profile_locations.map((l) => counters.find((c) => c.id === l.location_id)?.name).filter(Boolean).join(', ') || p.role}</span></button>; })}
            {!shownPeople.length && <span className="muted small">No one found.</span>}
          </div>
          <div className="small muted">Quick add everyone on a counter:</div>
          <div className="chips">{counters.map((c) => <button key={c.id} className="btn quiet" onClick={() => addCounter(c.id)}>+ {c.name}</button>)}</div>
          <div className="small"><b>{who2.length === 0 ? 'Going to everyone' : who2.length + ' ' + (who2.length === 1 ? 'person' : 'people') + ' chosen'}</b></div>
        </fieldset>
        <div className="row" style={{ gap: 12 }}>
          <label className="field"><span>Show for</span><select id="n-days" value={days} onChange={(e) => setDays(e.target.value)}><option value="1">1 day</option><option value="3">3 days</option><option value="7">7 days</option><option value="30">30 days</option><option value="0">Until I remove it</option></select></label>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />Keep it on top even after they read it</label>
        </div>
        <button className="btn primary" style={{ justifySelf: 'start' }} disabled={busy} onClick={() => void post()}>{busy ? 'Sending…' : 'Send notice'}</button>
      </section>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Notice</th><th>For</th><th>Seen and acknowledged</th><th style={{ width: 80 }}></th></tr></thead>
          <tbody>
            {rows.map((n) => {
              const st = status[n.id];
              return (
                <Fragment key={n.id}>
                  <tr><td><strong>{n.title}</strong>{n.body && <div className="small muted">{n.body}</div>}<div className="small muted">{dayLabel(n.created_at.slice(0, 10))} {timeOf(n.created_at)}</div></td><td className="small">{who(n)}</td>
                    <td><button className="btn secondary" onClick={() => void showStatus(n.id)}>{reads[n.id] ?? 0} acknowledged {open === n.id ? '▲' : '▼'}</button></td>
                    <td><button className="btn quiet" onClick={() => void remove(n.id)}>Remove</button></td></tr>
                  {open === n.id && (
                    <tr><td colSpan={4}>
                      {!st ? <span className="muted small">Loading…</span> : st.length === 0 ? <span className="muted small">No one to show.</span> : (
                        <div style={{ display: 'grid', gap: 6 }}>
                          {st.map((x) => (
                            <div key={x.profile_id} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                              <b>{x.full_name}</b>
                              <span className="row" style={{ gap: 6 }}>
                                <span className={'chip ' + (x.seen_at ? 'info' : 'off')}>{x.seen_at ? 'Seen ' + stamp(x.seen_at) : 'Not seen yet'}</span>
                                <span className={'chip ' + (x.read_at ? 'done' : x.seen_at ? 'late' : 'off')}>{x.read_at ? 'Acknowledged ' + stamp(x.read_at) : x.seen_at ? 'Not acknowledged' : 'Not acknowledged'}</span>
                              </span>
                            </div>))}
                        </div>)}
                    </td></tr>)}
                </Fragment>
              );
            })}
            {!rows.length && <tr><td colSpan={4} className="muted">No notices yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
