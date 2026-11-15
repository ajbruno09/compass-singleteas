import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface Spend { month: number; last_month: number; today_items: number; days: { d: string; amt: number }[]; items: { name: string; unit: string; qty: number; amt: number }[] }
const rs = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

// Owner only. What was issued to Home this month, at cost. Not part of Single Teas food cost or profit.
export function HomeSpend() {
  const [d, setD] = useState<Spend | null>(null);
  useEffect(() => { supabase.rpc('home_spend').then(({ data, error }) => { if (!error && data) setD(data as Spend); }); }, []);
  if (!d) return null;
  const max = Math.max(1, ...d.days.map((x) => Number(x.amt)));
  return (
    <div className="card" style={{ borderLeft: '4px solid #7A5AB8', margin: '12px 0' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><b>Home spend</b><div className="muted small">Only you see this. It is not part of Single Teas food cost or profit.</div></div>
        <span className="chip" style={{ background: '#F1ECFA', color: '#5B3FA0' }}>Personal</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 10 }}>
        <div><span className="small muted">This month so far</span><div style={{ fontSize: 20 }}>{rs(Number(d.month))}</div></div>
        <div><span className="small muted">Last month</span><div style={{ fontSize: 20 }}>{rs(Number(d.last_month))}</div></div>
        <div><span className="small muted">Items issued today</span><div style={{ fontSize: 20 }}>{d.today_items}</div></div>
      </div>
      {d.days.length > 0 && <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 64, marginTop: 12 }} aria-label="Home spend per day">{d.days.map((x) => <span key={x.d} title={`${x.d}: ${rs(Number(x.amt))}`} style={{ flex: 1, background: '#BFAEE0', borderRadius: '4px 4px 0 0', height: `${Math.max(6, (Number(x.amt) / max) * 100)}%` }} />)}</div>}
      {d.items.length > 0 && (
        <table style={{ marginTop: 10, width: '100%' }}>
          <thead><tr><th style={{ textAlign: 'left' }}>Item</th><th className="r">This month</th><th className="r">Cost</th></tr></thead>
          <tbody>{d.items.slice(0, 8).map((x) => <tr key={x.name + x.unit}><td>{x.name}</td><td className="r num">{Math.round(Number(x.qty) * 100) / 100} {x.unit}</td><td className="r num">{rs(Number(x.amt))}</td></tr>)}</tbody>
        </table>
      )}
      <p className="small muted" style={{ marginTop: 8 }}>Cost is each item's price when it was issued. Items marked not in stock are not counted.</p>
    </div>
  );
}
