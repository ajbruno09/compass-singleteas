import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { qty as fmtQty, errText, packFactor, round3 } from '../lib/format';
import { timeOf } from '../lib/ist';
import { useToast } from '../components/Toast';

interface Item { id: number; name: string; unit: string; show_as?: string | null; purchase_factor?: number | null }
interface IssueRow { id: string; issue_number: string; to_location_id: number; status: string; issued_at: string | null; for_date?: string | null; late_reason?: string | null; late_days?: number | null; issue_lines: { item_id: number; qty_issued: number; qty_received: number | null }[] }

export function Issue() {
  const { locations } = useSession();
  const toast = useToast();
  const counters = locations.filter((l) => l.kind === 'department' && l.active);
  const [loc, setLoc] = useState<number | null>(null);
  const [day, setDay] = useState('');
  const [items, setItems] = useState<Record<number, Item>>({});
  const [asked, setAsked] = useState<Record<number, number>>({});
  const [store, setStore] = useState<Record<number, number>>({});
  const [vals, setVals] = useState<Record<number, string>>({});
  const [extra, setExtra] = useState<number[]>([]);
  const [find, setFind] = useState('');
  const [today, setToday] = useState<IssueRow[]>([]);
  const [forDate, setForDate] = useState('');
  const [lpgDone, setLpgDone] = useState(false);
  const [pStat, setPStat] = useState<{ active: boolean; label?: string } | null>(null);
  const [pLabel, setPLabel] = useState('');
  const loadParty = useCallback(async () => { const { data } = await supabase.rpc('party_status'); setPStat((data as typeof pStat) ?? null); }, []);
  useEffect(() => { void loadParty(); }, [loadParty]);
  async function partyOn() { const { error } = await supabase.rpc('party_switch_on', { p_label: pLabel }); if (error) return toast(errText(error)); setPLabel(''); toast('Party order is on'); void loadParty(); window.dispatchEvent(new Event('compass:party')); setTimeout(() => window.location.reload(), 600); }
  async function partyOff() { const { error } = await supabase.rpc('party_close'); if (error) return toast(errText(error)); toast('Party order closed'); void loadParty(); window.dispatchEvent(new Event('compass:party')); setTimeout(() => window.location.reload(), 600); }
  const [blockedList, setBlockedList] = useState<{ location_id: number; name: string; old: number }[]>([]);
  const loadBlocked = useCallback(async () => { const { data } = await supabase.rpc('receive_blocked_list'); setBlockedList((data as typeof blockedList) ?? []); }, []);
  useEffect(() => { void loadBlocked(); }, [loadBlocked]);
  async function release(id: number) { const { error } = await supabase.rpc('release_receive_block', { p_location: id }); if (error) toast(errText(error)); else { toast('Released for today'); void loadBlocked(); } }
  const [old, setOld] = useState<{ indent_id: string; location_id: number; location_name: string; for_date: string; items: number }[]>([]);
  const [why, setWhy] = useState('');
  const [whyNote, setWhyNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.rpc('business_date', { p_at: new Date().toISOString() }).then(({ data }) => setDay(String(data)));
    supabase.from('items').select('id, name, unit, show_as, purchase_factor').eq('active', true).order('name').then(({ data }) => setItems(Object.fromEntries(((data as Item[]) ?? []).map((i) => [i.id, i]))));
  }, []);
  useEffect(() => { if (loc == null && counters.length) setLoc(counters[0].id); }, [counters, loc]);

  const loadToday = useCallback(async () => {
    if (!day) return;
    const { data } = await supabase.from('issues').select('id, issue_number, to_location_id, status, issued_at, for_date, late_reason, late_days, issue_lines(item_id, qty_issued, qty_received)').gte('issued_at', day + 'T00:00:00+05:30').order('issued_at', { ascending: false });
    setToday((data as IssueRow[]) ?? []);
  }, [day]);
  useEffect(() => { void loadToday(); }, [loadToday]);
  const loadOld = useCallback(async () => { const { data } = await supabase.rpc('unissued_indents'); setOld((data as typeof old) ?? []); }, []);
  useEffect(() => { void loadOld(); }, [loadOld]);
  useEffect(() => { if (day && !forDate) setForDate(day); }, [day, forDate]);
  const isLate = !!forDate && !!day && forDate < day;

  useEffect(() => {
    if (!loc || !day || !forDate || !Object.keys(items).length) return;
    setVals({}); setExtra([]); setErr('');
    (async () => {
      const [ind, oh] = await Promise.all([
        supabase.from('indents').select('indent_lines(item_id, qty)').eq('location_id', loc).eq('for_date', forDate).in('status', ['submitted', 'locked']),
        supabase.from('stock_on_hand').select('item_id, qty').eq('location_id', 1)
      ]);
      const a: Record<number, number> = {};
      for (const r of (ind.data as { indent_lines: { item_id: number; qty: number }[] }[]) ?? []) for (const l of r.indent_lines) a[l.item_id] = (a[l.item_id] ?? 0) + Number(l.qty);
      setAsked(a);
      setStore(Object.fromEntries(((oh.data as { item_id: number; qty: number }[]) ?? []).map((r) => [r.item_id, Number(r.qty)])));
      setVals(Object.fromEntries(Object.entries(a).map(([id, q]) => [id, String(items[Number(id)] && packFactor(items[Number(id)]) ? Math.max(1, Math.round(q / packFactor(items[Number(id)]))) : q)])));
    })();
  }, [loc, day, forDate, items]);

  useEffect(() => { setLpgDone(false); if (!loc) return; supabase.rpc('lpg_status', { p_location: loc }).then(({ data }) => setLpgDone(!!(data as { issued_today?: boolean } | null)?.issued_today)); }, [loc, today.length]);
  const ids = useMemo(() => Object.keys(asked).map(Number).concat(extra.filter((e) => !(e in asked))).filter((id) => items[id]).sort((a, b) => items[a].name.localeCompare(items[b].name)), [asked, extra, items]);
  const matches = useMemo(() => find.trim().length < 2 ? [] : Object.values(items).filter((i) => i.name.toLowerCase().includes(find.toLowerCase()) && !ids.includes(i.id)).slice(0, 6), [find, items, ids]);
  const locName = (id: number) => locations.find((l) => l.id === id)?.name ?? '';

  async function send() {
    setErr('');
    const lines = Object.entries(vals).filter(([id, v]) => Number(id) !== 658 && Number(v) > 0).map(([id, v]) => ({ item_id: Number(id), qty: round3(Number(v) * (packFactor(items[Number(id)] ?? {}) || 1)) }));
    if (!lines.length) return setErr('Enter a quantity for at least one item.');
    const reason = [why, whyNote.trim()].filter(Boolean).join(': ');
    if (isLate && !reason) return setErr('This indent is for an earlier day. Please say why it is being issued late.');
    setBusy(true);
    const { error } = await supabase.rpc('create_issue', { p_to: loc, p_lines: lines, p_for_date: forDate || null, p_reason: isLate ? reason : null });
    setBusy(false);
    if (error) return setErr(errText(error));
    toast(`Issued to ${locName(loc!)}. The counter will confirm.`); setVals({}); setAsked({}); setExtra([]); setWhy(''); setWhyNote(''); setForDate(day); void loadToday(); void loadOld();
  }

  return (
    <>
      <div className="pagehead"><div><p className="label">Store</p><h1>Issue to counters</h1><p className="muted small" style={{ marginTop: 2 }}>Filled from what each counter asked for. Change any amount, then send. The counter confirms what it received.</p></div></div>
      <div className="card" style={{ display: 'grid', gap: 8 }}>
        <b>Party order</b>
        {pStat?.active ? (<>
          <span className="small muted">On now: <b>{pStat.label}</b>. Kitchen counters can place the party indent. When the party is done, close it.</span>
          <button className="btn secondary" onClick={() => void partyOff()}>Close party order</button>
        </>) : (<>
          <span className="small muted">Off. Switch it on for a party and the kitchen counters can order any items for it.</span>
          <input value={pLabel} onChange={(e) => setPLabel(e.target.value)} placeholder="Party name, for example Sharma wedding" style={{ minHeight: 44 }} />
          <button className="btn primary" disabled={!pLabel.trim()} onClick={() => void partyOn()}>Switch on party order</button>
        </>)}
      </div>
      {blockedList.length > 0 && (
        <div className="card" style={{ borderColor: '#F3B48E', display: 'grid', gap: 8 }}>
          <b>Counters that have not received yesterday's items</b>
          <span className="small muted">Until they receive, these counters cannot indent or send an SOS. You can release one for today if there is a real reason.</span>
          {blockedList.map((b) => <div key={b.location_id} className="row" style={{ justifyContent: 'space-between' }}><span><b>{b.name}</b> <span className="muted small">· {b.old} {b.old === 1 ? 'issue' : 'issues'} waiting</span></span><button className="btn secondary" onClick={() => void release(b.location_id)}>Release for today</button></div>)}
        </div>
      )}
      {old.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warn, #B7791F)', display: 'grid', gap: 8 }}>
          <b>Indents sent earlier but not issued yet</b>
          <span className="small muted">You can still issue these. You will be asked for the reason, and Admin is told.</span>
          <div className="row" style={{ gap: 8 }}>{old.map((o) => <button key={o.indent_id} className={'btn secondary' + (loc === o.location_id && forDate === o.for_date ? ' pick on' : '')} onClick={() => { setLoc(o.location_id); setForDate(o.for_date); }}>{o.location_name} · {new Date(o.for_date + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {o.items} items</button>)}</div>
        </div>
      )}
      <div className="seg" role="group" aria-label="Counter">{counters.map((c) => <button key={c.id} aria-pressed={loc === c.id} onClick={() => { setLoc(c.id); setForDate(day); }}>{c.name}</button>)}</div>
      <div className="tablewrap"><table>
        <thead><tr><th>Item</th><th className="r">Asked</th><th className="r">In store</th><th className="r" style={{ width: 130 }}>Issue now</th></tr></thead>
        <tbody>{ids.map((id) => { const it = items[id]; const f = packFactor(it); const have = store[id] ?? 0; const want = Number(vals[id] ?? 0) * (f || 1); const short = want > have; const show = (n: number) => (f ? `${Math.round((n / f) * 10) / 10} ${it.show_as}` : fmtQty(n, it.unit));
          if (id === 658) return <tr key={id}><td><b>{it.name}</b> <span className="muted small">cylinder</span></td>
            <td className="r num">{asked[id] != null ? show(asked[id]) : <span className="muted small">extra</span>}</td>
            <td className="r" colSpan={2}>{lpgDone ? <span className="chip done">Cylinder issued today</span> : <Link className="btn secondary" to="/gas">Issue on the Gas screen</Link>}</td></tr>;
          return <tr key={id}><td><b>{it.name}</b> <span className="muted small">{f ? it.show_as : it.unit}</span></td>
            <td className="r num">{asked[id] != null ? show(asked[id]) : <span className="muted small">extra</span>}</td>
            <td className="r num" style={{ color: short ? 'var(--bad, #B42335)' : undefined, fontWeight: short ? 700 : 400 }}>{show(have)}</td>
            <td className="r"><input inputMode="decimal" className="num" style={{ textAlign: 'right', width: 110 }} aria-label={`Issue ${it.name}`} value={vals[id] ?? ''} onChange={(e) => setVals((p) => ({ ...p, [id]: e.target.value }))} /></td></tr>; })}</tbody>
      </table>{ids.length === 0 && <p className="empty">{loc ? `${locName(loc)} has not sent an indent for today. You can still add items below.` : ''}</p>}</div>
      {isLate && (
        <div className="card" style={{ display: 'grid', gap: 8, borderColor: 'var(--bad, #B42335)' }}>
          <b>This indent is for {new Date(forDate + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, issued late</b>
          <span className="small muted">Please say why. This goes to Admin.</span>
          <div className="row" style={{ gap: 8 }}>{['Counter was off', 'Holiday', 'Stock not available', 'Forgot or missed', 'Other'].map((r) => <button key={r} className={'btn secondary' + (why === r ? ' pick on' : '')} aria-pressed={why === r} onClick={() => setWhy(r)}>{r}</button>)}</div>
          <input placeholder="Add a note (needed if Other)" value={whyNote} onChange={(e) => setWhyNote(e.target.value)} />
        </div>
      )}
      <label className="field"><span>Add another item</span><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type a few letters" /></label>
      {matches.length > 0 && <div className="row">{matches.map((m) => <button key={m.id} className="qchip" onClick={() => { setExtra((p) => [...p, m.id]); setFind(''); }}>{m.name}</button>)}</div>}
      {err && <p className="banner bad" role="alert">{err}</p>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy || !loc} onClick={send}>{busy ? 'Sending…' : `Issue to ${loc ? locName(loc) : '…'}`}</button></div>

      <h2 style={{ marginTop: 8 }}>Issued today</h2>
      {today.length === 0 ? <p className="muted">Nothing issued yet today.</p> : (
        <div className="stack">{today.map((s) => {
          const diff = s.issue_lines.filter((l) => l.qty_received != null && Math.abs(Number(l.qty_received) - Number(l.qty_issued)) > Math.max(0.001, Number(l.qty_issued) * 0.02));
          return <div key={s.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div><b>{locName(s.to_location_id)}</b> <span className="muted small">· {s.issue_number} · {timeOf(s.issued_at)} · {s.issue_lines.length} items</span></div>
              {s.late_days ? <span className="chip flag">Late {s.late_days}d</span> : null}{s.status === 'submitted' ? <span className="chip due">Waiting for counter</span> : diff.length ? <span className="chip late">{diff.length} differ</span> : <span className="chip done">Confirmed</span>}
            </div>
            {s.late_reason && <div className="small" style={{ marginTop: 6 }}><b>Issued late:</b> {s.late_reason}</div>}
            {diff.length > 0 && <div className="small" style={{ marginTop: 6 }}>{diff.map((l) => `${items[l.item_id]?.name}: issued ${fmtQty(Number(l.qty_issued), items[l.item_id]?.unit)}, counter says ${fmtQty(Number(l.qty_received), items[l.item_id]?.unit)}`).join(' · ')}</div>}
          </div>; })}</div>
      )}
    </>
  );
}
