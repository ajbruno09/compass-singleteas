import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/Toast';
import { DEN, fmt } from './ClosingWizard';
import '../petty.css';

interface Mine {
  business_date: string;
  today: { id: string; status: 'waiting' | 'accepted'; amount: number; den: Record<string, number>; at: string; accepted_at: string | null } | null;
  history: { date: string; amount: number; status: string }[];
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmy = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${MON[+m - 1]}/${y}`; };

// Opening staff: the Rs 2,000 Devid issued for the counter. Count it and tap Accepted.
export function PettyReceived() {
  const toast = useToast();
  const [m, setM] = useState<Mine | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('petty_mine');
    if (error) { toast('Petty cash received is only for opening staff'); return; }
    setM(data as Mine);
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  async function accept() {
    if (!m?.today) return;
    setBusy(true);
    const { error } = await supabase.rpc('petty_accept_float', { p_id: m.today.id });
    setBusy(false);
    if (error) { toast(error.message); return; }
    toast('Thank you, accepted');
    await load();
  }
  if (!m) return <p className="muted">Loading…</p>;
  const t = m.today;
  return (
    <div className="pc-mine">
      <div className="pagehead"><div><p className="label">Opening</p><h1>Petty cash received</h1></div></div>
      {!t ? (
        <div className="pc-card"><h3>Today, {dmy(m.business_date)}</h3><div className="pc-note info">Nothing for you yet. When Devid issues the float for the counter, it shows here for you to count and accept.</div></div>
      ) : (
        <div className="pc-card">
          <h3>Today, {dmy(m.business_date)} <span className={'pc-tag ' + (t.status === 'accepted' ? 'g' : 'a')}>{t.status === 'accepted' ? 'Accepted' : 'Waiting for you'}</span></h3>
          <p className="pc-sub">Devid issued {fmt(t.amount)} for the counter. Count the notes and coins in your hand and check them against this list.</p>
          <table className="pc-t"><thead><tr><th>Note or coin</th><th>Count</th><th>Amount</th></tr></thead><tbody>
            {DEN.filter((d) => t.den[d]).map((d) => <tr key={d}><td>{'₹'}{d}</td><td>{t.den[d]}</td><td>{fmt(d * t.den[d])}</td></tr>)}
            <tr className="t"><td>Total</td><td /><td>{fmt(t.amount)}</td></tr></tbody></table>
          {t.status === 'waiting'
            ? <div className="pc-row" style={{ marginTop: 12, justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy} onClick={() => void accept()}>Accepted, I have received it</button></div>
            : <div className="pc-note ok">You accepted it{t.accepted_at ? ' at ' + new Date(t.accepted_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''}.</div>}
        </div>
      )}
      {m.history.length > 1 && (
        <div className="pc-card"><h3>Earlier days</h3>
          {m.history.filter((h) => h.date !== m.business_date).map((h) => <div className="pc-led" key={h.date}><div>{dmy(h.date)}</div><div className="a">{fmt(h.amount)}</div></div>)}</div>
      )}
    </div>
  );
}
