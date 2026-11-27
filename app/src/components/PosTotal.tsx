import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface Day { business_date: string; orders: number | null; sub_total: number | null; container_charge: number | null; service_charge: number | null; cgst: number | null; sgst: number | null; round_off: number | null; waived_off: number | null; grand_total: number; net_sales: number; payments: Record<string, number>; checks_out: boolean }
const rs = (n: number) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const dl = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

// What the POS shows as "Total sales" for a day: net sales plus container charge, GST and round off, with the payment modes.
// Counters and the Munna / Deboda graphs stay on net sales. Owner, manager and accounts only.
export function PosTotal({ date }: { date?: string }) {
  const [days, setDays] = useState<Day[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => { void supabase.rpc('pos_summary_days', { p_days: 30 }).then(({ data, error }) => { if (!error && Array.isArray(data)) setDays(data as Day[]); else setDays([]); }); }, []);
  if (!days) return null;
  const want = date ?? pick;
  const d = (want ? days.find((x) => x.business_date === want) : days[0]) ?? null;
  if (!d) return date ? <div className="card muted" style={{ maxWidth: 460, marginBottom: 12 }}>Waiting for sales. The day counts only from the report that arrives after 3:00 AM.</div> : null;
  const istYesterday = new Date(Date.now() + 330 * 60000 - 86400000).toISOString().slice(0, 10);
  const waiting = !date && d.business_date < istYesterday;
  const gst = Number(d.cgst ?? 0) + Number(d.sgst ?? 0);
  const rows: [string, number | null][] = [['Net sales', d.net_sales], ['Container charge', d.container_charge], ['GST (CGST + SGST)', gst], ['Round off', d.round_off]];
  const pays = Object.entries(d.payments ?? {}).filter(([, v]) => Number(v) !== 0);
  return (
    <div className="card" style={{ borderLeft: '5px solid var(--brand, #1B6A4D)', margin: '12px 0', maxWidth: date ? 460 : undefined }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><b>Total sales</b><span className="chip" style={{ background: 'var(--sunken)' }}>{dl(d.business_date)}</span></div>
      <div className="row" style={{ alignItems: 'flex-end', gap: 14, marginTop: 4 }}>
        <div style={{ fontSize: 30 }} className="num">{rs(d.grand_total)}</div>
        {d.orders != null && <div className="small muted" style={{ paddingBottom: 6 }}>{d.orders} orders</div>}
      </div>
      {waiting && <div className="small muted" style={{ marginTop: 4 }}>Waiting for yesterday's sales. Only the report after 3:00 AM counts.</div>}
      <table style={{ width: '100%', marginTop: 6 }}><tbody>
        {rows.map(([k, v]) => (v == null || (Number(v) === 0 && k !== 'Net sales')) ? null : <tr key={k}><td className="muted">{k}</td><td className="r num">{rs(Number(v))}</td></tr>)}
      </tbody></table>
      {pays.length > 0 && <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 8 }}>{pays.map(([k, v]) => <span key={k} className="chip" style={{ background: 'var(--sunken)' }}>{k.replace(/\s*\(.*\)/, '')} {rs(Number(v))}</span>)}</div>}
      {!d.checks_out && <div className="small muted" style={{ marginTop: 6 }}>The parts do not add up to the total by a small amount. The total is as the POS reported it.</div>}
      {!date && days.length > 1 && <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 10 }}>{days.slice(0, 7).map((x) => <button key={x.business_date} className={'btn' + (x.business_date === d.business_date ? ' primary' : '')} style={{ padding: '2px 8px' }} onClick={() => setPick(x.business_date)}>{new Date(x.business_date + 'T12:00:00').getDate()} {new Date(x.business_date + 'T12:00:00').toLocaleDateString('en-IN', { month: 'short' })}</button>)}</div>}
    </div>
  );
}
