import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Sheet } from './Sheet';
import { AddBillSheet, type Pending } from '../pages/Receive';

interface Miss { id: string; grn: string; vendor_id: string; vendor: string; d: string; kind: 'missing' | 'later' | 'cleared' }
interface Mtd { month_start: string; day: number; billed: number; bills: number; days: { d: string; amt: number }[]; vendors: { name: string; amt: number; n: number }[]; missing: Miss[] }
const rs = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const dl = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// Owner only. What this month's bills add up to, and which received deliveries still have no bill.
export function PurchasesMtd() {
  const [d, setD] = useState<Mtd | null>(null);
  const [sheet, setSheet] = useState<'vendors' | 'missing' | null>(null);
  const [addFor, setAddFor] = useState<Miss | null>(null);
  const load = useCallback(async () => { const { data, error } = await supabase.rpc('purchases_mtd'); if (!error && data) setD(data as Mtd); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!d) return null;
  const need = d.missing.filter((m) => m.kind === 'missing');
  const rest = d.missing.filter((m) => m.kind !== 'missing');
  const days = d.days; const max = Math.max(1, ...days.map((x) => Number(x.amt)));
  const mon = new Date(d.month_start + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const grn = (m: Miss): Pending => ({ id: m.id, grn_number: m.grn, vendor_id: m.vendor_id, received_at: m.d });
  const row = (m: Miss, showBtn: boolean) => (
    <tr key={m.id}><td>{m.grn}<div className="small muted">{m.vendor}</div></td><td>{dl(m.d)}</td><td className="r">{showBtn ? <button className="btn primary" onClick={() => setAddFor(m)}>Add bill</button> : <button className="btn" onClick={() => setAddFor(m)}>Add bill</button>}</td></tr>
  );
  return (
    <div className="card" style={{ borderLeft: '5px solid var(--brand, #1B6A4D)', margin: '12px 0' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><b>Purchases, month to date</b><span className="chip" style={{ background: 'var(--sunken)' }}>{mon} to {d.day} {new Date(d.month_start + 'T12:00:00').toLocaleDateString('en-IN', { month: 'short' })}</span></div>
      <div className="row" style={{ alignItems: 'flex-end', gap: 22, marginTop: 6 }}>
        <div><div style={{ fontSize: 28 }} className="num">{rs(Number(d.billed))}</div><div className="small muted">From {d.bills} bill{d.bills === 1 ? '' : 's'}. Home purchases are not included.</div></div>
        <div><div className="small muted">Average per day</div><div style={{ fontSize: 18 }} className="num">{rs(Number(d.billed) / Math.max(1, d.day))}</div></div>
      </div>
      {days.length > 0 && <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 56, marginTop: 10 }} aria-label="Billed purchases per day">{days.map((x) => <span key={x.d} title={`${dl(x.d)}: ${rs(Number(x.amt))}`} style={{ flex: 1, background: '#BFDACB', borderRadius: '4px 4px 0 0', height: `${Math.max(6, (Number(x.amt) / max) * 100)}%` }} />)}</div>}
      {need.length > 0
        ? <div className="banner warn" style={{ marginTop: 12 }}><b>{need.length} received deliver{need.length === 1 ? 'y has' : 'ies have'} no bill yet.</b> Their cost is not in the number above, so the real total is higher. <button className="btn quiet" style={{ padding: '0 4px', textDecoration: 'underline' }} onClick={() => setSheet('missing')}>Fix them</button></div>
        : <div className="banner ok" style={{ marginTop: 12 }}>Every received delivery this month has a bill.</div>}
      <div className="row" style={{ marginTop: 10 }}><button className="btn" onClick={() => setSheet('vendors')}>See vendors</button></div>
      {sheet === 'vendors' && (
        <Sheet title="Purchases by vendor" onClose={() => setSheet(null)}>
          <table style={{ width: '100%' }}><thead><tr><th style={{ textAlign: 'left' }}>Vendor</th><th className="r">Bills</th><th className="r">Amount</th></tr></thead>
            <tbody>{d.vendors.map((v) => <tr key={v.name}><td>{v.name}<div style={{ height: 8, borderRadius: 99, background: 'var(--sunken)', margin: '3px 0' }}><div style={{ width: `${(Number(v.amt) / Math.max(1, Number(d.vendors[0]?.amt))) * 100}%`, height: '100%', borderRadius: 99, background: 'var(--brand, #1B6A4D)' }} /></div></td><td className="r">{v.n}</td><td className="r num">{rs(Number(v.amt))}</td></tr>)}</tbody></table>
        </Sheet>)}
      {sheet === 'missing' && (
        <Sheet title="Deliveries without a bill" onClose={() => setSheet(null)}>
          <p className="muted small">These were received and are already in stock. Add the bill and the amount joins the total.</p>
          {need.length > 0 && <table style={{ width: '100%' }}><thead><tr><th style={{ textAlign: 'left' }}>Needs a bill ({need.length})</th><th>Day</th><th /></tr></thead><tbody>{need.map((m) => row(m, true))}</tbody></table>}
          {rest.length > 0 && <table style={{ width: '100%', marginTop: 14 }}><thead><tr><th style={{ textAlign: 'left' }}>Bill comes later or was cleared ({rest.length})</th><th>Day</th><th /></tr></thead><tbody>{rest.map((m) => row(m, false))}</tbody></table>}
        </Sheet>)}
      {addFor && <AddBillSheet grn={grn(addFor)} vendorName={addFor.vendor} onClose={() => setAddFor(null)} onDone={() => { setAddFor(null); void load(); }} />}
    </div>
  );
}
