import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { useToast } from '../components/Toast';
import { DEN, fmt, has, num, sg, type CD } from './ClosingWizard';
import '../closing.css';

interface Rep {
  id: string; business_date: string; status: string; data: CD; pos_total: number | null; digital_var: number | null; cash_var: number | null; combined_var: number | null;
  closing_cash: number | null; submitted_at: string | null; reopen_reason: string | null; review_note: string | null; accounts_count: number | null;
  events: { at: string; by: string; what: string; note?: string }[];
}
const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'off' }, submitted: { label: 'Submitted', cls: 'due' }, reopen_requested: { label: 'Change requested', cls: 'late' },
  reopened: { label: 'Open for change', cls: 'due' }, verified: { label: 'Verified', cls: 'done' }, flagged: { label: 'Flagged', cls: 'late' }
};
const day = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const when = (t: string) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const vc = (v: number | null) => <span style={{ color: !v ? 'var(--ok)' : 'var(--warn)' }}>{v === null ? '-' : sg(Number(v))}</span>;

// Daily closing reports: Accounts, Management and the owner open each report, check it, and verify or flag it.
export function ClosingReports() {
  const { profile } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [rows, setRows] = useState<Rep[] | null>(null);
  const [open, setOpen] = useState<Rep | null>(null);
  const [acc, setAcc] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const canDo = profile?.role === 'owner' || profile?.role === 'manager';

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

  if (open) {
    const d = open.data;
    const st = STATUS[open.status] ?? { label: open.status, cls: 'off' };
    const reported = Number(open.closing_cash ?? 0);
    const accNum = acc === '' ? null : num(acc);
    const canReview = ['submitted', 'verified', 'flagged', 'reopen_requested'].includes(open.status);
    const line = (a: string, b: string) => <div className="cr-kv" key={a}><span>{a}</span><span>{b}</span></div>;
    const list = (a: Record<string, string>[] | undefined, f: (r: Record<string, string>) => string) => (a ?? []).map((r) => f(r)).join(' · ') || 'None';
    return (
      <>
        <div className="pagehead"><div><p className="label"><button className="btn quiet" style={{ padding: 0 }} onClick={() => setOpen(null)}>&#8592; All reports</button></p><h1>Closing for {day(open.business_date)} <span className={`chip ${st.cls}`}>{st.label}</span></h1></div></div>
        {open.status === 'reopen_requested' && (
          <div className="cw-note" style={{ marginBottom: 14, maxWidth: 560 }}>The closing staff asked to open this report for change. Reason: {open.reopen_reason || 'none given'}.
            {canDo || profile?.role === 'accounts' ? <> <button className="btn small" disabled={busy} onClick={reopen}>Allow the change</button></> : null}</div>
        )}
        <div className="cr-two">
          <div className="cr-panel">
            <h3 style={{ margin: '0 0 8px' }}>Report</h3>
            {line('POS total', fmt(Number(open.pos_total ?? 0)))}
            <div className="cr-kv"><span>Digital variance</span>{vc(open.digital_var)}</div>
            <div className="cr-kv"><span>Cash variance</span>{vc(open.cash_var)}</div>
            <div className="cr-kv"><span>Combined</span>{vc(open.combined_var)}</div>
            {line('Closing cash reported', fmt(reported))}
            {open.submitted_at && line('Submitted', when(open.submitted_at))}
            <h3 style={{ margin: '14px 0 8px' }}>Answers</h3>
            {line('Card / UPI / QR', `${fmt(num(d.card))} / ${fmt(num(d.upi))} / ${fmt(num(d.qr))}`)}
            {line('Cash / Online', `${fmt(num(d.cash))} / ${fmt(num(d.online))}`)}
            {line('Paytm collections', fmt(num(d.paytm)))}
            {line('Proximus EDC', d.edcYes ? list(d.edc, (r) => `${r.room || ''} ${fmt(num(r.amt))}`) : 'None')}
            {line('Opening cash', fmt(num(d.open)))}
            {line('Notes counted', DEN.filter((x) => has(d.n?.[x])).map((x) => `${x}×${d.n[x]}`).join('  ') || '-')}
            {line('Taken for expenses', fmt(num(d.withdrawn)) + (has(d.whyOut) ? ` (${d.whyOut})` : ''))}
            {line('Cash secured or deposited', d.secured ? 'Yes' : 'No')}
            {line('Room-charge bills', d.roomYes ? list(d.rooms, (r) => `${r.bill} Room ${r.room} ${fmt(num(r.amt))}`) : 'None')}
            {line('Customer due bills', d.dueYes ? list(d.dues, (r) => `${r.bill} ${r.name} ${fmt(num(r.amt))}`) : 'None')}
            {line('Older bills paid', d.oldYes ? list(d.olds, (r) => `${r.bill} ${fmt(num(r.amt))} ${r.method}`) : 'None')}
            {line('Note', d.noteYes ? d.note : 'None')}
          </div>
          <div className="cr-panel">
            <h3 style={{ margin: '0 0 8px' }}>Accounts check</h3>
            <label className="field"><span>Cash counted by Accounts</span><input className="num" inputMode="numeric" value={acc} onChange={(e) => setAcc(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" /></label>
            {accNum !== null && <p className="small" style={{ margin: '4px 0 10px' }}>{accNum === reported ? <span className="chip done">Matches the report</span> : <span className="chip due">{sg(accNum - reported)} against the report</span>}</p>}
            <label className="field"><span>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
            {canReview ? (
              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <button className="btn primary" disabled={busy} onClick={() => review('verified')}>Verify</button>
                <button className="btn" disabled={busy} onClick={() => review('flagged')}>Flag</button>
                {['submitted', 'flagged'].includes(open.status) && <button className="btn quiet" disabled={busy} onClick={reopen}>Open for change</button>}
              </div>
            ) : <p className="small muted">Nothing to check on this report yet.</p>}
            <h3 style={{ margin: '16px 0 6px' }}>Trail</h3>
            {open.events.length === 0 ? <p className="small muted">No activity yet.</p> : open.events.map((e, i) => <p className="small" style={{ margin: '2px 0' }} key={i}>{e.what} by {e.by}, {when(e.at)}{e.note ? `. ${e.note}` : ''}</p>)}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="pagehead">
        <div><p className="label">Money</p><h1>Daily closing</h1></div>
        {canDo && <button className="btn primary" onClick={() => nav('/closing-wizard')}>Do tonight's closing</button>}
      </div>
      <p className="muted">Each night's cash and POS check. Open a report to verify or flag it.</p>
      {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="muted">No closing reports yet.</p> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Business day</th><th className="num">POS total</th><th className="num">Digital</th><th className="num">Cash</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const st = STATUS[r.status] ?? { label: r.status, cls: 'off' };
                return (
                  <tr key={r.id} className="click" onClick={() => setOpen(r)}>
                    <td>{day(r.business_date)}<div className="small muted">{r.submitted_at ? `Submitted ${when(r.submitted_at)}` : 'Not submitted'}</div></td>
                    <td className="num">{r.pos_total === null ? '-' : fmt(Number(r.pos_total))}</td>
                    <td className="num">{vc(r.digital_var)}</td>
                    <td className="num">{vc(r.cash_var)}</td>
                    <td><span className={`chip ${st.cls}`}>{st.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
