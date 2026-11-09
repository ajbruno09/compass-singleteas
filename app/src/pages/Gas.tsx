import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { useToast } from '../components/Toast';

interface ToWeigh { code: string; location_id: number; location_name: string; tare_g: number; last_gross_g: number; weighed_today: boolean; empty_reported: boolean }
interface InUse { code: string; location_id: number; tare_g: number; last_gross_g: number; weighed_today: boolean; empty_reported_at: string | null; issued_at: string | null; used_today_g: number; weighed_at: string | null }
interface Ov {
  cost_per_kg: number; in_use: InUse[]; full: { code: string; shortfall_g: number; received_at: string }[];
  empty: { code: string; note: string | null; shortfall_g: number }[]; days: { day: string; kg: number }[]; month_kg: number;
  history: { code: string; at: string; location_id: number; days: number | null }[];
}

const BANK = 19;
const HOT = 3;
const kg = (g: number | null | undefined, d = 2) => (g == null ? '' : (g / 1000).toFixed(d).replace(/\.?0+$/, ''));
const toG = (s: string) => Math.round((parseFloat(s) || 0) * 1000);
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const placeName = (id: number) => (id === BANK ? 'Kitchen gas bank' : id === HOT ? 'Hot Brew' : 'Counter');
const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).toLowerCase() : '');

async function sendPhoto(code: string, f: File): Promise<string> {
  const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${code}/${Date.now()}.${ext}`;
  const up = await supabase.storage.from('cylinder-photos').upload(path, f, { upsert: false });
  if (up.error) throw up.error;
  return path;
}

function PhotoBtn({ file, set }: { file: File | null; set: (f: File | null) => void }) {
  return (
    <label className="gs-btn" style={{ cursor: 'pointer' }}>
      {file ? <><span style={{ color: 'var(--brand)' }}>✓</span> Photo of the scale taken. Retake</> : 'Take photo of the scale'}
      <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => set(e.target.files?.[0] ?? null)} />
    </label>
  );
}

// ---------- Closing: weigh the cylinders at your counter ----------
function WeighCard({ onDone }: { onDone?: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<ToWeigh[] | null>(null);
  const [val, setVal] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<Record<string, File | null>>({});
  const [again, setAgain] = useState<Record<string, boolean>>({});
  const [pickEmpty, setPickEmpty] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const { data } = await supabase.rpc('gas_to_weigh'); setRows((data ?? []) as ToWeigh[]); }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 20000); return () => clearInterval(t); }, [load]);

  if (rows === null) return <p className="muted">Loading…</p>;
  if (!rows.length) return <div className="gs-card"><p>No gas cylinder is connected for your counter right now.</p><p className="small muted">When the Store puts a cylinder in, it will show here for weighing.</p></div>;

  const reported = rows.filter((r) => r.empty_reported);
  const live = rows.filter((r) => !r.empty_reported);
  const todo = live.filter((r) => !r.weighed_today || again[r.code]);
  const ready = todo.length > 0 && todo.every((r) => parseFloat(val[r.code]) > 0 && photo[r.code]);
  const used = todo.reduce((t, r) => t + (parseFloat(val[r.code]) > 0 ? Math.max(0, r.last_gross_g / 1000 - parseFloat(val[r.code])) : 0), 0);
  const tooHigh = todo.some((r) => parseFloat(val[r.code]) > r.last_gross_g / 1000 + 0.15);

  async function save() {
    setBusy(true);
    let total = 0;
    try {
      for (const r of todo) {
        const path = await sendPhoto(r.code, photo[r.code] as File);
        const { data, error } = await supabase.rpc('gas_weigh', { p_code: r.code, p_gross_g: toG(val[r.code]), p_photo: path, p_correction: !!again[r.code], p_note: null });
        if (error) throw error;
        total += Number(data) || 0;
      }
      setMsg(`About ${kg(total, 2) || '0'} kg of gas used since last time. Done for tonight.`);
      setVal({}); setPhoto({}); setAgain({}); await load(); onDone?.();
    } catch (e) { toast(errText(e)); await load(); } finally { setBusy(false); }
  }
  async function empty(code: string) {
    const { error } = await supabase.rpc('gas_report_empty', { p_code: code });
    if (error) { toast(errText(error)); return; }
    setPickEmpty(false); toast('Store has been told'); await load(); onDone?.();
  }

  const bank = live.some((r) => r.location_id === BANK) || reported.some((r) => r.location_id === BANK);
  return (
    <div className="gs-stack">
      <div className="gs-card">
        <div className="small muted">{bank ? 'Kitchen gas bank' : 'Your gas cylinder'}</div>
        <div className="gs-big">{bank ? 'Two cylinders connected' : rows[0].location_name}</div>
        {bank && <div className="small muted">Used by Indian, South Indian, Continental and Staff Food</div>}
      </div>
      {reported.length > 0 && (
        <div className="gs-card">
          <span className="gs-chip w">Waiting for the Store</span>
          <div className="small muted" style={{ marginTop: 6 }}>{reported.map((r) => r.code).join(', ')} {reported.length > 1 ? 'are' : 'is'} marked empty. {live.length ? `${live.map((r) => r.code).join(', ')} ${live.length > 1 ? 'are' : 'is'} still connected.` : ''} The Store will put in a new cylinder.</div>
        </div>
      )}
      {todo.length === 0 && live.length > 0 && (
        <div className="gs-card gs-done"><div className="gs-tick">✓</div><div className="gs-big">{msg ? 'Saved, thank you' : 'All weighed for tonight'}</div><div className="small muted">{msg || 'Thank you. See you tomorrow.'}</div>
          <div className="gs-rows" style={{ marginTop: 10 }}>{live.map((r) => <div key={r.code} className="gs-wr"><span><b>{r.code}</b></span><button className="gs-link" onClick={() => setAgain((a) => ({ ...a, [r.code]: true }))}>Wrong number? Weigh again</button></div>)}</div></div>
      )}
      {todo.length > 0 && (
        <div className="gs-card" style={{ display: 'grid', gap: 10 }}>
          <div className="gs-big">{todo.length > 1 ? 'Weigh both tonight' : 'Weigh it tonight'}</div>
          {todo.map((r) => (
            <div key={r.code} className="gs-slot">
              <div className="gs-sh"><b>{r.code}</b><span className="gs-chip ok">In use</span></div>
              <div className="small muted">Last weight {kg(r.last_gross_g)} kg</div>
              {again[r.code] && <div className="small" style={{ color: 'var(--bad)' }}>Already weighed tonight. Saving again is a correction and the Admin will see it.</div>}
              <input className="gs-in" inputMode="decimal" placeholder="Weight on the scale (kg)" value={val[r.code] ?? ''} onChange={(e) => setVal((v) => ({ ...v, [r.code]: e.target.value }))} />
              <PhotoBtn file={photo[r.code] ?? null} set={(f) => setPhoto((p) => ({ ...p, [r.code]: f }))} />
            </div>
          ))}
          {used > 0 && !tooHigh && <div className="gs-sum"><span className="small">Gas used since last weighing</span> <b>{used.toFixed(2)} kg</b></div>}
          {tooHigh && <div className="small" style={{ color: 'var(--bad)' }}>That is more than last time. Check the number, or tell the Store the cylinder was changed.</div>}
          <button className="gs-btn gs-p" disabled={!ready || tooHigh || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}
      {live.length > 0 && (pickEmpty ? (
        <div className="gs-card" style={{ display: 'grid', gap: 8 }}>
          <div className="small muted">Which cylinder is empty?</div>
          {live.map((r) => <button key={r.code} className="gs-btn" onClick={() => void empty(r.code)}>{r.code} is empty</button>)}
          <button className="gs-btn" style={{ border: 0, color: 'var(--ink-3)' }} onClick={() => setPickEmpty(false)}>Cancel</button>
        </div>
      ) : <button className="gs-btn gs-dash" onClick={() => setPickEmpty(true)}>A cylinder is empty</button>)}
    </div>
  );
}

// ---------- Store: receive a full cylinder ----------
function ReceivePanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState(''); const [marked, setMarked] = useState(''); const [scale, setScale] = useState('');
  const [photo, setPhoto] = useState<File | null>(null); const [act, setAct] = useState<'ret' | 'acc'>('ret'); const [busy, setBusy] = useState(false);
  const mk = parseFloat(marked) || 0; const w = parseFloat(scale) || 0;
  const tare = mk ? Math.round((mk - 19) * 100) / 100 : null;
  const short = mk && w ? Math.round((mk - w) * 100) / 100 : 0;
  const isShort = short > 0.05;
  async function save() {
    if (!code.trim() || !mk || !w) return toast('Fill the cylinder number and both weights');
    if (!photo) return toast('Take a photo of the scale first');
    setBusy(true);
    try {
      const path = await sendPhoto(code.trim().toUpperCase(), photo);
      const { error } = await supabase.rpc('gas_receive2', { p_code: code, p_marked_g: toG(marked), p_scale_g: toG(scale), p_supplier: null, p_photo: path, p_return: isShort && act === 'ret' });
      if (error) throw error;
      toast(isShort ? (act === 'ret' ? `${code.toUpperCase()} will go back to the supplier, short ${short.toFixed(2)} kg` : `${code.toUpperCase()} received, shortage of ${short.toFixed(2)} kg recorded`) : `${code.toUpperCase()} received and added to full cylinders`);
      onDone(); onClose();
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Receive a full cylinder" onClose={onClose} footer={<button className="gs-btn gs-p" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : isShort && act === 'ret' ? 'Return to supplier' : 'Receive cylinder'}</button>}>
      <div><label className="gs-l">Cylinder number</label><input className="gs-in" placeholder="For example B21" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" /></div>
      <div className="gs-two">
        <div><label className="gs-l">Gross weight marked (kg)</label><input className="gs-in" inputMode="decimal" placeholder="38.3" value={marked} onChange={(e) => setMarked(e.target.value)} /></div>
        <div><label className="gs-l">Weight on the scale (kg)</label><input className="gs-in" inputMode="decimal" placeholder="38.1" value={scale} onChange={(e) => setScale(e.target.value)} /></div>
      </div>
      {tare === null ? <div className="small muted">Empty weight is worked out for you: marked gross weight minus the 19 kg of gas.</div> : (
        <div className="gs-card" style={{ display: 'grid', gap: 4 }}>
          <div><span className="muted">Empty weight (marked gross minus 19 kg):</span> {tare.toFixed(2)} kg</div>
          {w > 0 && (isShort
            ? <div style={{ color: 'var(--bad)' }}><span className="muted">Gas short by</span> {short.toFixed(2)} kg <span className="muted">worth about</span> {inr(short * 157.9)}</div>
            : <div style={{ color: 'var(--brand)' }}>Full. <span className="muted">Scale matches the marked weight.</span></div>)}
        </div>
      )}
      {isShort && (
        <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
          <label className="gs-l">What do we do about the shortage?</label>
          <label className={'gs-opt' + (act === 'ret' ? ' sel' : '')}><input type="radio" checked={act === 'ret'} onChange={() => setAct('ret')} /><span>Return to the supplier<br /><span className="small muted">It stays out of our full cylinders</span></span></label>
          <label className={'gs-opt' + (act === 'acc' ? ' sel' : '')}><input type="radio" checked={act === 'acc'} onChange={() => setAct('acc')} /><span>Accept it and note the loss<br /><span className="small muted">Goes in as full, with the shortage recorded</span></span></label>
        </div>
      )}
      <PhotoBtn file={photo} set={setPhoto} />
    </Drawer>
  );
}

// ---------- Store: put a new cylinder in ----------
function SwapPanel({ ov, preset, onClose, onDone }: { ov: Ov; preset?: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [oldCode, setOldCode] = useState(preset ?? '');
  const [where, setWhere] = useState<number>(() => ov.in_use.find((c) => c.code === preset)?.location_id ?? BANK);
  const [left, setLeft] = useState(''); const [photo, setPhoto] = useState<File | null>(null);
  const [nw, setNw] = useState(ov.full[0]?.code ?? ''); const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ old: string; days: number; nw: string } | null>(null);
  const here = ov.in_use.filter((c) => c.location_id === where);
  const old = ov.in_use.find((c) => c.code === oldCode);
  const days = old?.issued_at ? Math.max(1, Math.round((Date.now() - Date.parse(old.issued_at)) / 86400000)) : 1;
  const canAdd = where === BANK ? here.length < 2 : here.length < 1;
  const next = () => {
    if (step === 1) {
      if (oldCode && (!left || !photo)) return toast('Weigh the old cylinder and take a photo of the scale');
      if (!oldCode && !canAdd) return toast('Choose the cylinder that is coming out');
    }
    if (step === 2 && !nw) return toast('Choose the full cylinder');
    setStep(step + 1);
  };
  async function confirm() {
    setBusy(true);
    try {
      const path = old && photo ? await sendPhoto(old.code, photo) : null;
      const { error } = await supabase.rpc('gas_issue', { p_code: nw, p_location: where, p_close_code: old ? old.code : null, p_close_gross_g: old ? toG(left) : null, p_close_photo: path, p_reason: null, p_note: null });
      if (error) throw error;
      setRes({ old: old?.code ?? '', days, nw }); onDone();
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  }
  if (res) return (
    <Drawer title="New cylinder is in" onClose={onClose} footer={<button className="gs-btn gs-p" onClick={onClose}>Done</button>}>
      {res.old && <div className="gs-sum"><div className="small">{res.old} in {placeName(where)}</div><b className="gs-sumb">Lasted {res.days} {res.days === 1 ? 'day' : 'days'}</b><div className="small" style={{ marginTop: 4 }}>{inr(19 * ov.cost_per_kg)} for the cylinder, about {inr(19 * ov.cost_per_kg / res.days)} a day.</div></div>}
      <div className="gs-card"><span className="gs-chip ok">In use</span><div className="gs-big" style={{ marginTop: 6 }}>{res.nw} is connected</div><div className="small muted">{res.old ? `The counter has been told. ${res.old} is in the Empty list for the supplier.` : `It is now in ${placeName(where)}.`}</div></div>
    </Drawer>
  );
  return (
    <Drawer title="Put in a new cylinder" onClose={onClose} footer={<>{step > 1 && <button className="gs-btn" style={{ width: 'auto' }} onClick={() => setStep(step - 1)}>Back</button>}<button className="gs-btn gs-p" disabled={busy} onClick={() => (step < 3 ? next() : void confirm())}>{step < 3 ? 'Next' : busy ? 'Saving…' : 'Confirm'}</button></>}>
      <div className="gs-stp"><span className={step === 1 ? 'on' : ''}>1 Old cylinder</span><span className={step === 2 ? 'on' : ''}>2 New cylinder</span><span className={step === 3 ? 'on' : ''}>3 Check</span></div>
      {step === 1 && <>
        <div className="gs-seg"><button className={where === BANK ? 'on' : ''} onClick={() => { setWhere(BANK); setOldCode(''); }}>Kitchen gas bank</button><button className={where === HOT ? 'on' : ''} onClick={() => { setWhere(HOT); setOldCode(''); }}>Hot Brew</button></div>
        <div className="small muted">Which cylinder is coming out?</div>
        {here.map((c) => <label key={c.code} className={'gs-opt' + (oldCode === c.code ? ' sel' : '')}><input type="radio" checked={oldCode === c.code} onChange={() => setOldCode(c.code)} /><b>{c.code}</b>{c.empty_reported_at && <span className="gs-chip b" style={{ marginLeft: 'auto' }}>Reported empty</span>}</label>)}
        {canAdd && <label className={'gs-opt' + (oldCode === '' ? ' sel' : '')}><input type="radio" checked={oldCode === ''} onChange={() => setOldCode('')} /><span>Nothing comes out<br /><span className="small muted">Just add a cylinder, there is room</span></span></label>}
        {oldCode && <>
          <div><label className="gs-l">Final weight of the old cylinder (kg)</label><input className="gs-in" inputMode="decimal" placeholder="Weigh it before it goes out" value={left} onChange={(e) => setLeft(e.target.value)} /><div className="small muted" style={{ marginTop: 6 }}>Together with the photo, this shows how much gas the cylinder gave.</div></div>
          <PhotoBtn file={photo} set={setPhoto} />
        </>}
      </>}
      {step === 2 && <>
        <div className="small muted">Choose the full cylinder to connect. The oldest is already selected.</div>
        {ov.full.length === 0 && <p className="muted">No full cylinder in the store. Receive one first.</p>}
        {ov.full.map((c) => <label key={c.code} className={'gs-opt' + (nw === c.code ? ' sel' : '')}><input type="radio" checked={nw === c.code} onChange={() => setNw(c.code)} /><b>{c.code}</b><span style={{ marginLeft: 'auto' }}>{c.shortfall_g > 50 && <span className="gs-chip w">Short {kg(c.shortfall_g)} kg </span>} <span className="gs-chip ok">Full</span></span></label>)}
      </>}
      {step === 3 && <>
        <div className="gs-card" style={{ display: 'grid', gap: 6 }}>
          {old && <div><span className="muted">Out:</span> <b>{old.code}</b>{left ? `, ${left} kg left` : ''}</div>}
          <div><span className="muted">In:</span> <b>{nw}</b></div>
          {here.filter((c) => c.code !== oldCode).length > 0 && <div><span className="muted">Still connected:</span> <b>{here.filter((c) => c.code !== oldCode).map((c) => c.code).join(', ')}</b></div>}
        </div>
        <div className="small muted">Confirm and the counter's phone updates straight away.</div>
      </>}
    </Drawer>
  );
}

function Drawer({ title, onClose, footer, children }: { title: string; onClose: () => void; footer: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="gs-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="gs-panel"><header><b>{title}</b><button className="gs-x" onClick={onClose} aria-label="Close">×</button></header><div className="gs-body">{children}</div><footer>{footer}</footer></aside>
    </div>
  );
}

// ---------- Store screen ----------
function StoreView() {
  const toast = useToast();
  const [ov, setOv] = useState<Ov | null>(null);
  const [panel, setPanel] = useState<null | 'recv' | 'swap' | 'weigh'>(null);
  const [preset, setPreset] = useState<string | undefined>();
  const load = useCallback(async () => { const { data } = await supabase.rpc('gas_overview'); if (data) setOv(data as Ov); }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 20000); return () => clearInterval(t); }, [load]);
  const bank = useMemo(() => (ov?.in_use ?? []).filter((c) => c.location_id === BANK), [ov]);
  const other = useMemo(() => (ov?.in_use ?? []).filter((c) => c.location_id !== BANK), [ov]);
  if (!ov) return <p className="muted">Loading…</p>;

  const flagged = ov.in_use.filter((c) => c.empty_reported_at);
  const bankLive = bank.filter((c) => !c.empty_reported_at);
  const usedToday = ov.in_use.reduce((t, c) => t + c.used_today_g, 0) / 1000;
  const weighed = bank.filter((c) => c.weighed_today).length;
  const mx = Math.max(...ov.days.map((d) => d.kg), 1);
  async function collected(code: string) { const { error } = await supabase.rpc('gas_collected', { p_code: code }); if (error) toast(errText(error)); else { toast('Marked as taken by the supplier'); void load(); } }
  const openSwap = (code?: string) => { setPreset(code); setPanel('swap'); };
  const status = (c: InUse) => c.empty_reported_at ? <span className="gs-chip b">Reported empty</span> : <span className="gs-chip ok">In use</span>;
  const weighing = (c: InUse) => c.weighed_today ? <><span className="gs-chip ok">Weighed {timeOf(c.weighed_at)}</span> <span className="small muted nw">photo ✓ · used {kg(c.used_today_g, 1) || '0'} kg</span></> : c.empty_reported_at ? <span className="muted">·</span> : <span className="gs-chip w">Waiting</span>;
  const table = (title: string, note: string, list: InUse[]) => (
    <section className="gs-tbl">
      <h3>{title} <span className="small muted">{note}</span></h3>
      <div className="gs-tr gs-th"><span>Cylinder</span><span>Status</span><span>Weighed tonight</span><span>Gas left</span></div>
      {list.map((c) => <div key={c.code} className="gs-tr"><span><b>{c.code}</b></span><span>{status(c)}</span><span>{weighing(c)}</span><span>{kg(Math.max(0, c.last_gross_g - c.tare_g), 1)} kg</span></div>)}
    </section>
  );

  return (
    <>
      <div className="pagehead"><div><p className="label">Fuel</p><h1>Gas cylinders</h1></div>
        <div className="row" style={{ gap: 8 }}><button className="gs-btn gs-s" onClick={() => setPanel('weigh')}>Weigh now</button><button className="gs-btn gs-s" onClick={() => openSwap()}>Issue a cylinder</button><button className="gs-btn gs-s" onClick={() => setPanel('recv')}>Receive full cylinder</button></div></div>
      <div className="gs-page">
        {flagged.length > 0 && <div className="gs-alert">{flagged.map((c) => c.code).join(', ')} {flagged.length > 1 ? 'are' : 'is'} empty. {bankLive.length === 1 ? `Only ${bankLive[0].code} is connected, so the pressure will be low until a new cylinder goes in.` : 'A new cylinder is needed.'}<button className="gs-btn gs-s gs-warn" onClick={() => openSwap(flagged[0].code)}>Put in new cylinder</button></div>}
        <div className="gs-kpis">
          <div className="gs-kpi"><b>{usedToday.toFixed(1)} kg</b><span>Gas used today</span></div>
          <div className="gs-kpi"><b style={{ color: bankLive.length >= 2 ? 'var(--brand)' : 'var(--bad)' }}>{bankLive.length >= 2 ? 'Steady' : bankLive.length === 1 ? 'Low pressure' : 'No gas'}</b><span>{bankLive.length >= 2 ? 'Both cylinders connected' : `Only ${bankLive.length} cylinder${bankLive.length === 1 ? '' : 's'} connected`}</span></div>
          <div className="gs-kpi"><b>{weighed} of {bank.length}</b><span>Kitchen bank weighed</span></div>
          <div className="gs-kpi"><b>{ov.full.length}</b><span>Full in store</span></div>
        </div>
        {bank.length > 0 ? table('Kitchen gas bank', 'shared by Indian, South Indian, Continental, Staff Food', bank) : <section className="gs-tbl"><h3>Kitchen gas bank</h3><div className="gs-tr"><span className="muted">No cylinder is connected. Use Issue a cylinder.</span></div></section>}
        {other.length > 0 && table('Hot Brew', 'own cylinder, charged to Hot Brew', other)}
        <section className="gs-tbl">
          <h3>Gas used each day <span className="small muted">This month {ov.month_kg.toFixed(1)} kg · about {inr(ov.month_kg * ov.cost_per_kg)}</span></h3>
          <div className="gs-wk">{ov.days.map((d) => <div key={d.day}>{d.kg > 0 ? <><b>{d.kg.toFixed(1)}</b><i style={{ height: Math.round((d.kg / mx) * 46) + 4 }} /></> : <b>·</b>}{new Date(d.day + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' })}</div>)}</div>
        </section>
        <section className="gs-tbl">
          <h3>Full in the store {ov.full[0] && <span className="small muted">oldest first, so use {ov.full[0].code} next</span>}</h3>
          {ov.full.map((c) => <div key={c.code} className="gs-tr gs-two"><b>{c.code}</b><span>{c.shortfall_g > 50 && <span className="gs-chip w">Short {kg(c.shortfall_g)} kg</span>} <span className="gs-chip ok">Full</span></span></div>)}
          {ov.full.length === 0 && <div className="gs-tr gs-two muted">No full cylinders. Order more.</div>}
        </section>
        {ov.empty.length > 0 && (
          <section className="gs-tbl"><h3>Empty, waiting for the supplier</h3>
            {ov.empty.map((c) => <div key={c.code} className="gs-tr gs-two"><span><b>{c.code}</b> <span className="muted">{c.note ? '· ' + c.note : ''}</span></span><button className="gs-btn gs-s" onClick={() => void collected(c.code)}>Taken by supplier</button></div>)}
          </section>
        )}
        {ov.history.length > 0 && (
          <section className="gs-tbl"><h3>Last cylinders, how long they lasted</h3>
            <div className="gs-tr gs-th gs-three"><span>Cylinder</span><span>Days</span><span>Cost per day</span></div>
            {ov.history.map((h) => <div key={h.code + h.at} className="gs-tr gs-three"><b>{h.code}</b><span>{h.days ?? '·'} {h.days === 1 ? 'day' : 'days'}</span><span>{h.days ? inr(19 * ov.cost_per_kg / Math.max(1, h.days)) : '·'}</span></div>)}
          </section>
        )}
      </div>
      {panel === 'recv' && <ReceivePanel onClose={() => setPanel(null)} onDone={() => void load()} />}
      {panel === 'swap' && <SwapPanel ov={ov} preset={preset} onClose={() => setPanel(null)} onDone={() => void load()} />}
      {panel === 'weigh' && <Drawer title="Weigh the cylinders" onClose={() => { setPanel(null); void load(); }} footer={<button className="gs-btn" onClick={() => { setPanel(null); void load(); }}>Close</button>}><WeighCard onDone={() => void load()} /></Drawer>}
    </>
  );
}

export function Gas() {
  const { profile } = useSession();
  const admin = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'store';
  return (
    <div className={'gs ' + (admin ? '' : 'phone')}>
      {admin ? <StoreView /> : <><div className="pagehead"><div><p className="label">Fuel</p><h1>Gas cylinders</h1></div></div><WeighCard /></>}
    </div>
  );
}
