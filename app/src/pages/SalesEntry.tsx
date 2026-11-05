import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { useToast } from '../components/Toast';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() - 86400000));

// Admin enters each counter's sales for a day. Staff then see their own counters on My Compass.
export function SalesEntry() {
  const { locations } = useSession();
  const toast = useToast();
  const counters = locations.filter((l) => l.kind === 'department' && l.active);
  const [date, setDate] = useState(today());
  const [vals, setVals] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void supabase.from('daily_sales').select('location_id, amount').eq('business_date', date).then(({ data }) => {
      setVals(Object.fromEntries(((data as { location_id: number; amount: number }[]) ?? []).map((r) => [r.location_id, String(r.amount)])));
    });
  }, [date]);
  async function save() {
    setBusy(true);
    try {
      const rows = counters.map((c) => ({ location_id: c.id, amount: (vals[c.id] ?? '').trim() }));
      const { error } = await supabase.rpc('save_sales', { p_date: date, p_rows: rows });
      if (error) throw error;
      toast('Sales saved');
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  }
  const total = counters.reduce((a, c) => a + (Number(vals[c.id]) || 0), 0);
  return (
    <div className="page">
      <h1>Daily sales</h1>
      <p className="muted">Enter each counter's sales for the day. Your team sees their own counters, and their share of the cafe, on My Compass.</p>
      <label className="field" style={{ maxWidth: 220 }}><span>Day</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <div className="card" style={{ display: 'grid', gap: 10, maxWidth: 460 }}>
        {counters.map((c) => (
          <label key={c.id} className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
            <span>{c.name}</span>
            <input className="num" style={{ width: 140 }} inputMode="decimal" value={vals[c.id] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [c.id]: e.target.value.replace(/[^0-9.]/g, '') }))} placeholder="0" />
          </label>
        ))}
        <div className="row" style={{ justifyContent: 'space-between' }}><b>Total</b><b>₹{total.toLocaleString('en-IN')}</b></div>
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save sales'}</button>
      </div>
    </div>
  );
}
