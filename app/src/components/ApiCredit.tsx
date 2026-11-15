import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { errText } from '../lib/format';
import { useToast } from './Toast';
import { Sheet } from './Sheet';

const RATE = 88; // rupees per US dollar, an estimate
const TOP_UP_URL = 'https://platform.claude.com/settings/billing';
interface St { has_entry: boolean; balance_usd?: number; topped_at?: string; start_usd?: number; spent_since_usd?: number; pace_usd_per_day?: number; days_left?: number | null; alert_inr: number; expires_on?: string | null; expiry_days?: number | null }

export function useApiCredit() {
  const [st, setSt] = useState<St | null>(null);
  const load = useCallback(async () => { const { data, error } = await supabase.rpc('api_credit_status'); if (!error && data) setSt(data as St); }, []);
  useEffect(() => { void load(); }, [load]);
  const ed = st?.expiry_days ?? null;
  const expiring = st?.has_entry && ed != null && (st.balance_usd ?? 0) > 0 ? (ed <= 7 ? 'bad' : ed <= 30 ? 'warn' : null) : null;
  const base: 'ok' | 'warn' | 'bad' | 'none' = !st?.has_entry ? 'none' : (st.balance_usd! * RATE <= st.alert_inr / 2 || (st.days_left != null && st.days_left < 5)) ? 'bad' : (st.balance_usd! * RATE <= st.alert_inr || (st.days_left != null && st.days_left < 14)) ? 'warn' : 'ok';
  const level: 'ok' | 'warn' | 'bad' | 'none' = base === 'none' ? 'none' : (base === 'bad' || expiring === 'bad') ? 'bad' : (base === 'warn' || expiring === 'warn') ? 'warn' : 'ok';
  return { st, level, expiring, ed, reload: load };
}

// Owner only. An estimate of the Claude credit left: what was added, minus what the bill reader has used since.
export function ApiCreditCard() {
  const { st, level, expiring, ed, reload } = useApiCredit();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState('');
  const [now, setNow] = useState('');
  const [exp, setExp] = useState('');
  const [expOpen, setExpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!st) return null;
  const bal = st.balance_usd ?? 0;
  const color = level === 'bad' ? 'var(--bad, #B02A1E)' : level === 'warn' ? '#C98A1B' : 'var(--brand, #1B6A4D)';
  const pct = st.has_entry && st.start_usd ? Math.max(2, Math.min(100, (bal / Math.max(st.start_usd, bal, 0.01)) * 100)) : 0;
  async function save() {
    setBusy(true);
    const { error } = await supabase.rpc('api_credit_topup', { p_added: added ? Number(added) : null, p_balance: now ? Number(now) : null, p_expires: exp || null });
    setBusy(false);
    if (error) return toast(errText(error));
    setOpen(false); setAdded(''); setNow(''); setExp(''); toast('Saved. Counting down from here.'); await reload();
  }
  async function saveExpiry() {
    setBusy(true);
    const { error } = await supabase.rpc('api_credit_set_expiry', { p_expires: exp || null });
    setBusy(false);
    if (error) return toast(errText(error));
    setExpOpen(false); setExp(''); toast('Expiry date saved'); await reload();
  }
  async function alertLine() {
    const v = window.prompt('Warn me when the balance falls below (₹)', String(Math.round(st!.alert_inr)));
    if (!v || !(Number(v) > 0)) return;
    const { error } = await supabase.rpc('api_credit_set_alert', { p_inr: Number(v) });
    if (error) return toast(errText(error));
    toast('Alert line saved'); await reload();
  }
  return (
    <div className="card" style={{ borderLeft: `5px solid ${color}`, margin: '12px 0' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>Claude balance</b>
        {st.has_entry && <span className="chip" style={{ background: 'var(--sunken)', color }}>{level === 'ok' ? 'Healthy' : level === 'warn' ? 'Getting low' : 'Very low'}</span>}
      </div>
      {st.has_entry ? (<>
        <div className="row" style={{ alignItems: 'flex-end', gap: 16, marginTop: 6 }}>
          <div><span className="num" style={{ fontSize: 28 }}>${bal.toFixed(2)}</span> <span className="muted">about ₹{Math.round(bal * RATE).toLocaleString('en-IN')}</span></div>
          <div className="small muted">{st.days_left != null ? `About ${st.days_left} days left at the current pace` : 'No bills read in the last 7 days'}</div>
        </div>
        <div style={{ height: 10, background: 'var(--sunken)', borderRadius: 99, overflow: 'hidden', margin: '10px 0 4px' }}><div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99 }} /></div>
        <div className="small" style={{ color: expiring === 'bad' ? 'var(--bad, #B02A1E)' : expiring === 'warn' ? '#C98A1B' : undefined, margin: '2px 0' }}>{st.expires_on ? <><b>{ed! < 0 ? 'Expired' : 'Expires'} {new Date(st.expires_on + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</b>{ed! >= 0 ? `, in ${ed} day${ed === 1 ? '' : 's'}. Anything unused by then is lost.` : '. Unused credit is lost.'}</> : <span className="muted">No expiry date saved. Credit usually expires a year after it is bought.</span>}</div>
        <div className="small muted">Counting from {new Date(st.topped_at!).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, when it was ${st.start_usd!.toFixed(2)}. Used ${st.spent_since_usd!.toFixed(2)} since.{level !== 'ok' ? ' Bill reading stops when it reaches zero, and staff would have to type bills by hand.' : ''}</div>
      </>) : <p className="small muted" style={{ marginTop: 6 }}>Tell Compass what is in your Claude balance now, and it will count down from there. Tap <b>I topped up</b> and type the balance shown on the Anthropic page.</p>}
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        <a className="btn primary" href={TOP_UP_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>Top up on Anthropic ↗</a>
        <button className="btn" onClick={() => { const y = new Date(); y.setFullYear(y.getFullYear() + 1); setExp(y.toISOString().slice(0, 10)); setOpen(true); }}>I topped up</button>
        {st.has_entry && <button className="btn" onClick={() => { setExp(st.expires_on ?? ''); setExpOpen(true); }}>{st.expires_on ? 'Change expiry' : 'Add expiry date'}</button>}
        <button className="btn quiet" onClick={() => void alertLine()}>Alert me below ₹{Math.round(st.alert_inr)}</button>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>An estimate: what you told Compass, minus what the bill reader has used since. The exact balance is on the Anthropic page. It is only right if nothing else uses the same Anthropic account.</p>
      {expOpen && (
        <Sheet title="Expiry date" onClose={() => setExpOpen(false)} footer={<button className="btn primary" disabled={busy || !exp} onClick={() => void saveExpiry()}>{busy ? 'Saving…' : 'Save'}</button>}>
          <p className="muted small">The date shown on the Anthropic billing page for this credit.</p>
          <label className="field"><span>Expires on</span><input type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></label>
        </Sheet>)}
      {open && (
        <Sheet title="I topped up" onClose={() => setOpen(false)} footer={<button className="btn primary" disabled={busy || (!added && !now)} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>}>
          <p className="muted small">Tell Compass what you added on the Anthropic page, so it can count down from there.</p>
          <label className="field"><span>Amount added, in US dollars</span><input inputMode="decimal" value={added} onChange={(e) => setAdded(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="for example 10" /></label>
          <label className="field"><span>Expiry date of this credit (optional)</span><input type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></label>
          <label className="field"><span>Balance shown on the Anthropic page now (optional, more exact)</span><input inputMode="decimal" value={now} onChange={(e) => setNow(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="for example 10.00" /></label>
        </Sheet>)}
    </div>
  );
}

// A small warning on the owner dashboard, only when the balance is low.
export function ApiCreditWarn() {
  const { st, level } = useApiCredit();
  if (!st?.has_entry || (level !== 'warn' && level !== 'bad')) return null;
  const soon = st.expiry_days != null && st.expiry_days <= 30 && (st.balance_usd ?? 0) > 0;
  return (
    <div className="banner warn" style={{ margin: '12px 0', borderColor: level === 'bad' ? 'var(--bad, #B02A1E)' : undefined }}>
      <b>{level === 'bad' ? 'Claude balance is very low' : 'Claude balance is getting low'}</b>: about ${st.balance_usd!.toFixed(2)} left. Bill reading stops at zero.{soon ? ` The credit ${st.expiry_days! < 0 ? 'has expired' : `expires in ${st.expiry_days} day${st.expiry_days === 1 ? '' : 's'}`}.` : ''}{' '}
      <a href={TOP_UP_URL} target="_blank" rel="noopener noreferrer">Top up on Anthropic ↗</a>
    </div>
  );
}
