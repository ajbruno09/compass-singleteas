import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { useToast } from '../components/Toast';

interface Cyl { code: string; tare_g: number; status: string; supplier: string | null; last_gross_g: number | null; location_id: number | null; shortfall_g: number; last_weigh_date: string | null; received_at: string | null }
interface ToWeigh { code: string; location_id: number; location_name: string; tare_g: number; last_gross_g: number; weighed_today: boolean }

const kg = (g: number | null | undefined, d = 2) => (g == null ? '' : (g / 1000).toFixed(d).replace(/\.?0+$/, ''));
const toG = (s: string) => Math.round((parseFloat(s) || 0) * 1000);
const REASONS = ['Party order', 'Management request', 'Kitchen request', 'Extra cylinder', 'Other'];

async function sendPhoto(code: string, f: File): Promise<string> {
  const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${code}/${Date.now()}.${ext}`;
  const up = await supabase.storage.from('cylinder-photos').upload(path, f, { upsert: false });
  if (up.error) throw up.error;
  return path;
}

function PhotoPick({ file, set }: { file: File | null; set: (f: File | null) => void }) {
  return (
    <label className="btn secondary" style={{ cursor: 'pointer' }}>
      {file ? 'Photo taken. Retake' : 'Take photo'}
      <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => set(e.target.files?.[0] ?? null)} />
    </label>
  );
}

// ---------- Nightly weigh: whoever has the duty sees the cylinders issued to their own counters ----------
function WeighTab({ canSeeAll }: { canSeeAll: boolean }) {
  const toast = useToast();
  const [rows, setRows] = useState<ToWeigh[] | null>(null);
  const [pick, setPick] = useState('');
  const [val, setVal] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [fix, setFix] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const { data } = await supabase.rpc('gas_to_weigh'); setRows((data ?? []) as ToWeigh[]); }, []);
  useEffect(() => { void load(); }, [load]);
  const todo = (rows ?? []).filter((r) => !r.weighed_today);
  const done = (rows ?? []).filter((r) => r.weighed_today);
  const chosen = (rows ?? []).find((r) => r.code === pick);

  async function save() {
    if (!chosen) return toast('Choose the cylinder first');
    if (!val) return toast('Type the weight shown on the scale');
    if (!photo) return toast('Take a photo of the scale first');
    setBusy(true);
    try {
      const path = await sendPhoto(chosen.code, photo);
      const { data, error } = await supabase.rpc('gas_weigh', { p_code: chosen.code, p_gross_g: toG(val), p_photo: path, p_correction: fix, p_note: null });
      if (error) throw error;
      toast(`Saved. About ${kg(Number(data), 2) || '0'} kg of gas used since last time`);
      setPick(''); setVal(''); setPhoto(null); setFix(false); await load();
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  }

  if (rows === null) return <p className="muted">Loading…</p>;
  if (!rows.length) return <div className="card"><p>No cylinder is in use at your counter right now.</p><p className="small muted">When the store issues a cylinder to your counter it will show here for weighing.</p></div>;
  return (
    <>
      <div className="card">
        <p className="label">Weigh tonight</p>
        {!todo.length && !fix && <p><b>All cylinders are weighed for tonight. Thank you.</b></p>}
        <label className="small muted">Cylinder</label>
        <select value={pick} onChange={(e) => { setPick(e.target.value); setFix(done.some((d) => d.code === e.target.value)); }}>
          <option value="">Choose the cylinder</option>
          {todo.map((r) => <option key={r.code} value={r.code}>{r.code} · {r.location_name}</option>)}
          {done.length > 0 && <optgroup label="Already weighed (correction only)">{done.map((r) => <option key={r.code} value={r.code}>{r.code} · {r.location_name}</option>)}</optgroup>}
        </select>
        {chosen && (
          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            <p className="small muted">Last weight {kg(chosen.last_gross_g)} kg · empty weight stamped {kg(chosen.tare_g)} kg · gas left about {kg(chosen.last_gross_g - chosen.tare_g, 1)} kg</p>
            {fix && <p className="small" style={{ color: 'var(--bad, #b3261e)' }}>This cylinder is already weighed tonight. Saving again is a correction and the Admin will see it.</p>}
            <div className="two">
              <div><label className="small muted">Weight on the scale (kg)</label><input inputMode="decimal" placeholder="38.15" value={val} onChange={(e) => setVal(e.target.value)} /></div>
              <div><label className="small muted">Photo of the scale</label><PhotoPick file={photo} set={setPhoto} /></div>
            </div>
            <button className="btn" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Confirmed'}</button>
          </div>
        )}
      </div>
      {canSeeAll && <p className="small muted">Done tonight: {done.length} of {rows.length}</p>}
    </>
  );
}

// ---------- Receive full cylinders (store) ----------
function ReceiveTab({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState(''); const [tare, setTare] = useState(''); const [gross, setGross] = useState(''); const [sup, setSup] = useState('');
  const [photo, setPhoto] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  const exp = toG(tare) + 19000; const short = tare && gross ? Math.max(0, exp - toG(gross)) : 0;
  async function save() {
    if (!code.trim() || !tare || !gross) return toast('Fill the cylinder number and both weights');
    if (!photo) return toast('Take a photo of the scale first');
    setBusy(true);
    try {
      const path = await sendPhoto(code.trim().toUpperCase(), photo);
      const { data, error } = await supabase.rpc('gas_receive', { p_code: code, p_tare_g: toG(tare), p_gross_g: toG(gross), p_supplier: sup, p_photo: path });
      if (error) throw error;
      toast(Number(data) > 0 ? `Received. Short by ${Math.round(Number(data))} g` : 'Received. Full weight');
      setCode(''); setTare(''); setGross(''); setPhoto(null); onDone();
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  }
  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <p className="label">Receive a full cylinder</p>
      <label className="small muted">Cylinder number</label><input value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" />
      <div className="two">
        <div><label className="small muted">Empty weight stamped (kg)</label><input inputMode="decimal" placeholder="16.2" value={tare} onChange={(e) => setTare(e.target.value)} /></div>
        <div><label className="small muted">On the scale now (kg)</label><input inputMode="decimal" placeholder="35.3" value={gross} onChange={(e) => setGross(e.target.value)} /></div>
      </div>
      {tare && gross && <p className="small">Expected {kg(exp)} kg. {short > 0 ? <b style={{ color: 'var(--bad, #b3261e)' }}>Short by {short} g.</b> : 'Weight is full.'}</p>}
      <PhotoPick file={photo} set={setPhoto} />
      <label className="small muted">Supplier (optional)</label><input value={sup} onChange={(e) => setSup(e.target.value)} />
      <button className="btn" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Receive cylinder'}</button>
    </div>
  );
}

// ---------- Issue to a counter, closing the old one first ----------
function IssueTab({ cyls, onDone }: { cyls: Cyl[]; onDone: () => void }) {
  const { allLocations } = useSession();
  const toast = useToast();
  const [code, setCode] = useState(''); const [loc, setLoc] = useState<number | ''>('');
  const [oldCode, setOldCode] = useState(''); const [oldW, setOldW] = useState(''); const [photo, setPhoto] = useState<File | null>(null);
  const [skip, setSkip] = useState(false); const [reason, setReason] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const full = cyls.filter((c) => c.status === 'Full in store');
  const places = allLocations.filter((l) => l.active && l.code !== 'store');
  const here = cyls.filter((c) => c.status === 'In use' && c.location_id === loc);
  const max = allLocations.find((l) => l.id === loc)?.code === 'gas_bank' ? 2 : 1;
  const mustClose = here.length >= max;

  async function save() {
    if (!code || !loc) return toast('Choose the full cylinder and the counter');
    const closing = here.length > 0 && !skip;
    if (closing && (!oldCode || !oldW || !photo)) return toast('Choose the old cylinder, type its weight and take a photo of the scale');
    if (skip && !(reason && (reason !== 'Other' || note.trim()))) return toast('Give the reason for issuing without closing the old cylinder');
    setBusy(true);
    try {
      const path = closing && photo ? await sendPhoto(oldCode, photo) : null;
      const { error } = await supabase.rpc('gas_issue', { p_code: code, p_location: loc, p_close_code: closing ? oldCode : null, p_close_gross_g: closing ? toG(oldW) : null, p_close_photo: path, p_reason: skip ? reason : null, p_note: note || null });
      if (error) throw error;
      toast('Cylinder issued'); setCode(''); setOldCode(''); setOldW(''); setPhoto(null); setSkip(false); setReason(''); setNote(''); onDone();
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  }
  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <p className="label">Issue a cylinder</p>
      <label className="small muted">Counter</label>
      <select value={loc} onChange={(e) => { setLoc(e.target.value ? Number(e.target.value) : ''); setOldCode(''); setSkip(false); }}>
        <option value="">Choose the counter</option>{places.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <label className="small muted">Full cylinder from the store</label>
      <select value={code} onChange={(e) => setCode(e.target.value)}>
        <option value="">{full.length ? 'Choose the cylinder' : 'No full cylinder in the store'}</option>{full.map((c) => <option key={c.code} value={c.code}>{c.code} · {kg(c.last_gross_g)} kg</option>)}
      </select>
      {loc !== '' && here.length > 0 && (
        <div style={{ borderTop: '1px solid var(--line, #ddd)', paddingTop: 10, display: 'grid', gap: 10 }}>
          <p className="small"><b>In use here now:</b> {here.map((c) => c.code).join(', ')}. {mustClose ? 'Close one before issuing a new one.' : ''}</p>
          {!skip && (<>
            <label className="small muted">Old cylinder coming back</label>
            <select value={oldCode} onChange={(e) => setOldCode(e.target.value)}><option value="">Choose the old cylinder</option>{here.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</select>
            <div className="two">
              <div><label className="small muted">Old cylinder weight now (kg)</label><input inputMode="decimal" placeholder="about 16" value={oldW} onChange={(e) => setOldW(e.target.value)} /></div>
              <div><label className="small muted">Photo of the scale</label><PhotoPick file={photo} set={setPhoto} /></div>
            </div>
          </>)}
          <label className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><input type="checkbox" style={{ width: 'auto' }} checked={skip} onChange={(e) => setSkip(e.target.checked)} /><span className="small">Issue without closing the old one (the Admin is told)</span></label>
          {skip && (<>
            <div className="row" style={{ gap: 6 }}>{REASONS.map((r) => <button key={r} className={reason === r ? 'btn' : 'btn secondary'} onClick={() => setReason(r)}>{r}</button>)}</div>
            <input placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          </>)}
        </div>
      )}
      <button className="btn" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Issue cylinder'}</button>
    </div>
  );
}

// ---------- Register ----------
function RegisterTab({ cyls, onDone }: { cyls: Cyl[]; onDone: () => void }) {
  const { allLocations } = useSession();
  const toast = useToast();
  const nm = (id: number | null) => allLocations.find((l) => l.id === id)?.name ?? 'Store';
  const order = ['In use', 'Full in store', 'Empty', 'With supplier'];
  const sorted = useMemo(() => [...cyls].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.code.localeCompare(b.code)), [cyls]); // eslint-disable-line
  async function collected(code: string) { const { error } = await supabase.rpc('gas_collected', { p_code: code }); if (error) toast(errText(error)); else { toast('Marked as taken by the supplier'); onDone(); } }
  if (!cyls.length) return <div className="card"><p>No cylinders recorded yet. Receive the first one from the Receive tab.</p></div>;
  return (
    <div className="tablewrap"><table>
      <thead><tr><th>Cylinder</th><th>Status</th><th>Where</th><th className="r">Gas left</th><th className="r">Short at receipt</th><th /></tr></thead>
      <tbody>{sorted.map((c) => (
        <tr key={c.code}>
          <td><b>{c.code}</b><div className="small muted">empty {kg(c.tare_g)} kg</div></td>
          <td>{c.status}</td>
          <td>{c.status === 'With supplier' ? '—' : nm(c.status === 'Empty' ? 1 : c.location_id)}</td>
          <td className="r">{c.status === 'With supplier' ? '' : `${kg(Math.max(0, (c.last_gross_g ?? 0) - c.tare_g), 1)} kg`}</td>
          <td className="r">{c.shortfall_g > 0 ? `${Math.round(c.shortfall_g)} g` : ''}</td>
          <td>{c.status === 'Empty' && <button className="btn secondary" onClick={() => void collected(c.code)}>Taken by supplier</button>}</td>
        </tr>))}</tbody>
    </table></div>
  );
}

export function Gas() {
  const { profile } = useSession();
  const admin = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'store';
  const [tab, setTab] = useState<'weigh' | 'receive' | 'issue' | 'register'>('weigh');
  const [cyls, setCyls] = useState<Cyl[]>([]);
  const load = useCallback(async () => { if (!admin) return; const { data } = await supabase.from('cylinders').select('*'); setCyls((data ?? []) as Cyl[]); }, [admin]);
  useEffect(() => { void load(); }, [load]);
  const tabs: [typeof tab, string][] = admin ? [['weigh', 'Weigh'], ['receive', 'Receive'], ['issue', 'Issue'], ['register', 'Register']] : [['weigh', 'Weigh']];
  return (
    <div className={'gas ' + (admin ? '' : 'phone')}>
      <div className="pagehead"><div><p className="label">Fuel</p><h1>Gas cylinders</h1></div></div>
      {tabs.length > 1 && <div className="row" style={{ gap: 6, marginBottom: 12 }}>{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'btn' : 'btn secondary'} onClick={() => setTab(k)}>{l}</button>)}</div>}
      {tab === 'weigh' && <WeighTab canSeeAll={admin} />}
      {tab === 'receive' && admin && <ReceiveTab onDone={() => void load()} />}
      {tab === 'issue' && admin && <IssueTab cyls={cyls} onDone={() => void load()} />}
      {tab === 'register' && admin && <RegisterTab cyls={cyls} onDone={() => void load()} />}
    </div>
  );
}
