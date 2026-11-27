import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/Toast';
import { fmt } from './ClosingWizard';
import '../office.css';

interface Bill { id: string; ref: string; no: string | null; date: string; cat: 'Customer Due' | 'Proximus Room'; who: string | null; phone: string | null; orig: number; col: number; bal: number; status: string }
interface Unm { id: string; date: string; by: string | null; amount: number; method: string | null }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const long = (s: string) => { const [y, m, d] = s.split('-'); return `${+d} ${MON[+m - 1]} ${y}`; };
const SC: Record<string, string> = { Open: 'r', Partial: 'a', 'Fully Paid': 'g', Verified: 'g', Closed: 'n' };

// Outstanding bills: customer dues and Proximus room charges, until they are paid and checked. Owner only.
export function OutstandingBills() {
  const toast = useToast();
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [unm, setUnm] = useState<Unm[]>([]);
  const [tab, setTab] = useState<'bills' | 'unm'>('bills');
  const [st, setSt] = useState('All'); const [cat, setCat] = useState('All'); const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [alloc, setAlloc] = useState<{ u: Unm; bill: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('bills_list');
    if (error) { toast('Could not load the bills'); setBills([]); return; }
    const j = data as { bills: Bill[]; unmatched: Unm[] };
    setBills(j.bills); setUnm(j.unmatched);
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  async function act(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { toast(error.message); return false; }
    toast(ok); await load(); return true;
  }
  if (!bills) return <p className="muted">Loading…</p>;

  const total = bills.reduce((t, b) => t + (b.status === 'Closed' || b.status === 'Verified' ? 0 : b.bal), 0);
  const cnt = (s: string) => bills.filter((b) => b.status === s).length;
  const ql = q.trim().toLowerCase();
  const rows = bills.filter((b) => (st === 'All' || b.status === st) && (cat === 'All' || b.cat === cat) && (!ql || `${b.ref}${b.no ?? ''}${b.who ?? ''}${b.phone ?? ''}`.toLowerCase().includes(ql)));
  const unTotal = unm.reduce((t, u) => t + Number(u.amount), 0);
  const choices = alloc ? bills.filter((b) => b.bal >= alloc.u.amount && !['Closed', 'Verified', 'Fully Paid'].includes(b.status) && b.orig > 0) : [];
  const pick = alloc ? bills.find((b) => b.id === alloc.bill) : undefined;
  const tile = (label: string, n: number, color: string, key: string) => (
    <button className="of-tile" onClick={() => { setTab('bills'); setSt(key); }} style={{ borderTop: `3px solid ${color}`, textAlign: 'center' }}><div className="v" style={{ color }}>{n}</div><div className="n">{label}</div></button>
  );

  return (
    <div className="of">
      <div className="pagehead"><div><p className="label">Finance &amp; Accounts</p><h1>Outstanding bills</h1><p className="muted" style={{ margin: '2px 0 0' }}>Customer dues and Proximus room charges, until they are paid and checked.</p></div>
        <div style={{ textAlign: 'right' }}><div className="muted small">Total outstanding</div><b style={{ fontSize: 24, color: 'var(--bad)' }}>{fmt(total)}</b></div></div>
      <div className="of-seg"><button className={tab === 'bills' ? 'on' : ''} onClick={() => setTab('bills')}>Outstanding bills</button><button className={tab === 'unm' ? 'on' : ''} onClick={() => setTab('unm')}>Unmatched receipts {unm.length > 0 && <span className="of-tag a">{unm.length}</span>}</button></div>

      {tab === 'unm' ? (
        <>
          <div className="of-row" style={{ justifyContent: 'space-between', marginBottom: 10 }}><p className="muted" style={{ margin: 0 }}>Collections on older bills that could not be matched to a bill when the closing was submitted.</p><span><span className="muted small">Total unallocated </span><b>{fmt(unTotal)}</b></span></div>
          {unm.length === 0 ? <div className="of-card"><p className="muted" style={{ margin: 0 }}>Nothing unmatched. All receipts are allocated.</p></div> : unm.map((u) => (
            <div className="of-card" key={u.id}><div className="of-row" style={{ justifyContent: 'space-between' }}>
              <div><span className="of-tag r">Unmatched</span> <span className="muted">{long(u.date)}{u.by ? ' · ' + u.by : ''}</span><div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{fmt(Number(u.amount))}</div><span className="muted">{u.method ?? ''}</span></div>
              <button className="btn primary" onClick={() => setAlloc({ u, bill: '' })}>Allocate to bill</button></div></div>
          ))}
        </>
      ) : (
        <>
          <div className="of-tiles" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>{tile('Open bills', cnt('Open'), 'var(--bad)', 'Open')}{tile('Partial payments', cnt('Partial'), '#D98A1F', 'Partial')}{tile('Verified', cnt('Verified'), 'var(--brand)', 'Verified')}{tile('Closed', cnt('Closed'), 'var(--ink-3)', 'Closed')}</div>
          <div className="of-card"><div className="of-row">
            <input className="of-in" style={{ flex: 1, minWidth: 200 }} placeholder="Search by bill no., customer name, phone, room no..." value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="of-in" style={{ width: 150 }} value={st} onChange={(e) => setSt(e.target.value)}>{['All', 'Open', 'Partial', 'Fully Paid', 'Verified', 'Closed'].map((x) => <option key={x}>{x}</option>)}</select>
            <select className="of-in" style={{ width: 160 }} value={cat} onChange={(e) => setCat(e.target.value)}>{['All', 'Customer Due', 'Proximus Room'].map((x) => <option key={x}>{x}</option>)}</select></div></div>
          <div className="of-card" style={{ padding: '6px 8px' }}><div className="of-wx"><table className="of-t"><thead><tr><th>Bill</th><th>Date</th><th>Category</th><th>Customer / room</th><th className="r">Original</th><th className="r">Collected</th><th className="r">Balance</th><th>Status</th><th /></tr></thead><tbody>
            {rows.map((b) => (
              <tr key={b.id}><td><b>{b.no ?? '-'}</b><small className="muted" style={{ display: 'block' }}>{b.ref}</small></td><td>{long(b.date)}</td>
                <td><span className={'of-tag ' + (b.cat === 'Customer Due' ? 'a' : 'b')}>{b.cat}</span></td><td>{b.who ?? '-'}<small className="muted" style={{ display: 'block' }}>{b.phone ?? ''}</small></td>
                <td className="r">{fmt(Number(b.orig))}</td><td className="r of-pos">{fmt(Number(b.col))}</td><td className={'r ' + (b.bal ? 'of-neg' : '')}>{fmt(Number(b.bal))}</td>
                <td><span className={'of-tag ' + (SC[b.status] ?? 'n')}>{b.status}</span></td>
                <td className="r">{b.status === 'Fully Paid' && <button className="btn small" disabled={busy} onClick={() => void act('bills_verify', { p_id: b.id }, 'Verified')}>Verify</button>}
                  {b.status === 'Verified' && <button className="btn small" disabled={busy} onClick={() => void act('bills_close', { p_id: b.id }, 'Closed')}>Close</button>}</td></tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="muted">No bills match.</td></tr>}
          </tbody></table></div></div>
        </>
      )}

      {alloc && (
        <div className="of-sheet"><div>
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Allocate {fmt(Number(alloc.u.amount))} ({alloc.u.method ?? ''}, {long(alloc.u.date)})</h3>
          <p className="of-sub">Pick the bill this payment was for. The balance goes down by the amount.</p>
          <label className="of-l">Bill</label>
          <select className="of-in" value={alloc.bill} onChange={(e) => setAlloc({ ...alloc, bill: e.target.value })}><option value="">Choose a bill</option>{choices.map((b) => <option key={b.id} value={b.id}>{b.no ?? b.ref} · {b.who ?? ''} · balance {fmt(Number(b.bal))}</option>)}</select>
          {choices.length === 0 && <div className="of-note">No open bill has a balance big enough for this payment.</div>}
          {pick && <div className="of-note ok">Bill {pick.no ?? pick.ref} balance goes from {fmt(Number(pick.bal))} to {fmt(Number(pick.bal) - Number(alloc.u.amount))}.</div>}
          <div className="of-row" style={{ marginTop: 12, justifyContent: 'flex-end' }}><button className="btn" onClick={() => setAlloc(null)}>Cancel</button>
            <button className="btn primary" disabled={busy || !pick} onClick={async () => { if (await act('bills_allocate', { p_receipt: alloc.u.id, p_bill: alloc.bill }, 'Allocated')) setAlloc(null); }}>Allocate</button></div>
        </div></div>
      )}
    </div>
  );
}
