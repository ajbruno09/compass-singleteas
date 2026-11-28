import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { useToast } from '../components/Toast';
import { DEN, calc, fmt, has, num, sg, type CD } from './ClosingWizard';
import '../closing.css';
import '../office.css';

interface Rep {
  id: string; business_date: string; status: string; data: CD; pos_total: number | null; digital_var: number | null; cash_var: number | null; combined_var: number | null;
  closing_cash: number | null; submitted_at: string | null; reopen_reason: string | null; review_note: string | null; accounts_count: number | null;
  events: { at: string; by: string; what: string; note?: string }[];
}
const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'off' }, submitted: { label: 'Submitted', cls: 'due' }, reopen_requested: { label: 'Change requested', cls: 'late' },
  reopened: { label: 'Open for change', cls: 'due' }, verified: { label: 'Verified', cls: 'done' }, flagged: { label: 'Flagged', cls: 'late' }
};
// Due before 2:00 AM the next day. Anything submitted after that is late.
const isLate = (r: { business_date: string; submitted_at: string | null }) => !!r.submitted_at && new Date(r.submitted_at).getTime() > new Date(r.business_date + 'T00:00:00+05:30').getTime() + 26 * 3600 * 1000;
const when = (t: string) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// Daily closing reports: Accounts, Management and the owner open each report, check it, and verify or flag it.
export function ClosingReports() {
  const { profile } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [earlier, setEarlier] = useState('');
  const [rows, setRows] = useState<Rep[] | null>(null);
  const [open, setOpen] = useState<Rep | null>(null);
  const [acc, setAcc] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [duty, setDuty] = useState(false);
  useEffect(() => { if (!profile) return; void supabase.from('duty_people').select('duty').eq('profile_id', profile.id).eq('duty', 'pos_closing').then(({ data }) => setDuty(!!data?.length)); }, [profile]);
  const canDo = profile?.role === 'owner' || profile?.role === 'manager' || duty;

  async function load() {
    const { data, error } = await supabase.rpc('closing_list', { p_limit: 60 });
    if (error) { toast('Could not load the reports'); setRows([]); return; }
    const list = (data as Rep[]) ?? [];
    setRows(list);
    setOpen((o) => (o ? list.find((x) => x.id === o.id) ?? null : null));
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { setAcc(open?.accounts_count != null ? String(open.accounts_count) : ''); setNote(open?.review_note ?? ''); }, [open?.id]);

  async function review(action: 'verified' | 'flagged') {
    if (!open) return;
    setBusy(true);
    const { error } = await supabase.rpc('closing_review', { p_id: open.id, p_action: action, p_note: note, p_count: acc === '' ? null : num(acc) });
    setBusy(false);
    if (error) { toast(error.message); return; }
    toast(action === 'verified' ? 'Verified' : 'Flagged');
    await load();
  }
  async function reopen() {
    if (!open) return;
    setBusy(true);
    const { error } = await supabase.rpc('closing_reopen', { p_id: open.id });
    setBusy(false);
    if (error) { toast(error.message); return; }
    toast('Opened for change');
    await load();
  }

  const [sp] = useSearchParams();
  const [filt, setFilt] = useState('All');
  const [sel, setSel] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => { if (rows && !sel) { const want = sp.get('d'); setSel((want && rows.find((r) => r.business_date === want)?.id) || rows[0]?.id || null); } }, [rows, sel, sp]);
  useEffect(() => { setReviewing(false); }, [sel]);

  const list = (rows ?? []).filter((r) => filt === 'All' || (filt === 'Pending' && ['submitted', 'reopen_requested', 'reopened'].includes(r.status)) || (filt === 'Flagged' && r.status === 'flagged') || (filt === 'Verified' && r.status === 'verified'));
  const cur = (rows ?? []).find((r) => r.id === sel) ?? null;
  const tag = (s: string) => { const m = STATUS[s] ?? { label: s, cls: 'off' }; return <span className={'of-tag ' + (s === 'verified' ? 'g' : s === 'flagged' ? 'r' : s === 'draft' ? 'n' : 'a')}>{s === 'submitted' ? 'Under review' : m.label}</span>; };
  const kv = (a: string, b: React.ReactNode, cls = '') => <div className={'of-kv ' + cls} key={a}><span>{a}</span><span>{b}</span></div>;
  const vv = (v: number | null) => <b className={v === null ? '' : v < 0 ? 'of-neg' : 'of-pos'}>{v === null ? '-' : sg(Number(v))}</b>;
  const lst = (a: Record<string, string>[] | undefined, f: (r: Record<string, string>) => string) => (a ?? []).map((r) => f(r)).join(' · ') || 'None';

  const renderDetail = (r: Rep) => {
    const d = r.data; const c = calc(d);
    const accNum = acc === '' ? null : num(acc);
    const match = accNum !== null && Math.round(accNum) === Math.round(c.counted);
    const canReview = ['submitted', 'flagged', 'reopen_requested'].includes(r.status);
    return (
      <div className="of-two" style={{ gridTemplateColumns: '1.25fr .75fr', alignItems: 'start' }}>
        <div>
          <div className="of-card"><h3>Closing report, {r.business_date} {tag(r.status)}{isLate(r) && <span className="of-tag a">Late</span>}</h3><p className="of-sub" style={{ margin: '2px 0 0' }}>{r.submitted_at ? `Submitted ${when(r.submitted_at)}` : 'Not submitted'}</p></div>
          {r.status === 'reopen_requested' && <div className="of-note">The closing staff asked to open this report for change. Reason: {r.reopen_reason || 'none given'}. <button className="btn small" disabled={busy} onClick={reopen}>Allow the change</button></div>}
          <div className="of-card"><h3>POS sales breakdown</h3>{kv('POS total sales', fmt(num(d.pos)))}{kv('Card sales', fmt(num(d.card)))}{kv('UPI / Paytm QR', fmt(num(d.upi)))}{kv('Petpooja static QR', fmt(num(d.qr)))}{kv('Cash sales', fmt(num(d.cash)))}{kv('Online platform sales', fmt(num(d.online)))}{kv('POS digital (card + UPI + QR)', fmt(c.digSales), 't')}</div>
          <div className="of-card"><h3>Digital collections</h3>{kv('Paytm merchant collections', fmt(num(d.paytm)))}{kv('Less: Proximus EDC', '-' + fmt(c.edc))}{kv('Net merchant collections', fmt(num(d.paytm) - c.edc))}{kv('Digital variance', vv(r.digital_var), 't')}</div>
          <div className="of-card"><h3>Cash reconciliation</h3>{kv('Opening cash', fmt(num(d.open)))}{kv('Counted closing cash', fmt(c.counted))}{kv('Taken for expenses', fmt(num(d.withdrawn)) + (has(d.whyOut) ? ` (${d.whyOut})` : ''))}{kv('Cash collected', fmt(c.coll))}{kv('POS cash sales', fmt(num(d.cash)))}{kv('Cash variance', vv(r.cash_var), 't')}{kv('Combined variance', vv(r.combined_var), 't')}
            {(r.digital_var ?? 0) * (r.cash_var ?? 0) < 0 && <div className="of-note">Opposite-direction variances. Possible payment mode mismatch.</div>}</div>
          <div className="of-card"><h3>Other answers</h3>{kv('Notes counted', DEN.filter((x) => has(d.n?.[x])).map((x) => `${x}×${d.n[x]}`).join('  ') || '-')}{kv('Cash secured or deposited', d.secured ? 'Yes' : 'No')}
            {kv('Proximus EDC', d.edcYes ? lst(d.edc, (x) => `${x.room || ''} ${fmt(num(x.amt))}`) : 'None')}{kv('Room-charge bills', d.roomYes ? lst(d.rooms, (x) => `${x.bill} Room ${x.room} ${fmt(num(x.amt))}`) : 'None')}
            {kv('Customer due bills', d.dueYes ? lst(d.dues, (x) => `${x.bill} ${x.name || ''} ${fmt(num(x.amt))}`) : 'None')}{kv('Older bills paid', d.oldYes ? lst(d.olds, (x) => `${x.bill} ${fmt(num(x.amt))} ${x.method}`) : 'None')}</div>
          {d.noteYes && has(d.note) && <div className="of-card"><h3>Closing user notes</h3><p style={{ margin: '6px 0 0' }}>{d.note}</p></div>}
        </div>
        <div>
          <div className="of-card"><h3>Accounts verification</h3>
            {r.status === 'verified' ? <div className="of-note ok">Verified.{r.accounts_count != null ? ` Counted ${fmt(Number(r.accounts_count))}.` : ''}{r.review_note ? ' ' + r.review_note : ''}</div>
              : !canReview ? <p className="of-sub">Nothing to check on this report yet.</p>
              : !reviewing ? <><p className="of-sub">{r.status === 'flagged' ? 'This report is flagged for management.' : 'This report is waiting for Accounts to check it.'}</p><button className="btn primary" style={{ width: '100%' }} onClick={() => setReviewing(true)}>Start review</button></>
              : <>
                <label className="of-l">Independent cash count (₹)</label><input className="of-in" inputMode="numeric" placeholder="0" value={acc} onChange={(e) => setAcc(e.target.value.replace(/[^0-9.]/g, ''))} />
                <p className="of-sub" style={{ margin: '4px 0 0' }}>Your own physical count, kept as the Accounts figure.</p>
                {accNum !== null && (match ? <div className="of-note ok">Matches the report, {fmt(c.counted)}.</div> : <div className="of-note">{fmt(accNum)} against {fmt(c.counted)} in the report. Difference {sg(accNum - c.counted)}.</div>)}
                <label className="of-l">Comment for management{accNum !== null && !match ? ' (needed when it does not match)' : ''}</label><textarea className="of-in" placeholder="Observations, notes for management review..." value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="of-row" style={{ marginTop: 10 }}>
                  <button className="btn primary" disabled={busy || accNum === null || (!match && !note.trim())} onClick={() => void review('verified')}>Verify</button>
                  <button className="btn" disabled={busy || !note.trim()} onClick={() => void review('flagged')}>Flag</button>
                  <button className="btn" onClick={() => setReviewing(false)}>Cancel</button></div></>}
          </div>
          <div className="of-card"><h3>Audit trail</h3><div className="of-trail"><p>Report submitted<small>{r.submitted_at ? when(r.submitted_at) : ''}</small></p>
            {r.events.filter((e) => e.what !== 'Submitted').map((e, i) => <p key={i}>{e.what}<small>{e.by} · {when(e.at)}{e.note ? ' · ' + e.note : ''}</small></p>)}</div></div>
        </div>
      </div>
    );
  };

  return (
    <div className="of">
      <div className="pagehead">
        <div><p className="label">Finance &amp; Accounts</p><h1>POS Daily Closing</h1><p className="muted" style={{ margin: '2px 0 0' }}>Check each night's closing, enter your own cash count, then verify or flag it.</p></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {profile?.role === 'owner' && <><input type="date" value={earlier} max={new Date(Date.now() - 86400000).toISOString().slice(0, 10)} onChange={(e) => setEarlier(e.target.value)} style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8 }} /><button className="btn" disabled={!earlier} onClick={() => nav('/closing-wizard?d=' + earlier)}>Close an earlier day</button></>}
          {canDo && <button className="btn primary" onClick={() => nav('/closing-wizard')}>Do tonight's closing</button>}
        </div>
      </div>
      {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="muted">No closing reports yet.</p> : (
        <div className="of-rep">
          <div className="of-card" style={{ padding: '10px 0' }}>
            <div style={{ padding: '0 12px' }}><h3>Closing reports</h3><div className="of-chips" style={{ marginTop: 8 }}>{['All', 'Pending', 'Flagged', 'Verified'].map((x) => <button key={x} className={'of-chip' + (filt === x ? ' on' : '')} onClick={() => setFilt(x)}>{x}</button>)}</div></div>
            <div className="of-rl">{list.map((r) => (
              <div key={r.id} className={'of-ri' + (r.id === sel ? ' on' : '')} onClick={() => setSel(r.id)}>
                <div className="t"><span>{r.business_date}</span>{tag(r.status)}</div>
                <small>{r.submitted_at ? `Submitted ${when(r.submitted_at)}` : 'Not submitted'}{isLate(r) ? ' · Late' : ''}</small>
                <div className="of-row" style={{ justifyContent: 'space-between' }}><b>{r.pos_total === null ? '-' : fmt(Number(r.pos_total))}</b><span className={r.combined_var === null ? '' : Number(r.combined_var) < 0 ? 'of-neg' : 'of-pos'}>{r.combined_var === null ? '' : sg(Number(r.combined_var)) + ' var'}</span></div>
              </div>))}
              {list.length === 0 && <p className="muted" style={{ padding: 12 }}>None.</p>}</div>
          </div>
          {cur && renderDetail(cur)}
        </div>
      )}
    </div>
  );
}
