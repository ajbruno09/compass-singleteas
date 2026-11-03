import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { LANGUAGES, ROLE_LABEL, type Profile, type Role } from '../lib/types';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import type { Signup } from '../lib/types';

interface Person extends Profile { profile_locations: { location_id: number }[] }
const STAFF_ROLES: Role[] = ['department', 'store', 'closing', 'accounts', 'manager'];

async function callAdmin(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('staff-admin', { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') { try { const j = await ctx.json(); if (j?.error) msg = j.error; } catch { /* keep message */ } }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export function People() {
  const { profile, locations } = useSession();
  const [rows, setRows] = useState<Person[]>([]);
  const [editing, setEditing] = useState<Person | 'new' | null>(null);
  const [myPin, setMyPin] = useState(false);
  const isOwner = profile?.role === 'owner';

  async function load() {
    const { data } = await supabase.from('profiles').select('*, profile_locations(location_id)').order('role').order('full_name');
    setRows((data as Person[]) ?? []);
  }
  useEffect(() => { load(); }, []);
  const locName = (id: number) => locations.find((l) => l.id === id)?.name ?? '';

  return (
    <>
      <div className="pagehead">
        <div><p className="label">Team</p><h1>People</h1></div>
        {isOwner && <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" />Add person</button>}
      </div>
      {isOwner && <SignupApprovals onChanged={load} />}
      <p className="muted">Staff sign in with their mobile number and a 6-digit PIN. Each person sees only their own area. New people can join themselves at the Join page and wait here for your approval.</p>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Name</th><th>Mobile</th><th>Role</th><th>Works at</th><th>Extra language</th><th>Access</th><th></th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={isOwner && p.role !== 'owner' ? 'click' : ''} onClick={() => isOwner && p.role !== 'owner' && setEditing(p)}>
                <td className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>{p.photo ? <img src={p.photo} alt="" width={28} height={28} style={{ borderRadius: '50%', objectFit: 'cover' }} /> : <span className="avatar">{(p.full_name || '?')[0]}</span>}<strong>{p.full_name || p.email}</strong></td>
                <td className="num small">{p.phone ?? '—'}</td>
                <td>{ROLE_LABEL[p.role]}</td>
                <td className="small">{p.profile_locations.map((l) => locName(l.location_id)).join(', ') || '—'}</td>
                <td className="small">{p.extra_language ? LANGUAGES[p.extra_language] ?? p.extra_language : '—'}</td>
                <td>{p.active ? <span className="chip done">Active</span> : <span className="chip off">No access</span>}</td>
                <td>{isOwner && (p.role === 'owner' ? <button className="btn secondary" onClick={(e) => { e.stopPropagation(); setMyPin(true); }}>Change my PIN</button> : <button className="btn secondary" onClick={(e) => { e.stopPropagation(); setEditing(p); }}>Edit</button>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {myPin && <MyPin onClose={() => setMyPin(false)} />}
      {editing && <PersonForm person={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function PersonForm({ person, onClose, onSaved }: { person: Person | null; onClose: () => void; onSaved: () => void }) {
  const { locations } = useSession();
  const toast = useToast();
  const [name, setName] = useState(person?.full_name ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [role, setRole] = useState<Role>(person?.role ?? 'department');
  const [lang, setLang] = useState(person?.extra_language ?? '');
  const [locs, setLocs] = useState<number[]>(person?.profile_locations.map((l) => l.location_id) ?? []);
  const [active, setActive] = useState(person?.active ?? true);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const needsLocation = role === 'department';

  async function save() {
    setError('');
    if (!name.trim()) return setError('Enter the name.');
    if (needsLocation && locs.length === 0) return setError('Choose where this person works.');
    setBusy(true);
    try {
      if (!person) {
        if (!/^[6-9][0-9]{9}$/.test(phone)) throw new Error('Enter a 10-digit mobile number.');
        if (!/^[0-9]{6}$/.test(pin)) throw new Error('Set a 6-digit PIN for their first sign-in.');
        await callAdmin({ action: 'create', phone, pin, full_name: name.trim(), role, extra_language: lang || null, location_ids: locs });
        toast(`${name.trim()} can now sign in`);
      } else {
        const up = await supabase.from('profiles').update({ full_name: name.trim(), role, extra_language: lang || null, active }).eq('id', person.id);
        if (up.error) throw up.error;
        const del = await supabase.from('profile_locations').delete().eq('profile_id', person.id); if (del.error) throw del.error;
        if (locs.length) { const ins = await supabase.from('profile_locations').insert(locs.map((l) => ({ profile_id: person.id, location_id: l }))); if (ins.error) throw ins.error; }
        if (pin) { if (!/^[0-9]{6}$/.test(pin)) throw new Error('A new PIN must be 6 digits.'); await callAdmin({ action: 'reset_pin', user_id: person.id, pin }); }
        toast('Saved');
      }
      onSaved();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  return (
    <Sheet title={person ? person.full_name || 'Edit person' : 'Add person'} onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : person ? 'Save' : 'Create login'}</button></>}>
      <div className="form-grid">
        <label className="field"><span>Name</span><input id="person-name" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Mobile number</span><input id="person-phone" className="num" inputMode="numeric" maxLength={10} disabled={!!person} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} /></label>
        <label className="field"><span>Role</span><select id="person-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>{STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
        <label className="field"><span>Screen language</span><select id="person-lang" value={lang} onChange={(e) => setLang(e.target.value)}><option value="">English</option><option value="hi">हिंदी (Hindi)</option></select><span className="small muted">The store always sees English, whatever language they use.</span></label>
      </div>
      <fieldset className="card" style={{ display: 'grid', gap: 10 }}>
        <legend className="label">Works at</legend>
        {locations.map((l) => (
          <label key={l.id} className="row" style={{ gap: 10 }}>
            <input type="checkbox" checked={locs.includes(l.id)} onChange={(e) => setLocs((p) => (e.target.checked ? [...p, l.id] : p.filter((x) => x !== l.id)))} />{l.name}
          </label>
        ))}
      </fieldset>
      <label className="field"><span>{person ? 'New PIN (leave empty to keep)' : 'First PIN'}</span>
        <input id="person-pin" className="num" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="6 digits" />
        <span className="small muted">Tell the person their PIN directly. It is never shown again.</span></label>
      {person && person.photo && <button className="btn secondary" style={{ justifySelf: 'start' }} onClick={async () => { await supabase.rpc('clear_photo', { p_user: person.id }); toast('Photo cleared. They will take a new one.'); onSaved(); }}>Clear photo so they retake it</button>}
      {person && <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Can sign in</label>}
      {error && <p className="banner bad" role="alert">{error}</p>}
    </Sheet>
  );
}

function newCode() {
  for (;;) {
    const c = String(Math.floor(100000 + Math.random() * 900000));
    if (!/^(\d)\1{5}$/.test(c) && c !== '123456' && c !== '654321' && !/(012345|123456|234567|345678|456789)/.test(c)) return c;
  }
}

function SignupApprovals({ onChanged }: { onChanged: () => void }) {
  const { locations } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState<Signup[]>([]);
  const [open, setOpen] = useState<Signup | null>(null);
  const [given, setGiven] = useState<{ name: string; code: string } | null>(null);
  const load = async () => { const { data } = await supabase.from('pending_signups').select('*').eq('status', 'pending').order('created_at'); setRows((data as Signup[]) ?? []); };
  useEffect(() => { void load(); }, []);
  if (!rows.length && !given) return null;
  return (
    <>
      {rows.length > 0 && (
        <section className="card" style={{ display: 'grid', gap: 10 }}>
          <h2>Waiting for your approval</h2>
          {rows.map((r) => (
            <div key={r.id} className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row" style={{ gap: 12 }}>{r.selfie && <img src={r.selfie} alt="" width={56} height={56} style={{ borderRadius: '50%', objectFit: 'cover' }} />}<div><b>{r.full_name}</b><div className="small muted num">{r.phone}</div></div></div>
              <button className="btn primary" onClick={() => setOpen(r)}>Review</button>
            </div>
          ))}
        </section>
      )}
      {given && <p className="banner ok" role="status">Give {given.name} this first code: <b className="num" style={{ fontSize: 20, letterSpacing: 3 }}>{given.code}</b>. It is shown only now. <button className="btn quiet" onClick={() => setGiven(null)}>Done</button></p>}
      {open && <ApproveForm r={open} locations={locations} onClose={() => setOpen(null)} onDone={(name, code) => { setOpen(null); if (code) setGiven({ name, code }); void load(); onChanged(); toast(code ? `${name} approved` : `${name} declined`); }} />}
    </>
  );
}

function ApproveForm({ r, locations, onClose, onDone }: { r: Signup; locations: { id: number; name: string; kind: string }[]; onClose: () => void; onDone: (name: string, code: string | null) => void }) {
  const [role, setRole] = useState<Role>('department');
  const [lang, setLang] = useState('');
  const [locs, setLocs] = useState<number[]>([]);
  const [code, setCode] = useState(newCode());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function approve() {
    setError('');
    if (role === 'department' && !locs.length) return setError('Choose where this person works.');
    setBusy(true);
    try {
      const res = await callAdmin({ action: 'create', phone: r.phone, pin: code, full_name: r.full_name, role, extra_language: lang || null, location_ids: locs });
      const { error } = await supabase.rpc('decide_signup', { p_id: r.id, p_ok: true, p_user: res.id });
      if (error) throw error;
      onDone(r.full_name, code);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  async function decline() { setBusy(true); const { error } = await supabase.rpc('decide_signup', { p_id: r.id, p_ok: false }); setBusy(false); if (error) setError(errText(error)); else onDone(r.full_name, null); }
  return (
    <Sheet title={r.full_name} onClose={onClose} footer={<><button className="btn secondary" disabled={busy} onClick={() => void decline()}>Decline</button><button className="btn primary" disabled={busy} onClick={() => void approve()}>{busy ? 'Working…' : 'Approve'}</button></>}>
      <div className="row" style={{ gap: 14 }}>{r.selfie && <img src={r.selfie} alt="" width={120} height={120} style={{ borderRadius: '50%', objectFit: 'cover' }} />}<div><b>{r.full_name}</b><div className="num">{r.phone}</div><p className="small muted">Check that the photo is the right person before approving.</p></div></div>
      <div className="form-grid">
        <label className="field"><span>Role</span><select value={role} onChange={(e) => setRole(e.target.value as Role)}>{STAFF_ROLES.map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}</select></label>
        <label className="field"><span>Screen language</span><select value={lang} onChange={(e) => setLang(e.target.value)}><option value="">English</option><option value="hi">हिंदी (Hindi)</option></select></label>
      </div>
      <fieldset className="card" style={{ display: 'grid', gap: 10 }}>
        <legend className="label">Works at</legend>
        {locations.map((l) => <label key={l.id} className="row" style={{ gap: 10 }}><input type="checkbox" checked={locs.includes(l.id)} onChange={(e) => setLocs((p) => (e.target.checked ? [...p, l.id] : p.filter((x) => x !== l.id)))} />{l.name}</label>)}
      </fieldset>
      <div className="row" style={{ gap: 10 }}><span>First code: <b className="num" style={{ fontSize: 20, letterSpacing: 3 }}>{code}</b></span><button className="btn quiet" onClick={() => setCode(newCode())}>New code</button></div>
      {error && <p className="banner bad" role="alert">{error}</p>}
    </Sheet>
  );
}

function MyPin({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setError('');
    if (!/^[0-9]{6}$/.test(pin)) return setError('Your PIN must be 6 digits.');
    if (pin !== again) return setError('The two PINs do not match.');
    setBusy(true);
    const { error: e } = await supabase.auth.updateUser({ password: pin });
    setBusy(false);
    if (e) return setError(errText(e));
    toast('Your PIN is changed');
    onClose();
  }
  return (
    <Sheet title="Change my PIN" onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save PIN'}</button></>}>
      <label className="field"><span>New PIN</span><input className="num" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="6 digits" /></label>
      <label className="field"><span>Type it again</span><input className="num" type="password" inputMode="numeric" maxLength={6} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} placeholder="6 digits" /></label>
      {error && <p className="banner bad" role="alert">{error}</p>}
    </Sheet>
  );
}
