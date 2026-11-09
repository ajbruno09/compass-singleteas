import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import type { Notice } from '../lib/types';
import { useToast } from '../components/Toast';
import { DatePicker, TimePicker, niceDate, niceTime } from '../components/DatePicker';
import { Icon } from '../components/Icon';
import '../nt.css';

type Person = { id: string; full_name: string; role: string; profile_locations: { location_id: number }[] };
type Status = { profile_id: string; full_name: string; seen_at: string | null; read_at: string | null };
const ROLES: { k: string; label: string; roles: string[] }[] = [
  { k: 'owner', label: 'Admin', roles: ['owner'] }, { k: 'store', label: 'Store', roles: ['store'] },
  { k: 'staff', label: 'Counter staff', roles: ['department', 'closing'] }, { k: 'accounts', label: 'Accounts', roles: ['accounts'] }, { k: 'manager', label: 'Manager', roles: ['manager'] }
];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const hm = (t: string) => niceTime(`${new Date(t).getHours()}:${String(new Date(t).getMinutes()).padStart(2, '0')}`);
const sent = (t: string) => { const d = new Date(t); return `${d.getDate()} ${MON[d.getMonth()]}, ${hm(t)}`; };
const seenAt = (t: string) => (new Date(t).toDateString() === new Date().toDateString() ? hm(t) : sent(t));

export function Notices() {
  const { locations } = useSession();
  const toast = useToast();
  const counters = locations.filter((l) => l.kind === 'department' && l.active);
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => { supabase.from('profiles').select('id, full_name, role, profile_locations(location_id)').eq('active', true).neq('role', 'owner').order('full_name').then(({ data }) => setPeople((data as unknown as Person[]) ?? [])); }, []);
  const [rows, setRows] = useState<Notice[]>([]);
  const [ov, setOv] = useState<Record<string, { total: number; seen: number }>>({});
  const [status, setStatus] = useState<Record<string, Status[]>>({});
  const [open, setOpen] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [k, setK] = useState<'all' | 'role' | 'counter' | 'people'>('all');
  const [pickRoles, setPickRoles] = useState<string[]>([]);
  const [pickCounters, setPickCounters] = useState<number[]>([]);
  const [pickPeople, setPickPeople] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [later, setLater] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [pin, setPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [n, o] = await Promise.all([
      supabase.from('notices').select('*').order('send_at', { ascending: false }).limit(60),
      supabase.rpc('notice_overview')
    ]);
    setRows((n.data as Notice[]) ?? []);
    const m: Record<string, { total: number; seen: number }> = {};
    for (const x of (o.data as { notice_id: string; total: number; seen: number }[]) ?? []) m[x.notice_id] = { total: x.total, seen: x.seen };
    setOv(m);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const now = Date.now();
  const live = rows.filter((n) => !n.expires_at || new Date(n.expires_at).getTime() > now || (n.pinned && !n.expires_at));
  const sentRows = live.filter((n) => new Date(n.send_at ?? n.created_at).getTime() <= now);
  const schedRows = live.filter((n) => new Date(n.send_at ?? n.created_at).getTime() > now).sort((a, b) => (a.send_at ?? '').localeCompare(b.send_at ?? ''));

  const audience = (n: Notice) => {
    if (n.profile_ids?.length) { const names = n.profile_ids.map((i) => people.find((p) => p.id === i)?.full_name).filter(Boolean) as string[]; return names.length > 3 ? `${names.length} people` : names.join(', '); }
    if (n.roles?.length) return ROLES.filter((r) => r.roles.some((x) => n.roles!.includes(x))).map((r) => r.label).join(', ');
    if (n.location_ids?.length) return n.location_ids.length === counters.length ? 'All counters' : n.location_ids.map((i) => locations.find((l) => l.id === i)?.name).filter(Boolean).join(', ');
    return 'Everyone';
  };

  const count = k === 'all' ? people.length : k === 'role' ? pickRoles.length : k === 'counter' ? pickCounters.length : pickPeople.length;
  const countLine = k === 'all' ? `Goes to ${people.length} people` : count ? `${count} selected` : 'Nobody picked yet';
  const sendAt = later && date && time ? new Date(`${date}T${time}:00`) : null;
  const sum = sendAt ? `Will go out ${niceDate(date)} at ${niceTime(time)}` : '';
  const chipDay = (n: number) => (date === addDays(n) ? ' nt-on' : '');
  const sunday = (7 - new Date().getDay()) % 7 || 7;
  const tog = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  function reset() { setTitle(''); setBody(''); setK('all'); setPickRoles([]); setPickCounters([]); setPickPeople([]); setQ(''); setLater(false); setDate(''); setTime(''); setPin(false); setEditing(null); }

  async function send() {
    if (!title.trim()) { toast('Write a short heading first'); return; }
    if (k !== 'all' && !count) { toast('Pick who should see it'); return; }
    if (later && !sendAt) { toast('Choose the date and time to send'); return; }
    if (later && sendAt && sendAt.getTime() <= Date.now()) { toast('Pick a time that is still ahead'); return; }
    const at = later && sendAt ? sendAt : new Date();
    const payload = {
      title: title.trim(), body: body.trim(), pinned: pin,
      profile_ids: k === 'people' ? pickPeople : null,
      roles: k === 'role' ? ROLES.filter((r) => pickRoles.includes(r.k)).flatMap((r) => r.roles) : null,
      location_ids: k === 'counter' ? pickCounters : null,
      send_at: at.toISOString(),
      expires_at: pin ? null : new Date(at.getTime() + 14 * 86400e3).toISOString()
    };
    setBusy(true);
    const { error } = editing ? await supabase.from('notices').update(payload).eq('id', editing) : await supabase.from('notices').insert(payload);
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    toast(later ? 'Notice scheduled.' : editing ? 'Changes saved.' : 'Notice sent. It shows first on their screen.');
    reset(); void load();
  }
  function change(n: Notice) {
    setEditing(n.id); setTitle(n.title); setBody(n.body ?? ''); setPin(n.pinned);
    if (n.profile_ids?.length) { setK('people'); setPickPeople(n.profile_ids); }
    else if (n.roles?.length) { setK('role'); setPickRoles(ROLES.filter((r) => r.roles.some((x) => n.roles!.includes(x))).map((r) => r.k)); }
    else if (n.location_ids?.length) { setK('counter'); setPickCounters(n.location_ids); }
    else setK('all');
    const d = new Date(n.send_at ?? n.created_at);
    setLater(true); setDate(iso(d)); setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function cancel(n: Notice) {
    if (!window.confirm(`Cancel "${n.title}"? It will not go out.`)) return;
    const { error } = await supabase.from('notices').update({ expires_at: new Date().toISOString() }).eq('id', n.id);
    if (error) { toast(errText(error)); return; }
    if (editing === n.id) reset();
    toast('Cancelled.'); void load();
  }
  async function toggle(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    const { data } = await supabase.rpc('notice_status', { p_id: id });
    setStatus((s) => ({ ...s, [id]: (data as Status[]) ?? [] }));
  }
  async function again(id: string) {
    const { data, error } = await supabase.rpc('notice_resend', { p_id: id });
    if (error) { toast(errText(error)); return; }
    toast(`Sent again to ${data ?? 0} ${data === 1 ? 'person' : 'people'}.`);
  }
  const shownPeople = useMemo(() => people.filter((p) => p.full_name.toLowerCase().includes(q.toLowerCase())), [people, q]);
  const placeOf = (p: Person) => p.profile_locations.map((l) => locations.find((x) => x.id === l.location_id)?.name).filter(Boolean).join(', ') || ROLES.find((r) => r.roles.includes(p.role))?.label || '';

  return (
    <div className="nt">
      <div className="nt-mut nt-sm">Setup</div><h1>Notices</h1>
      <p className="nt-mut">A notice shows at the very top of the screen for the people you choose, until they tap "Got it". It now reaches the Store and Admin screens too, not only counter phones.</p>

      <div className="nt-layout">
        <div className="nt-card" style={{ padding: '16px 18px' }}>
          <h2>{editing ? 'Change scheduled notice' : 'New notice'}</h2>
          <label className="nt-lbl" htmlFor="n-title">Heading</label>
          <input id="n-title" placeholder="For example: Diwali timings" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
          <label className="nt-lbl" htmlFor="n-body">Message (optional)</label>
          <textarea id="n-body" value={body} maxLength={500} onChange={(e) => setBody(e.target.value)} />
          <label className="nt-lbl">Who should see it</label>
          <div className="nt-seg">
            {([['all', 'Everyone'], ['role', 'By role'], ['counter', 'By counter'], ['people', 'Pick people']] as const).map(([v, l]) => <button key={v} type="button" className={k === v ? 'nt-on' : ''} onClick={() => setK(v)}>{l}</button>)}
          </div>
          <div>
            {k === 'all' && <p className="nt-sm nt-mut" style={{ marginTop: 8 }}>Everyone with a Compass login: counters, Store and Admin.</p>}
            {k === 'role' && <div className="nt-pp" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>{ROLES.map((r) => <label key={r.k}><input type="checkbox" checked={pickRoles.includes(r.k)} onChange={() => setPickRoles((s) => tog(s, r.k))} /> {r.label}</label>)}</div>}
            {k === 'counter' && <div className="nt-pp">{counters.map((c) => <label key={c.id}><input type="checkbox" checked={pickCounters.includes(c.id)} onChange={() => setPickCounters((s) => tog(s, c.id))} /> {c.name}</label>)}</div>}
            {k === 'people' && <><input placeholder="Search a name" style={{ marginTop: 8 }} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search a name" /><div className="nt-pp">{shownPeople.map((p) => <label key={p.id}><input type="checkbox" checked={pickPeople.includes(p.id)} onChange={() => setPickPeople((s) => tog(s, p.id))} /> {p.full_name}<span>{placeOf(p)}</span></label>)}</div></>}
          </div>
          <label className="nt-lbl">When to send</label>
          <div className="nt-seg">
            <button type="button" className={!later ? 'nt-on' : ''} onClick={() => setLater(false)}>Send now</button>
            <button type="button" className={later ? 'nt-on' : ''} onClick={() => setLater(true)}>Schedule</button>
          </div>
          {later && (
            <div className="nt-sched">
              <div className="nt-chips">
                <button type="button" className={'nt-chp' + chipDay(0)} onClick={() => setDate(addDays(0))}>Today</button>
                <button type="button" className={'nt-chp' + chipDay(1)} onClick={() => setDate(addDays(1))}>Tomorrow</button>
                <button type="button" className={'nt-chp' + chipDay(sunday)} onClick={() => setDate(addDays(sunday))}>Sunday</button>
                {[['8:00 am', '08:00'], ['12:00 pm', '12:00'], ['5:00 pm', '17:00']].map(([l, v]) => <button key={v} type="button" className={'nt-chp' + (time === v ? ' nt-on' : '')} onClick={() => setTime(v)}>{l}</button>)}
              </div>
              <div className="nt-row2">
                <DatePicker value={date} onChange={setDate} min={iso(new Date())} label="Send date" />
                <TimePicker value={time} onChange={setTime} label="Send time" />
              </div>
              <div className="nt-sum">{sum}</div>
            </div>
          )}
          <div className="nt-to">
            <span className="nt-sm nt-mut">{countLine}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {editing && <button type="button" className="nt-btn" onClick={reset}>Discard</button>}
              <label className="nt-sm nt-mut" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /> Pin to top</label>
              <button type="button" className="nt-btn nt-p" disabled={busy} onClick={() => void send()}>{busy ? 'Sending…' : editing ? 'Save changes' : 'Send notice'}</button>
            </div>
          </div>
        </div>

        <div>
          <div className="nt-card">
            <div style={{ padding: '14px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2>Sent notices</h2><span className="nt-sm nt-mut">Tap one to see who has not seen it</span></div>
            <div>
              {sentRows.map((n) => {
                const o = ov[n.id] ?? { total: 0, seen: 0 };
                const miss = o.total - o.seen;
                const st = status[n.id];
                const notSeen = st?.filter((x) => !x.read_at) ?? [];
                const seen = st?.filter((x) => x.read_at) ?? [];
                return (
                  <Fragment key={n.id}>
                    <div className="nt-n" onClick={() => void toggle(n.id)}>
                      <div className="nt-t"><b>{n.pinned && <><span className="nt-pin"><Icon name="pin" size={14} stroke={1.8} /></span> </>}{n.title}</b><span>{audience(n)} · Sent {sent(n.send_at ?? n.created_at)}{n.pinned ? ' · pinned' : ''}</span></div>
                      <div><div className="nt-bar"><i style={{ width: `${o.total ? (o.seen / o.total) * 100 : 0}%` }} /></div></div>
                      <div className="nt-seen">{miss > 0 ? <span style={{ color: 'var(--bad)' }}>{o.seen} of {o.total} seen</span> : <>{o.seen} of {o.total} seen ✓</>}</div>
                    </div>
                    {open === n.id && (
                      <div className="nt-det">
                        {!st ? <div className="nt-sm nt-mut" style={{ marginTop: 10 }}>Loading…</div> : <>
                          {notSeen.length > 0 && <><div className="nt-sm nt-mut" style={{ marginTop: 10 }}>Not seen yet</div><div className="nt-who">{notSeen.map((x) => <span key={x.profile_id} className="nt-tag nt-r">{x.full_name}</span>)}</div></>}
                          {seen.length > 0 && <><div className="nt-sm nt-mut" style={{ marginTop: 10 }}>Seen, with the time they tapped Got it</div><div className="nt-who">{seen.map((x) => <span key={x.profile_id} className="nt-tag nt-g">{x.full_name} · {seenAt(x.read_at!)}</span>)}</div></>}
                          {notSeen.length > 0 && <div style={{ marginTop: 10 }}><button type="button" className="nt-btn" onClick={() => void again(n.id)}>Send again to those who have not seen it</button></div>}
                        </>}
                      </div>
                    )}
                  </Fragment>
                );
              })}
              {!sentRows.length && <div className="nt-n" style={{ cursor: 'default' }}><span className="nt-mut">No notices sent yet.</span></div>}
            </div>
          </div>
          <div className="nt-card" style={{ marginTop: 16 }}>
            <div style={{ padding: '14px 16px 8px', display: 'flex', justifyContent: 'space-between' }}><h2>Scheduled</h2><span className="nt-sm nt-mut">Goes out by itself</span></div>
            {schedRows.map((n) => {
              const d = new Date(n.send_at ?? n.created_at);
              return (
                <div key={n.id} className="nt-n" style={{ cursor: 'default' }}>
                  <div className="nt-t"><b>{n.title}</b><span>{audience(n)} · Goes out {niceDate(iso(d))}, {hm(d.toISOString())}</span></div>
                  <button type="button" className="nt-btn" onClick={() => change(n)}>Change</button>
                  <button type="button" className="nt-btn" onClick={() => void cancel(n)}>Cancel</button>
                </div>
              );
            })}
            {!schedRows.length && <div className="nt-n" style={{ cursor: 'default' }}><span className="nt-mut">Nothing scheduled.</span></div>}
          </div>
        </div>
      </div>
    </div>
  );
}
