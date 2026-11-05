import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText, qty as fmtQty } from '../lib/format';
import { timeOf } from '../lib/ist';
import { SOS_AFTER_SECONDS, type SosAlert } from '../lib/types';
import { useToast } from '../components/Toast';

interface Item { id: number; name: string; unit: string }
const idsOf = (a: SosAlert): number[] => (a.item_ids && a.item_ids.length ? a.item_ids : a.item_id != null ? [a.item_id] : []);
const clock = (sec: number) => { const s = Math.abs(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// The store's page for urgent requests: what each counter needs, how long is left, and issuing from here.
export function SosPage() {
  const { locations, profile } = useSession();
  const toast = useToast();
  const canIssue = profile?.role === 'store' || profile?.role === 'owner';
  const [open, setOpen] = useState<SosAlert[]>([]);
  const [closed, setClosed] = useState<SosAlert[]>([]);
  const [items, setItems] = useState<Record<number, Item>>({});
  const [store, setStore] = useState<Record<number, number>>({});
  const [vals, setVals] = useState<Record<string, Record<number, string>>>({});
  const [extra, setExtra] = useState<Record<string, number[]>>({});
  const [find, setFind] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    await supabase.rpc('sos_sweep');
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [o, c, oh] = await Promise.all([
      supabase.from('sos_alerts').select('*').is('resolved_at', null).order('created_at'),
      supabase.from('sos_alerts').select('*').not('resolved_at', 'is', null).gte('resolved_at', since).order('resolved_at', { ascending: false }).limit(20),
      supabase.from('stock_on_hand').select('item_id, qty').eq('location_id', 1)
    ]);
    setOpen((o.data as SosAlert[]) ?? []); setClosed((c.data as SosAlert[]) ?? []);
    setStore(Object.fromEntries(((oh.data as { item_id: number; qty: number }[]) ?? []).map((r) => [r.item_id, Number(r.qty)])));
  }, []);

  useEffect(() => {
    supabase.from('items').select('id, name, unit').eq('active', true).order('name').then(({ data }) => setItems(Object.fromEntries(((data as Item[]) ?? []).map((i) => [i.id, i]))));
    void load();
    const ch = supabase.channel('sos-page').on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, () => { void load(); }).subscribe();
    const poll = window.setInterval(() => { void load(); }, 10000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { void supabase.removeChannel(ch); window.clearInterval(poll); window.clearInterval(tick); };
  }, [load]);

  const where = (a: SosAlert) => locations.find((l) => l.id === a.location_id)?.name ?? 'A counter';
  const names = (a: SosAlert) => idsOf(a).map((i) => items[i]?.name).filter(Boolean).join(', ');
  const rows = (a: SosAlert) => [...new Set([...idsOf(a), ...(extra[a.id] ?? [])])].filter((i) => items[i]);

  // Time left. Before the store answers: to answer. After "On it": to issue within the promised minutes.
  function clockFor(a: SosAlert): { text: string; late: boolean; label: string } {
    if (a.issued_at) return { text: '', late: false, label: 'Issued. Waiting for the counter to confirm.' };
    const due = a.acked_at && a.eta_minutes ? new Date(a.acked_at).getTime() + a.eta_minutes * 60000 : new Date(a.created_at).getTime() + SOS_AFTER_SECONDS * 1000;
    const left = Math.round((due - now) / 1000);
    const label = a.acked_at ? 'left to issue' : 'left to answer';
    return left >= 0 ? { text: clock(left), late: false, label } : { text: '-' + clock(left), late: true, label: a.acked_at ? 'overdue' : 'no answer yet' };
  }

  async function ack(a: SosAlert, m: number) {
    const { error } = await supabase.rpc('ack_sos', { p_id: a.id, p_eta: m });
    if (error) toast(errText(error)); else void load();
  }
  async function issue(a: SosAlert) {
    const v = vals[a.id] ?? {};
    const lines = rows(a).map((i) => ({ item_id: i, qty: Number(v[i] ?? 1) })).filter((l) => l.qty > 0);
    if (!lines.length) { toast('Enter a quantity for at least one item'); return; }
    setBusy(a.id);
    const { error } = await supabase.rpc('issue_sos', { p_id: a.id, p_lines: lines });
    setBusy(null);
    if (error) { toast(errText(error)); return; }
    toast(`Issued to ${where(a)}. The counter will confirm.`); void load();
  }
  async function closeIt(a: SosAlert) {
    const { error } = await supabase.rpc('resolve_sos', { p_id: a.id });
    if (error) toast(errText(error)); else void load();
  }
  const matches = (a: SosAlert) => { const q = (find[a.id] ?? '').trim().toLowerCase(); return q.length < 2 ? [] : Object.values(items).filter((i) => i.name.toLowerCase().includes(q) && !rows(a).includes(i.id)).slice(0, 6); };
  const sorted = useMemo(() => [...open].sort((x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime()), [open]);

  return (
    <>
      <div className="pagehead"><div><p className="label">Store</p><h1>SOS requests</h1>
        <p className="muted small" style={{ marginTop: 2 }}>What counters need right now. Tap On it so the counter knows you have seen it, then issue from here.</p></div></div>

      {sorted.length === 0 ? <p className="empty card">No open SOS. This page updates by itself.</p> : (
        <div className="stack">
          {sorted.map((a) => {
            const c = clockFor(a); const list = rows(a);
            return (
              <div key={a.id} className="card stack" style={{ borderColor: c.late ? 'var(--bad, #B42335)' : undefined }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div><b style={{ fontSize: 18 }}>{where(a)}</b><div className="muted small">sent {timeOf(a.created_at)}{a.note ? ` · ${a.note}` : ''}</div></div>
                  {c.text ? <div style={{ textAlign: 'right' }}><div className="num" style={{ fontSize: 26, fontWeight: 800, color: c.late ? 'var(--bad, #B42335)' : undefined }}>{c.text}</div><div className="muted small">{c.label}</div></div>
                    : <span className="chip done">{c.label}</span>}
                </div>
                {!a.issued_at && !a.acked_at && canIssue && (
                  <div className="row" style={{ gap: 6 }}><span className="muted small">I will bring it in:</span>{[10, 20, 30, 60].map((m) => <button key={m} className="btn" onClick={() => void ack(a, m)}>On it, {m} min</button>)}</div>
                )}
                {a.acked_at && !a.issued_at && <p className="small muted">Store said on it{a.eta_minutes ? `, about ${a.eta_minutes} min` : ''}.</p>}
                {list.length === 0 && !a.issued_at && <p className="muted small">The counter did not choose an item. Add what you are sending below.</p>}
                {list.length > 0 && (
                  <div className="tablewrap"><table style={{ tableLayout: 'fixed', width: '100%' }}>
                    <colgroup><col /><col style={{ width: 110 }} /><col style={{ width: 130 }} /></colgroup>
                    <thead><tr><th>Item</th><th className="r">In store</th><th className="r">{a.issued_at ? 'Issued' : 'Issue now'}</th></tr></thead>
                    <tbody>{list.map((i) => { const it = items[i]; const have = store[i] ?? 0; const want = Number(vals[a.id]?.[i] ?? 1); const short = want > have;
                      return <tr key={i}><td><b>{it.name}</b> <span className="muted small">{it.unit}</span></td>
                        <td className="r num" style={{ color: short ? 'var(--bad, #B42335)' : undefined, fontWeight: short ? 700 : 400 }}>{fmtQty(have, it.unit)}</td>
                        <td className="r">{a.issued_at ? <span className="muted">done</span> : canIssue ? <input inputMode="decimal" className="num" style={{ textAlign: 'right', width: 100 }} aria-label={`Issue ${it.name}`} value={vals[a.id]?.[i] ?? '1'} onChange={(e) => setVals((p) => ({ ...p, [a.id]: { ...(p[a.id] ?? {}), [i]: e.target.value } }))} /> : null}</td></tr>; })}</tbody>
                  </table></div>
                )}
                {!a.issued_at && canIssue && (
                  <>
                    <label className="field"><span>Add another item</span><input value={find[a.id] ?? ''} onChange={(e) => setFind((p) => ({ ...p, [a.id]: e.target.value }))} placeholder="Type a few letters" /></label>
                    {matches(a).length > 0 && <div className="row">{matches(a).map((m) => <button key={m.id} className="qchip" onClick={() => { setExtra((p) => ({ ...p, [a.id]: [...(p[a.id] ?? []), m.id] })); setFind((p) => ({ ...p, [a.id]: '' })); }}>{m.name}</button>)}</div>}
                    <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy === a.id || list.length === 0} onClick={() => void issue(a)}>{busy === a.id ? 'Issuing…' : `Issue to ${where(a)}`}</button></div>
                  </>
                )}
                {(a.issued_at || !canIssue) && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={() => void closeIt(a)}>{a.issued_at ? 'Close, counter confirmed by phone' : 'Close this SOS'}</button></div>}
                {a.issued_at && <p className="small muted">If the counter does not confirm, this closes by itself 2 hours after issuing and is marked not confirmed.</p>}
              </div>
            );
          })}
        </div>
      )}

      <h2 style={{ marginTop: 8 }}>Closed in the last 24 hours</h2>
      {closed.length === 0 ? <p className="muted">Nothing yet.</p> : (
        <div className="tablewrap"><table style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup><col style={{ width: 120 }} /><col style={{ width: 90 }} /><col /><col style={{ width: 190 }} /></colgroup>
          <thead><tr><th>Counter</th><th>Sent</th><th>Items</th><th>Result</th></tr></thead>
          <tbody>{closed.map((a) => <tr key={a.id}><td><b>{where(a)}</b></td><td className="num">{timeOf(a.created_at)}</td><td className="small">{names(a) || 'Not chosen'}{a.note ? ` · ${a.note}` : ''}</td>
            <td className="small">{a.auto_closed ? <span className="chip late">Issued, not confirmed</span> : a.issued_at ? <span className="chip done">Issued {timeOf(a.issued_at)}</span> : <span className="chip off">Closed</span>}</td></tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}
