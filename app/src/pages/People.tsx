import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { LANGUAGES, ROLE_LABEL, type Profile, type Role } from '../lib/types';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

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
      <p className="muted">Staff sign in with their mobile number and a 6-digit PIN. Each person sees only their own area.</p>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Name</th><th>Mobile</th><th>Role</th><th>Works at</th><th>Extra language</th><th>Access</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={isOwner && p.role !== 'owner' ? 'click' : ''} onClick={() => isOwner && p.role !== 'owner' && setEditing(p)}>
                <td><strong>{p.full_name || p.email}</strong></td>
                <td className="num small">{p.phone ?? '—'}</td>
                <td>{ROLE_LABEL[p.role]}</td>
                <td className="small">{p.profile_locations.map((l) => locName(l.location_id)).join(', ') || '—'}</td>
                <td className="small">{p.extra_language ? LANGUAGES[p.extra_language] ?? p.extra_language : '—'}</td>
                <td>{p.active ? <span className="chip done">Active</span> : <span className="chip off">No access</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
        <label className="field"><span>Extra language</span><select id="person-lang" value={lang} onChange={(e) => setLang(e.target.value)}><option value="">English only</option>{Object.entries(LANGUAGES).map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></label>
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
      {person && <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Can sign in</label>}
      {error && <p className="banner bad" role="alert">{error}</p>}
    </Sheet>
  );
}
