import { useEffect, useMemo, useState } from 'react';
import { DatePicker, TimePicker } from '../components/DatePicker';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { clock12 } from '../lib/ist';
import type { Rule, RuleHist } from '../lib/types';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';

function show(r: Rule, v: unknown): string {
  if (r.kind === 'time') return clock12(String(v));
  if (r.kind === 'text') return String(v).replace(/_/g, ' ');
  const n = Number(v);
  const s = Number.isInteger(n) ? n.toLocaleString('en-IN') : String(n);
  return r.kind === 'money' ? `₹${s}` : r.kind === 'percent' ? `${s}%` : `${s}${r.unit ? ' ' + r.unit : ''}`;
}

export function Rules() {
  const { profile } = useSession();
  const isOwner = profile?.role === 'owner';
  const [rules, setRules] = useState<Rule[]>([]);
  const [editing, setEditing] = useState<Rule | null>(null);
  const load = async () => { const { data } = await supabase.from('rules').select('*').order('sort'); setRules((data as Rule[]) ?? []); };
  useEffect(() => { void load(); }, []);
  const [q, setQ] = useState('');
  const MERGE: Record<string, string> = { Wastage: 'Wastage, buying and alerts', Buying: 'Wastage, buying and alerts', Alerts: 'Wastage, buying and alerts' };
  const groups = useMemo(() => {
    const m = new Map<string, Rule[]>();
    for (const r of rules) { if (q && !r.label.toLowerCase().includes(q.toLowerCase())) continue; const g = MERGE[r.group_name] ?? r.group_name; m.set(g, [...(m.get(g) ?? []), r]); }
    return [...m.entries()];
  }, [rules, q]);

  const line = (r: Rule) => (
    <div key={r.key} className={'rl-row' + (isOwner ? ' click' : '')} onClick={() => isOwner && setEditing(r)}>
      <span className="rl-n">{r.label}<span className="rl-i" data-t={r.description}>i</span>{r.money && <span className="rl-pay">Pay</span>}</span>
      <span className="rl-v">{show(r, r.value)}</span>
      <i className={'rl-dot ' + (r.wired ? 'on' : 'off')} title={r.wired ? 'Live' : 'Not live yet'} />
    </div>
  );

  return (
    <>
      <div className="pagehead"><div><p className="label">How Compass decides</p><h1>Rules</h1></div>
        <div className="rl-tools"><span className="rl-legend"><span><i className="rl-dot on" />Live</span><span><i className="rl-dot off" />Not live yet</span><span><span className="rl-pay">Pay</span>affects pay</span></span>
          <input className="rl-search" placeholder="Find a rule" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      <p className="muted small">{isOwner ? 'Click any row to change it. Each change keeps a history.' : 'Only the owner can change rules.'} Hover the small i to see what a rule does.</p>
      <div className="rl-grid">
        {groups.map(([g, list]) => {
          const wide = list.length > 6;
          return (
            <section key={g} className={'tablewrap rl-card' + (wide ? ' full' : '')}>
              <h2>{g}{list.every((r) => !r.wired) && <span>Not live yet</span>}</h2>
              <div className={wide ? 'rl-two' : ''}>{list.map(line)}</div>
            </section>
          );
        })}
      </div>
      {isOwner && !q && <SharedCosts />}
      {isOwner && !q && <div className="rl-grid" style={{ marginTop: 12 }}><AdminContact /><StartFresh /></div>}
      {editing && <RuleForm rule={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
    </>
  );
}

function RuleForm({ rule, onClose, onSaved }: { rule: Rule; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const [val, setVal] = useState(String(rule.value));
  const [from, setFrom] = useState(today);
  const [note, setNote] = useState('');
  const [ok, setOk] = useState(!rule.money);
  const [hist, setHist] = useState<RuleHist[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { supabase.from('rule_history').select('*').eq('key', rule.key).order('effective_from', { ascending: false }).order('id', { ascending: false }).limit(8).then(({ data }) => setHist((data as RuleHist[]) ?? [])); }, [rule.key]);

  async function save() {
    setError('');
    let v: unknown = val.trim();
    if (rule.kind === 'time') { if (!/^\d{2}:\d{2}$/.test(String(v))) return setError('Choose a time.'); }
    else if (rule.kind !== 'text') { const n = Number(v); if (!Number.isFinite(n) || n < 0) return setError('Enter a number.'); v = n; }
    else if (!String(v)) return setError('Enter a value.');
    if (!ok) return setError('Please tick the box to confirm.');
    setBusy(true);
    const { error } = await supabase.rpc('set_rule', { p_key: rule.key, p_value: v, p_from: from, p_note: note });
    setBusy(false);
    if (error) return setError(errText(error));
    toast('Rule saved'); onSaved();
  }

  return (
    <Sheet title={rule.label} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save rule'}</button></>}>
      <p className="muted">{rule.description}</p>
      {rule.why && <p className="small"><b>Why this value:</b> {rule.why}</p>}
      <div className="form-grid">
        <label className="field"><span>Value{rule.unit ? ` (${rule.unit})` : ''}</span>
          {rule.kind === 'time' ? <TimePicker value={val} onChange={setVal} label="Time" />
            : rule.key === 'overstock_mode' ? <select id="rule-val" value={val} onChange={(e) => setVal(e.target.value)}><option value="advice_only">Advice only (warn and record)</option><option value="approval">Needs approval</option></select>
            : rule.key === 'unknown_item_alert' ? <select id="rule-val" value={val} onChange={(e) => setVal(e.target.value)}><option value="on">On</option><option value="off">Off</option></select>
            : <input id="rule-val" className="num" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} />}
        </label>
        <label className="field"><span>Starts from</span><DatePicker value={from} min={today} disabled={rule.wired} onChange={setFrom} label="Starts from" />
          {rule.wired && <span className="small muted">Live rules change from today.</span>}</label>
      </div>
      <label className="field"><span>Note (why you changed it)</span><input id="rule-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></label>
      {rule.money && <label className="row" style={{ gap: 10, alignItems: 'flex-start' }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /><span>This affects how staff pay or incentive is worked out. I have checked it.</span></label>}
      {error && <p className="banner bad" role="alert">{error}</p>}
      {hist.length > 0 && <div className="card" style={{ display: 'grid', gap: 4 }}><b>History</b>{hist.map((h) => <div key={h.id} className="small row" style={{ justifyContent: 'space-between' }}><span>{show(rule, h.value)}{h.note ? ` · ${h.note}` : ''}</span><span className="muted">from {h.effective_from}</span></div>)}</div>}
    </Sheet>
  );
}

function StartFresh() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [txt, setTxt] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const { data, error } = await supabase.rpc('start_fresh');
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    const d = data as { indents: number; stock_rows: number };
    toast(`Cleared ${d.indents} indents and ${d.stock_rows} test stock entries`); setOpen(false); setTxt('');
  }
  return (
    <section className="card" style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
      <h2>Start fresh</h2>
      <p className="muted">Removes every test indent, purchase order, urgent request and alert, so the real work starts clean. Your items, people, vendors, rules and opening stock stay exactly as they are. This cannot be undone.</p>
      {!open ? <button className="btn secondary" style={{ justifySelf: 'start' }} onClick={() => setOpen(true)}>Start fresh…</button> : (
        <>
          <label className="field"><span>Type START FRESH to confirm</span><input id="fresh-confirm" value={txt} onChange={(e) => setTxt(e.target.value)} /></label>
          <div className="row" style={{ gap: 8 }}><button className="btn secondary" onClick={() => { setOpen(false); setTxt(''); }}>Cancel</button><button className="btn primary" disabled={busy || txt.trim().toUpperCase() !== 'START FRESH'} onClick={() => void go()}>{busy ? 'Clearing…' : 'Clear test data'}</button></div>
        </>
      )}
    </section>
  );
}

function AdminContact() {
  const toast = useToast();
  const [num, setNum] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { supabase.rpc('get_admin_contact').then(({ data }) => { if (typeof data === 'string') setNum(data); }); }, []);
  async function save() {
    setBusy(true);
    const { error } = await supabase.rpc('set_admin_contact', { p_phone: num });
    setBusy(false);
    toast(error ? errText(error) : 'Admin number saved');
  }
  return (
    <section className="card" style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
      <h2>Admin contact number</h2>
      <p className="muted">The Contact Admin link on the sign in page opens WhatsApp to this number. Change it here whenever Admin changes.</p>
      <label className="field"><span>WhatsApp number</span><input id="admin-number" className="num" inputMode="numeric" maxLength={10} value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, ''))} /></label>
      <button className="btn primary" style={{ justifySelf: 'start' }} disabled={busy || num.length !== 10} onClick={() => void save()}>{busy ? 'Saving…' : 'Save number'}</button>
    </section>
  );
}

type Share = { id: number; label: string; sort: number; water_pct: number; cyl_mode: 'split' | 'direct' | 'none'; cyl_pct: number; cyl_note: string | null };
type MonthRow = { id: number; label: string; water_amt: number; cyl_amt: number; cyl_pool: number };
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

function SharedCosts() {
  const toast = useToast();
  const [shares, setShares] = useState<Share[]>([]);
  const [litres, setLitres] = useState('1000');
  const [rate, setRate] = useState('1');
  const [days, setDays] = useState(30);
  const [month, setMonth] = useState<MonthRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const [a, b, c] = await Promise.all([
      supabase.from('shared_cost_shares').select('*').order('sort'),
      supabase.from('shared_cost_config').select('*').eq('id', 1).single(),
      supabase.rpc('shared_cost_month'),
    ]);
    setShares(((a.data ?? []) as Share[]).map((x) => ({ ...x, water_pct: Number(x.water_pct), cyl_pct: Number(x.cyl_pct) })));
    if (b.data) { setLitres(String(Number(b.data.water_litres_day))); setRate(String(Number(b.data.water_rate))); setDays(b.data.water_days); }
    setMonth(((c.data ?? []) as MonthRow[]).map((x) => ({ ...x, water_amt: Number(x.water_amt), cyl_amt: Number(x.cyl_amt), cyl_pool: Number(x.cyl_pool) })));
    setDirty(false);
  };
  useEffect(() => { void load(); }, []);
  const total = (Number(litres) || 0) * (Number(rate) || 0) * days;
  const wSum = shares.reduce((t, x) => t + x.water_pct, 0);
  const cSum = shares.reduce((t, x) => t + (x.cyl_mode === 'split' ? x.cyl_pct : 0), 0);
  const ok = Math.round(wSum * 100) === 10000 && Math.round(cSum * 100) === 10000;
  const set = (id: number, k: 'water_pct' | 'cyl_pct', v: string) => { setShares((l) => l.map((x) => x.id === id ? { ...x, [k]: Number(v) || 0 } : x)); setDirty(true); };
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('save_shared_costs', { p_litres: Number(litres) || 0, p_rate: Number(rate) || 0, p_shares: shares.map((x) => ({ id: x.id, water_pct: x.water_pct, cyl_pct: x.cyl_mode === 'split' ? x.cyl_pct : 0 })) });
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    toast('Saved'); void load();
  };
  const pct = (id: number, k: 'water_pct' | 'cyl_pct', v: number) => (
    <input className="sc-in" inputMode="decimal" value={String(v)} onChange={(e) => set(id, k, e.target.value)} aria-label="percent" />
  );
  const pool = month[0]?.cyl_pool ?? 0;
  return (
    <section className="tablewrap sc" style={{ marginTop: 12 }}>
      <div className="sc-head"><h2>Shared kitchen costs</h2><span className="small muted">Split by percentage and shown on each counter's monthly cost, apart from what it ordered. They never change the indent cart value.</span></div>
      <div className="sc-calc">
        <label><span>Water per day (litres)</span><input className="sc-in w" inputMode="decimal" value={litres} onChange={(e) => { setLitres(e.target.value); setDirty(true); }} /></label>
        <label><span>Rate per litre (₹, includes upkeep)</span><input className="sc-in w" inputMode="decimal" value={rate} onChange={(e) => { setRate(e.target.value); setDirty(true); }} /></label>
        <div><span>Days</span><b>{days}</b></div>
        <div className="hi"><span>Water per month</span><b className="num">{inr(total)}</b></div>
      </div>
      <table>
        <thead><tr><th>Counter</th><th className="n">Water share</th><th className="n">Water</th><th className="n">Cylinder share</th><th className="n">Cylinder this month</th></tr></thead>
        <tbody>
          {shares.map((x) => {
            const m = month.find((r) => r.id === x.id);
            return (
              <tr key={x.id}>
                <td><strong>{x.label}</strong></td>
                <td className="n">{pct(x.id, 'water_pct', x.water_pct)}%</td>
                <td className="n num">{inr(total * x.water_pct / 100)}</td>
                <td className="n">{x.cyl_mode === 'split' ? <>{pct(x.id, 'cyl_pct', x.cyl_pct)}%</> : <span className="small muted">{x.cyl_note}</span>}</td>
                <td className="n num">{x.cyl_mode === 'none' ? <span className="muted">·</span> : inr(m?.cyl_amt ?? 0)}</td>
              </tr>
            );
          })}
          <tr className="tot"><td>Total</td><td className={'n' + (Math.round(wSum * 100) === 10000 ? '' : ' bad')}>{wSum}%</td><td className="n num">{inr(total)}</td><td className={'n' + (Math.round(cSum * 100) === 10000 ? '' : ' bad')}>{cSum}%</td><td className="n num">{inr(pool)} shared</td></tr>
        </tbody>
      </table>
      <div className="sc-foot"><span className="small muted">{ok ? 'Cylinder cost comes from cylinders issued from the Store this month.' : 'Each share column must add up to 100% before you can save.'}</span>
        <span className="row" style={{ gap: 8 }}><button className="btn" disabled={!dirty || busy} onClick={() => void load()}>Discard</button><button className="btn primary" disabled={!dirty || !ok || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button></span></div>
    </section>
  );
}
