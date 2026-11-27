import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { useToast } from '../components/Toast';
import { DEN, fmt } from './ClosingWizard';
import '../petty.css';

type Den = Record<string, number>;
interface Mv { id: string; at: string; kind: 'receive' | 'issue' | 'exchange' | 'bank' | 'owner'; status: string; amount: number; diff: number; reason: string | null; ref: string | null; photo: string | null; to: string | null; delta: Den }
interface St {
  hand: Den; total: number; float: number; business_date: string; target: string; phase: 'closed' | 'notyet' | 'overdue'; late: boolean;
  closing: { id: string; submitted_at: string; by: string | null; expected: Den; total: number } | null;
  received: { at: string; diff: number; reason: string | null } | null;
  issued: { id: string; to: string; status: string; at: string; den: Den } | null;
  opening: { id: string; name: string }[]; ledger: Mv[];
}
const FLOAT = 2000;
const IDEAL: Record<number, number> = { 200: 3, 100: 8, 50: 6, 20: 7, 10: 11, 5: 4, 2: 10, 1: 10 };
const tot = (d: Record<string, number | string>) => DEN.reduce((t, x) => t + x * (Number(d[x]) || 0), 0);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmy = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${MON[+m - 1]}/${y}`; };
const clock = (t: string) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// Maximum small change for the float, from what is in hand. Never a Rs 500 note.
function suggest(hand: Den): Den {
  const out: Den = {};
  DEN.forEach((d) => { out[d] = Math.min(IDEAL[d] || 0, hand[d] || 0); });
  let rem = FLOAT - tot(out);
  for (const d of [20, 10, 50, 5, 100, 2, 1, 200]) { while (rem >= d && (hand[d] || 0) - (out[d] || 0) > 0) { out[d] = (out[d] || 0) + 1; rem -= d; } }
  return out;
}
const clean = (d: Record<string, string | number>): Den => { const o: Den = {}; DEN.forEach((x) => { const v = Number(d[x]) || 0; if (v > 0) o[x] = v; }); return o; };

function DenTable({ vals, hand, exp, onChange, skip = [], totalLabel = 'Total' }: { vals: Record<string, string | number>; hand?: Den; exp?: Den; onChange?: (d: number, v: string) => void; skip?: number[]; totalLabel?: string }) {
  return (
    <table className="pc-t">
      <thead><tr><th>Note or coin</th>{exp && <th>Expected</th>}{hand && <th>In hand</th>}<th>{onChange ? 'Counted' : 'Count'}</th><th>Amount</th></tr></thead>
      <tbody>
        {DEN.filter((d) => !skip.includes(d)).map((d) => {
          const v = Number(vals[d]) || 0; const df = exp && v !== (exp[d] || 0);
          return (
            <tr key={d}><td>{'₹'}{d}</td>{exp && <td>{exp[d] || 0}</td>}{hand && <td>{hand[d] || 0}</td>}
              <td>{onChange ? <input className={df ? 'diff' : ''} inputMode="numeric" value={vals[d] ?? ''} placeholder="0" onChange={(e) => onChange(d, e.target.value.replace(/[^0-9]/g, ''))} /> : v}</td>
              <td>{fmt(d * v)}</td></tr>
          );
        })}
        <tr className="t"><td>{totalLabel}</td>{exp && <td>{fmt(tot(exp))}</td>}{hand && <td>{fmt(tot(hand))}</td>}<td /><td>{fmt(tot(vals))}</td></tr>
      </tbody>
    </table>
  );
}

// Petty cash, for Devid (store) and the owner. Opening staff see PettyReceived instead.
export function PettyCash() {
  const { profile } = useSession();
  const toast = useToast();
  const isOwner = profile?.role === 'owner' || profile?.role === 'manager';
  const [st, setSt] = useState<St | null>(null);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [why, setWhy] = useState('');
  const [who, setWho] = useState('');
  const [iden, setIden] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | { k: 'bank' | 'owner' | 'xchg'; den: Record<string, string>; get: Record<string, string>; slip: string; photo: File | null }>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('petty_state');
    if (error) { toast(error.message); return; }
    const s = data as St; setSt(s);
    setCounted((c) => (Object.keys(c).length ? c : Object.fromEntries(DEN.map((d) => [d, String(s.closing?.expected[d] || 0)]))));
    setIden(Object.fromEntries(DEN.map((d) => [d, String(suggest(s.hand)[d] || 0)])));
    setWho((w) => w || s.opening[0]?.id || '');
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  async function call(fn: string, args: Record<string, unknown>, ok?: string) {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { toast(error.message); return false; }
    if (ok) toast(ok);
    await load(); return true;
  }

  const matches = useMemo(() => !!st?.closing && DEN.every((d) => (Number(counted[d]) || 0) === (st.closing!.expected[d] || 0)), [st, counted]);
  if (!st) return <p className="muted">Loading…</p>;

  const rec = !!st.received; const issued = st.issued;
  const issueTotal = tot(iden); const issueOver = DEN.filter((d) => (Number(iden[d]) || 0) > (st.hand[d] || 0));
  const issueOK = rec && !issued && !!who && issueTotal === FLOAT && !issueOver.length;
  const low = issued ? DEN.filter((d) => d <= 50 && (st.hand[d] || 0) < 5) : [];
  const out = low.some((d) => (st.hand[d] || 0) === 0);
  const waiting = st.ledger.filter((l) => l.kind === 'owner' && l.status === 'waiting');
  const shortOfChange = rec && !issued && (tot(suggest(st.hand)) < FLOAT);

  async function accept() {
    if (!st?.closing) return;
    if (!matches && !why.trim()) { toast('Add a reason for the difference'); return; }
    await call('petty_receive', { p_counted: clean(counted), p_reason: why.trim() || null }, 'Cash accepted');
    setWhy('');
  }

  const sh = sheet;
  const shDen = sh ? clean(sh.den) : {};
  const shOver = sh ? DEN.filter((d) => (shDen[d] || 0) > (st.hand[d] || 0)) : [];
  const xGet = sh ? clean(sh.get) : {};
  const sOK = !!sh && (sh.k === 'xchg' ? tot(shDen) > 0 && tot(shDen) === tot(xGet) && !shOver.length
    : tot(shDen) > 0 && !shOver.length && (sh.k !== 'bank' || (!!sh.slip.trim() && !!sh.photo)));
  async function confirmSheet() {
    if (!sh) return;
    if (sh.k === 'xchg') { if (await call('petty_exchange', { p_give: shDen, p_get: xGet }, 'Exchange recorded')) setSheet(null); return; }
    if (sh.k === 'owner') { if (await call('petty_handover', { p_den: shDen }, 'Handed over, waiting for the owner')) setSheet(null); return; }
    setBusy(true);
    const path = `petty/${st!.business_date}/${crypto.randomUUID()}.jpg`;
    const up = await supabase.storage.from('bill-photos').upload(path, sh.photo!, { upsert: false, contentType: sh.photo!.type || 'image/jpeg' });
    setBusy(false);
    if (up.error) { toast('Could not upload the photo. Try again.'); return; }
    if (await call('petty_bank', { p_den: shDen, p_slip: sh.slip.trim(), p_photo: path }, 'Deposit recorded')) setSheet(null);
  }
  async function viewSlip(p: string) {
    const { data } = await supabase.storage.from('bill-photos').createSignedUrl(p, 600);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank'); else toast('Could not open the photo');
  }
  const openSheet = (k: 'bank' | 'owner' | 'xchg') => setSheet({ k, den: {}, get: {}, slip: '', photo: null });
  const keepFloat = () => { const keep = suggest(st.hand); setSheet((s) => s && ({ ...s, den: Object.fromEntries(DEN.map((d) => [d, String(Math.max(0, (st.hand[d] || 0) - (keep[d] || 0)))])) })); };

  const label = (l: Mv) => l.kind === 'receive' ? 'POS closing cash accepted' : l.kind === 'issue' ? `Float issued to ${l.to ?? ''}` : l.kind === 'exchange' ? 'Exchanged for change' : l.kind === 'bank' ? 'Deposited in bank' : 'Handed to owner';
  const sub = (l: Mv) => l.kind === 'bank' ? `Slip ${l.ref ?? ''}` : l.kind === 'receive' ? (l.diff ? `Difference ${fmt(l.diff)}${l.reason ? '. ' + l.reason : ''}` : 'Verified') : l.kind === 'owner' ? (l.status === 'received' ? 'Owner received it' : 'Waiting for the owner to confirm') : l.kind === 'issue' ? (l.status === 'accepted' ? 'Accepted' : 'Waiting for them to accept') : 'Notes exchanged';
  const net = (l: Mv) => DEN.reduce((t, d) => t + d * (l.delta[d] || 0), 0);

  return (
    <>
      <div className="pagehead">
        <div><p className="label">Finance &amp; Accounts</p><h1>Petty cash</h1></div>
        <div className="pc-big"><b>{fmt(st.total)}</b><span>Cash in hand</span></div>
      </div>
      <div className="pc-grid">
        <div>
          {isOwner && waiting.length > 0 && (
            <div className="pc-card"><h3>Cash handed to you <span className="pc-tag a">{waiting.length} waiting</span></h3><p className="pc-sub">Count it and confirm you have received it.</p>
              {waiting.map((l) => (
                <div className="pc-led" key={l.id}><div>Handed over by Devid<small>{clock(l.at)}. {DEN.filter((d) => l.delta[d]).map((d) => `${d}×${-l.delta[d]}`).join('  ')}</small></div>
                  <div className="pc-row"><span className="a">{fmt(l.amount)}</span><button className="btn primary" disabled={busy} onClick={() => void call('petty_owner_confirm', { p_id: l.id }, 'Marked as received')}>Received</button></div></div>
              ))}
            </div>
          )}

          {/* 1. POS closing cash */}
          {!st.closing ? (
            <div className="pc-card"><h3>1. POS Closing Cash, {dmy(st.target)} <span className={'pc-tag ' + (st.phase === 'overdue' ? 'r' : 'a')}>{st.phase === 'overdue' ? 'Overdue' : 'Not closed yet'}</span></h3>
              <p className="pc-sub">The POS closing has not been submitted. It is due before 2:00 AM. If it was missed, it must be done before 11:00 AM the next day. The float can be issued only after it is closed and the cash is accepted.</p>
              <div className="pc-note bad">{st.phase === 'overdue' ? 'It is past 11:00 AM and the POS closing is still not done. The owner has been told again. Please tell the manager now.' : 'The POS closing was not done by 2:00 AM. You and the owner were alerted. Please inform the manager to get it closed.'}</div></div>
          ) : rec ? (
            <div className="pc-card"><div className="pc-done"><span>1. POS Closing Cash, {dmy(st.target)}. {st.received!.diff ? `Accepted with a difference of ${fmt(st.received!.diff)}.` : 'Verified and accepted.'}</span><span className="pc-tag g">Accepted</span></div></div>
          ) : (
            <div className="pc-card"><h3>1. POS Closing Cash, {dmy(st.target)} <span className="pc-tag b">Waiting for you</span>{st.late && <span className="pc-tag a">Closed late, {new Date(st.closing.submitted_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>}</h3>
              <p className="pc-sub">{st.closing.by ?? 'The closing staff'} handed the cash over. Count it and check it against the notes and coins below. Accept it before you issue the float.</p>
              <DenTable vals={counted} exp={st.closing.expected} onChange={(d, v) => setCounted((c) => ({ ...c, [d]: v }))} />
              {!matches && <><div className="pc-note">You counted {fmt(tot(counted))}, the closing says {fmt(st.closing.total)}. Difference {fmt(tot(counted) - st.closing.total)}. Add a reason and Compass tells the owner.</div>
                <label className="pc-l">Reason for the difference</label><input className="pc-in" value={why} onChange={(e) => setWhy(e.target.value)} /></>}
              <div className="pc-row" style={{ marginTop: 12, justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy || (!matches && !why.trim())} onClick={() => void accept()}>{matches ? 'Verified, accept the cash' : 'Accept with difference'}</button></div></div>
          )}

          {/* 2. Issue the float */}
          {issued ? (
            <div className="pc-card"><div className="pc-done"><span>2. Float of {fmt(FLOAT)} issued to {issued.to}</span><span className={'pc-tag ' + (issued.status === 'accepted' ? 'g' : 'a')}>{issued.status === 'accepted' ? 'Accepted' : `Waiting for ${issued.to} to accept`}</span></div></div>
          ) : (
            <div className="pc-card" style={rec ? undefined : { opacity: .6 }}><h3>2. Issue today's float <span className="pc-tag n">{fmt(FLOAT)}</span></h3>
              <p className="pc-sub">{rec ? 'Prefilled with the most small change you have. You can change the counts, but the total must be exactly ' + fmt(FLOAT) + '. No ₹500 notes go to the counter.' : 'Accept the POS closing cash first. The float cannot be issued before that.'}</p>
              <label className="pc-l">Give it to (opening staff)</label>
              {st.opening.length ? <select className="pc-in" value={who} disabled={!rec} onChange={(e) => setWho(e.target.value)}>{st.opening.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
                : <div className="pc-note">No opening staff yet. The owner adds them in People, with the Opening staff tick.</div>}
              <div style={{ marginTop: 8 }}><DenTable vals={iden} hand={st.hand} skip={[500]} onChange={rec ? (d, v) => setIden((c) => ({ ...c, [d]: v })) : undefined} /></div>
              {rec && issueTotal !== FLOAT && <div className="pc-note">The total is {fmt(issueTotal)}. It must be exactly {fmt(FLOAT)}.</div>}
              {rec && issueOver.length > 0 && <div className="pc-note">You do not have that many {issueOver.map((d) => '₹' + d).join(', ')}.</div>}
              {shortOfChange && <div className="pc-note info">Not enough small change in hand. You can exchange a note for change, but only by exchanging. <button className="btn" style={{ marginLeft: 6 }} onClick={() => openSheet('xchg')}>Exchange for change</button></div>}
              <div className="pc-row" style={{ marginTop: 12, justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy || !issueOK} onClick={() => void call('petty_issue', { p_to: who, p_den: clean(iden) }, 'Float issued')}>Issue {fmt(FLOAT)}</button></div></div>
          )}

          <div className="pc-card"><h3>Cash in hand <span className="pc-tag n">{issued ? 'After the morning float' : 'With Devid'}</span></h3>
            <DenTable vals={st.hand} skip={[]} />
            {low.length > 0 && <><div className="pc-low">{low.map((d) => (st.hand[d] || 0) === 0 ? <span key={d} className="pc-tag r">Out of {'₹'}{d}: 0 left</span> : <span key={d} className="pc-tag a">Low on {'₹'}{d}: {st.hand[d]} left</span>)}</div>
              <div className={'pc-note ' + (out ? 'bad' : 'info')}>{out ? 'Out of small change. Get change from the bank first.' : 'Running low on small change. Ask for change at the bank when you next go.'}</div></>}
          </div>

          <div className="pc-card"><h3>Move cash</h3><p className="pc-sub">Always with the notes and coins. Cash only comes in by receiving or by exchange.</p>
            <div className="pc-row"><button className="btn" onClick={() => openSheet('bank')}>Deposit in bank</button><button className="btn" onClick={() => openSheet('owner')}>Hand over to owner</button><button className="btn" onClick={() => openSheet('xchg')}>Exchange for change</button></div></div>
        </div>

        <div>
          <div className="pc-card"><h3>Recent movements</h3>
            <div style={{ marginTop: 6 }}>{st.ledger.length === 0 ? <p className="muted">Nothing yet.</p> : st.ledger.map((l) => (
              <div className="pc-led" key={l.id}><div>{label(l)} {(l.status === 'waiting' || l.status === 'accepted' || l.status === 'received') && l.kind !== 'receive' && <span className={'pc-tag ' + (l.status === 'waiting' ? 'a' : 'g')}>{l.status === 'waiting' ? 'Waiting' : l.status === 'accepted' ? 'Accepted' : 'Received'}</span>}
                <small>{sub(l)}. {clock(l.at)}{l.photo && <> <a href="#slip" onClick={(e) => { e.preventDefault(); void viewSlip(l.photo!); }}>View slip</a></>}</small></div>
                <div className="a">{net(l) === 0 ? '' : (net(l) > 0 ? '+' : '') + fmt(net(l))}</div></div>
            ))}</div></div>
        </div>
      </div>

      {sh && (
        <div className="pc-sheet"><div>
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{sh.k === 'bank' ? 'Deposit in bank' : sh.k === 'owner' ? 'Hand over to owner' : 'Exchange for change'}</h3>
          {sh.k === 'xchg' ? (
            <>
              <p className="pc-sub">Give notes to get smaller ones. The total you give must equal the total you get. Nothing can be added to the cash in hand without an exchange.</p>
              <table className="pc-t"><thead><tr><th>Note or coin</th><th>In hand</th><th>Giving out</th><th>Getting back</th></tr></thead><tbody>
                {DEN.map((d) => <tr key={d}><td>{'₹'}{d}</td><td>{st.hand[d] || 0}</td>
                  <td><input inputMode="numeric" value={sh.den[d] ?? ''} placeholder="0" onChange={(e) => setSheet({ ...sh, den: { ...sh.den, [d]: e.target.value.replace(/[^0-9]/g, '') } })} /></td>
                  <td><input inputMode="numeric" value={sh.get[d] ?? ''} placeholder="0" onChange={(e) => setSheet({ ...sh, get: { ...sh.get, [d]: e.target.value.replace(/[^0-9]/g, '') } })} /></td></tr>)}
                <tr className="t"><td>Total</td><td /><td>{fmt(tot(shDen))}</td><td>{fmt(tot(xGet))}</td></tr></tbody></table>
              {shOver.length > 0 ? <div className="pc-note">You do not have that many {shOver.map((d) => '₹' + d).join(', ')}.</div>
                : tot(shDen) + tot(xGet) > 0 && (tot(shDen) === tot(xGet) ? <div className="pc-note ok">Equal, {fmt(tot(shDen))} for {fmt(tot(xGet))}.</div> : <div className="pc-note">You give {fmt(tot(shDen))} but get {fmt(tot(xGet))}. They must be equal.</div>)}
            </>
          ) : (
            <>
              <p className="pc-sub">Enter the notes and coins you are taking out of the cash in hand.</p>
              <button className="btn" onClick={keepFloat}>Everything except tomorrow's {fmt(FLOAT)} float</button>
              <div style={{ marginTop: 8 }}>
                <table className="pc-t"><thead><tr><th>Note or coin</th><th>In hand</th><th>Taking out</th><th>Amount</th></tr></thead><tbody>
                  {DEN.map((d) => <tr key={d}><td>{'₹'}{d}</td><td>{st.hand[d] || 0}</td>
                    <td><input inputMode="numeric" value={sh.den[d] ?? ''} placeholder="0" onChange={(e) => setSheet({ ...sh, den: { ...sh.den, [d]: e.target.value.replace(/[^0-9]/g, '') } })} /></td><td>{fmt(d * (shDen[d] || 0))}</td></tr>)}
                  <tr className="t"><td>Total</td><td>{fmt(st.total)}</td><td /><td>{fmt(tot(shDen))}</td></tr></tbody></table>
              </div>
              {sh.k === 'bank' && (
                <>
                  <label className="pc-l">Bank slip number</label><input className="pc-in" value={sh.slip} placeholder="Slip number from the bank" onChange={(e) => setSheet({ ...sh, slip: e.target.value })} />
                  <label className="pc-l">Photo of the deposit slip</label>
                  <div className="pc-row"><label className="btn" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>{sh.photo ? 'Retake photo' : 'Take photo'}<input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => setSheet({ ...sh, photo: e.target.files?.[0] ?? null })} /></label>
                    {sh.photo ? <span className="pc-tag g">Photo added</span> : <span className="muted small">Required</span>}</div>
                </>
              )}
              {sh.k === 'owner' && <div className="pc-note info">It shows as waiting until the owner taps Received in Compass.</div>}
              {shOver.length > 0 && <div className="pc-note">You do not have that many {shOver.map((d) => '₹' + d).join(', ')}.</div>}
            </>
          )}
          <div className="pc-row" style={{ marginTop: 12, justifyContent: 'flex-end' }}><button className="btn" onClick={() => setSheet(null)}>Cancel</button><button className="btn primary" disabled={busy || !sOK} onClick={() => void confirmSheet()}>{sh.k === 'xchg' ? 'Confirm exchange' : 'Confirm'}</button></div>
        </div></div>
      )}
    </>
  );
}
