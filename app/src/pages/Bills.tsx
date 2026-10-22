import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { money, money2, date, errText } from '../lib/format';
import type { BillRow, Vendor } from '../lib/types';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

interface Bill extends BillRow { remarks?: string }
type Filter = 'pending' | 'all' | 'paid';

export function Bills() {
  const { profile } = useSession();
  const [rows, setRows] = useState<Bill[]>([]);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendor, setVendor] = useState('');
  const [filter, setFilter] = useState<Filter>('pending');
  const [paying, setPaying] = useState<Bill | null>(null);
  const [adding, setAdding] = useState(false);
  const canPay = profile?.role === 'owner' || profile?.role === 'accounts';

  async function load() {
    const [{ data }, { data: v }, { data: r }] = await Promise.all([
      supabase.from('vendor_bill_balances').select('*').order('received_date', { ascending: false }),
      supabase.from('vendors').select('*').order('name'),
      supabase.from('vendor_bills').select('id, remarks').neq('remarks', '')
    ]);
    setRows((data as Bill[]) ?? []);
    setVendors((v as Vendor[]) ?? []);
    setRemarks(Object.fromEntries(((r as { id: string; remarks: string }[]) ?? []).map((x) => [x.id, x.remarks])));
  }
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => rows.filter((r) => (!vendor || r.vendor_id === vendor)
    && (filter === 'all' || (filter === 'pending' ? Number(r.balance) > 0 : r.payment_status === 'Paid'))), [rows, vendor, filter]);
  const sum = (f: (r: Bill) => number) => shown.reduce((s, r) => s + f(r), 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="pagehead">
        <div><p className="label">Accounts</p><h1>Bills and payments</h1></div>
        {canPay && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />Add bill</button>}
      </div>
      <div className="grid-tiles">
        <div className="card tile"><span className="label">Bills shown</span><span className="big">{shown.length}</span></div>
        <div className="card tile"><span className="label">Billed</span><span className="big">{money(sum((r) => (r.status === 'cancelled' ? 0 : Number(r.amount))))}</span></div>
        <div className="card tile" style={{ background: 'var(--turmeric-tint)', borderColor: 'var(--turmeric)' }}><span className="label" style={{ color: 'var(--ink)' }}>Unpaid</span><span className="big">{money(sum((r) => Number(r.balance)))}</span></div>
      </div>
      <div className="row">
        <div className="seg" role="group" aria-label="Show">
          {(['pending', 'paid', 'all'] as Filter[]).map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'pending' ? 'Unpaid' : f === 'paid' ? 'Paid' : 'All'}</button>)}
        </div>
        <select id="bill-vendor" aria-label="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} style={{ maxWidth: 300, marginLeft: 'auto' }}>
          <option value="">All vendors</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Received</th><th>Vendor</th><th>Bill no.</th><th className="r">Amount</th><th className="r">Paid</th><th className="r">Unpaid</th><th>Status</th><th>Due</th>{canPay && <th></th>}</tr></thead>
          <tbody>
            {shown.map((r) => {
              const overdue = r.due_date && Number(r.balance) > 0 && r.due_date < today;
              const chip = r.payment_status === 'Paid' ? 'done' : r.payment_status === 'Cancelled' ? 'off' : r.payment_status === 'Part paid' ? 'due' : 'late';
              return (
                <tr key={r.id}>
                  <td className="num small">{date(r.received_date)}</td>
                  <td><strong>{r.vendor_name}</strong>{remarks[r.id] && <div className="small" style={{ color: 'var(--watch)' }}>{remarks[r.id]}</div>}</td>
                  <td className="num small">{r.bill_number || <span className="muted">none</span>}</td>
                  <td className="r num">{money2(r.amount)}</td>
                  <td className="r num">{money2(r.paid)}</td>
                  <td className="r num" style={{ fontWeight: Number(r.balance) > 0 ? 700 : 400 }}>{money2(r.balance)}</td>
                  <td><span className={`chip ${chip}`}>{r.payment_status}</span></td>
                  <td className="num small" style={{ color: overdue ? 'var(--critical)' : undefined, fontWeight: overdue ? 700 : 400 }}>{r.due_date ? date(r.due_date) : '—'}</td>
                  {canPay && <td>{Number(r.balance) > 0 && <button className="btn secondary" onClick={() => setPaying(r)}>Record payment</button>}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="empty">No bills here.</p>}
      </div>
      {paying && <PaymentForm bill={paying} onClose={() => setPaying(null)} onSaved={() => { setPaying(null); load(); }} />}
      {adding && <BillForm vendors={vendors} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </>
  );
}

const MODES = ['UPI', 'Cash', 'Bank transfer', 'Card', 'Cheque'];

function PaymentForm({ bill, onClose, onSaved }: { bill: Bill; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(String(bill.balance));
  const [mode, setMode] = useState('UPI');
  const [ref, setRef] = useState('');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setError('');
    const a = Number(amount);
    if (!(a > 0)) return setError('Enter the amount paid.');
    if (a > Number(bill.balance) + 0.001) return setError(`That is more than the unpaid ${money2(bill.balance)}.`);
    if (mode !== 'Cash' && !ref.trim()) return setError('Add the UPI or bank reference so accounts can match it.');
    setBusy(true);
    const { error } = await supabase.from('bill_payments').insert({ bill_id: bill.id, amount: a, mode, reference: ref.trim(), paid_on: paidOn });
    setBusy(false);
    if (error) return setError(errText(error));
    toast('Payment recorded'); onSaved();
  }
  return (
    <Sheet title="Record payment" onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Record payment'}</button></>}>
      <div className="card"><strong>{bill.vendor_name}</strong><p className="small muted">Bill {bill.bill_number || 'without number'} · {date(bill.received_date)} · unpaid {money2(bill.balance)}</p></div>
      <div className="form-grid">
        <label className="field"><span>Amount (₹)</span><input id="pay-amount" inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="field"><span>Paid on</span><input id="pay-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
        <label className="field"><span>Mode</span><select id="pay-mode" value={mode} onChange={(e) => setMode(e.target.value)}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className="field"><span>Reference</span><input id="pay-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="UTR or UPI ref" /></label>
      </div>
      {error && <p className="banner bad" role="alert">{error}</p>}
    </Sheet>
  );
}

function BillForm({ vendors, onClose, onSaved }: { vendors: Vendor[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [vendorId, setVendorId] = useState('');
  const [no, setNo] = useState('');
  const [received, setReceived] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setError('');
    if (!vendorId) return setError('Choose the vendor.');
    if (!(Number(amount) > 0)) return setError('Enter the bill amount.');
    setBusy(true);
    const { error } = await supabase.from('vendor_bills').insert({ vendor_id: vendorId, bill_number: no.trim() || null, received_date: received, order_date: received, amount: Number(amount), remarks: 'Entered without a goods receipt' });
    setBusy(false);
    if (error) return setError(errText(error));
    toast('Bill added'); onSaved();
  }
  return (
    <Sheet title="Add bill" onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Add bill'}</button></>}>
      <p className="banner warn">From the next phase, bills come from goods receiving with a photo. Use this only for bills that had no delivery through the store.</p>
      <label className="field"><span>Vendor</span><select id="bill-new-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}><option value="">Choose</option>{vendors.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
      <div className="form-grid">
        <label className="field"><span>Bill number</span><input id="bill-new-no" value={no} onChange={(e) => setNo(e.target.value)} /></label>
        <label className="field"><span>Received on</span><input id="bill-new-date" type="date" value={received} onChange={(e) => setReceived(e.target.value)} /></label>
        <label className="field"><span>Amount (₹)</span><input id="bill-new-amount" inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      </div>
      {error && <p className="banner bad" role="alert">{error}</p>}
    </Sheet>
  );
}
