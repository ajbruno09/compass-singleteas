import { useEffect, useMemo, useState } from 'react';
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
  const groups = useMemo(() => { const m = new Map<string, Rule[]>(); for (const r of rules) m.set(r.group_name, [...(m.get(r.group_name) ?? []), r]); return [...m.entries()]; }, [rules]);

  return (
    <>
      <div className="pagehead"><div><p className="label">How SToMS decides</p><h1>Rules</h1></div></div>
      <p className="muted">Every number and time that SToMS uses is here, so nothing is hidden in the code. {isOwner ? 'Tap a rule to change it. Each change keeps a history.' : 'Only the owner can change rules.'} “Live” rules already run today. “Not live yet” rules are saved and start working when their feature is switched on.</p>
      {groups.map(([g, list]) => (
        <section key={g} className="tablewrap">
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}><h2>{g}</h2></div>
          <table>
            <tbody>
              {list.map((r) => (
                <tr key={r.key} className={isOwner ? 'click' : ''} onClick={() => isOwner && setEditing(r)}>
                  <td style={{ width: '48%' }}><strong>{r.label}</strong><div className="small muted">{r.description}</div></td>
                  <td className="num" style={{ fontWeight: 650, fontSize: 16 }}>{show(r, r.value)}</td>
                  <td>{r.wired ? <span className="chip done">Live</span> : <span className="chip off">Not live yet</span>}{r.money && <span className="chip late" style={{ marginLeft: 6 }}>Pay</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {isOwner && <AdminContact />}
      {isOwner && <StartFresh />}
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
          {rule.kind === 'time' ? <input id="rule-val" type="time" value={val} onChange={(e) => setVal(e.target.value)} />
            : rule.key === 'overstock_mode' ? <select id="rule-val" value={val} onChange={(e) => setVal(e.target.value)}><option value="advice_only">Advice only (warn and record)</option><option value="approval">Needs approval</option></select>
            : rule.key === 'unknown_item_alert' ? <select id="rule-val" value={val} onChange={(e) => setVal(e.target.value)}><option value="on">On</option><option value="off">Off</option></select>
            : <input id="rule-val" className="num" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} />}
        </label>
        <label className="field"><span>Starts from</span><input id="rule-from" type="date" value={from} min={today} disabled={rule.wired} onChange={(e) => setFrom(e.target.value)} />
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
    <section className="card" style={{ display: 'grid', gap: 10, maxWidth: 640, marginTop: 24 }}>
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
    <section className="card" style={{ display: 'grid', gap: 10, maxWidth: 640, marginTop: 24 }}>
      <h2>Admin contact number</h2>
      <p className="muted">The Contact Admin link on the sign in page opens WhatsApp to this number. Change it here whenever Admin changes.</p>
      <label className="field"><span>WhatsApp number</span><input id="admin-number" className="num" inputMode="numeric" maxLength={10} value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, ''))} /></label>
      <button className="btn primary" style={{ justifySelf: 'start' }} disabled={busy || num.length !== 10} onClick={() => void save()}>{busy ? 'Saving…' : 'Save number'}</button>
    </section>
  );
}
