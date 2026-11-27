import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/Toast';
import { fmt, sg } from './ClosingWizard';
import '../office.css';

interface Recent { id: string; date: string; by: string | null; at: string | null; total: number | null; cash_var: number | null; digital_var: number | null; combined: number | null; status: string; late: boolean }
interface Dash {
  business_date: string;
  today: { total: number; cash: number; digital: number; online: number; cash_var: number; digital_var: number; combined: number } | null;
  flagged: number;
  trend: { date: string; total: number; combined: number; cash: number; digital: number; online: number }[];
  recent: Recent[];
  pipeline: { verified: number; review: number; flagged: number; draft: number; total: number };
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (s: string) => { const [, m, d] = s.split('-'); return `${+d} ${MON[+m - 1]}`; };
const long = (s: string) => { const [y, m, d] = s.split('-'); return `${+d} ${MON[+m - 1]} ${y}`; };
const when = (t: string) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const STAT: Record<string, { l: string; c: string }> = { submitted: { l: 'Under review', c: 'a' }, reopen_requested: { l: 'Change requested', c: 'a' }, reopened: { l: 'Open for change', c: 'a' }, verified: { l: 'Verified', c: 'g' }, flagged: { l: 'Flagged', c: 'r' } };
const vcls = (v: number | null) => (v === null ? '' : v < 0 ? 'of-neg' : 'of-pos');
const nice = (m: number) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(m, 1)))); const f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };

function Trend({ data }: { data: Dash['trend'] }) {
  const W = 520, H = 210, L = 48, B = 24, T = 10;
  const top = nice(Math.max(...data.map((r) => r.cash + r.digital + r.online), 1000)); const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const step = (W - L) / Math.max(data.length, 1), bw = Math.min(36, step * 0.7);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Seven day sales">
      {[0, 1, 2, 3, 4].map((i) => { const v = (top / 4) * i; return <g key={i}><line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--ink-3)">₹{Math.round(v / 1000)}k</text></g>; })}
      {data.map((r, i) => { const x = L + i * step + (step - bw) / 2; return (
        <g key={r.date}>
          <rect x={x} y={y(r.cash)} width={bw} height={y(0) - y(r.cash)} fill="var(--brand)"><title>{short(r.date)} cash {fmt(r.cash)}</title></rect>
          <rect x={x} y={y(r.cash + r.digital)} width={bw} height={y(r.cash) - y(r.cash + r.digital)} fill="#D98A1F"><title>{short(r.date)} digital {fmt(r.digital)}</title></rect>
          <rect x={x} y={y(r.cash + r.digital + r.online)} width={bw} height={y(r.cash + r.digital) - y(r.cash + r.digital + r.online)} fill="#C9A227"><title>{short(r.date)} online {fmt(r.online)}</title></rect>
          <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--ink-3)">{short(r.date)}</text>
        </g>); })}
    </svg>
  );
}
function Variance({ data }: { data: Dash['trend'] }) {
  const W = 520, H = 210, L = 48, B = 24, T = 10;
  const hi = nice(Math.max(...data.map((r) => r.combined ?? 0), 100)), lo = -nice(Math.max(...data.map((r) => -(r.combined ?? 0)), 100));
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo)); const step = (W - L) / Math.max(data.length, 1), bw = Math.min(36, step * 0.7);
  const ticks = [lo, lo / 2, 0, hi / 2, hi];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Daily combined variance">
      {ticks.map((v, i) => <g key={i}><line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--ink-3)' : 'var(--line)'} /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--ink-3)">{v < 0 ? '-' : ''}₹{Math.abs(Math.round(v))}</text></g>)}
      {data.map((r, i) => { const x = L + i * step + (step - bw) / 2, v = r.combined ?? 0, y0 = y(0), y1 = y(v); return (
        <g key={r.date}><rect x={x} y={Math.min(y0, y1)} width={bw} height={Math.max(2, Math.abs(y0 - y1))} fill={v < 0 ? 'var(--bad)' : 'var(--brand)'}><title>{short(r.date)} {sg(v)}</title></rect>
          <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--ink-3)">{short(r.date)}</text></g>); })}
    </svg>
  );
}

// POS Dashboard: today's closing, trends, recent reports, and where each report stands. Owner only.
export function PosDashboard() {
  const toast = useToast();
  const nav = useNavigate();
  const [d, setD] = useState<Dash | null>(null);
  useEffect(() => { void supabase.rpc('pos_dashboard').then(({ data, error }) => { if (error) { toast('Could not load the dashboard'); return; } setD(data as Dash); }); }, [toast]);
  if (!d) return <p className="muted">Loading…</p>;
  const t = d.today;
  const tile = (k: string, v: string | null, n: string, go?: () => void) => {
    const inner = <><div className="k">{k}</div><div className={'v' + (v === null ? ' none' : '')}>{v ?? 'No report yet'}</div><div className="n">{n}</div></>;
    return go ? <button className="of-tile" onClick={go}>{inner}</button> : <div className="of-tile">{inner}</div>;
  };
  const opp = t && t.cash_var !== 0 && t.digital_var !== 0 && (t.cash_var > 0) !== (t.digital_var > 0);
  return (
    <div className="of">
      <div className="pagehead"><div><p className="label">Finance &amp; Accounts</p><h1>POS Dashboard</h1><p className="muted" style={{ margin: '2px 0 0' }}>Business date <b>{long(d.business_date)}</b> · Updated {new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</p></div></div>
      <div className="of-tiles">
        <div className="of-tile big"><div className="k">Today's total sales</div><div className={'v' + (t ? '' : ' none')} style={t ? undefined : { fontSize: 26 }}>{t ? fmt(t.total) : 'No report yet'}</div><div className="n">{t ? 'Closing submitted for this business date' : 'Closing not yet submitted. Due before 2:00 AM.'}</div></div>
        {tile('POS cash sales', t ? fmt(t.cash) : null, t ? 'From the closing report' : 'No data')}
        {tile('Digital collections', t ? fmt(t.digital) : null, t ? 'Card, UPI and QR sales' : 'No data')}
        {tile('Online platform sales', t ? fmt(t.online) : null, 'Swiggy + Zomato, left out of the check')}
        {tile('Combined variance', t ? sg(t.combined) : null, t ? 'Digital and cash together' : 'No data')}
        {tile('Flagged reports', String(d.flagged), d.flagged ? 'Tap to open them' : 'No flagged reports', d.flagged ? () => nav('/closing-reports') : undefined)}
      </div>
      {opp && <div className="of-note" style={{ marginTop: 0, marginBottom: 14 }}>Today's digital and cash variances run in opposite directions. Possible payment mode mismatch.</div>}
      <div className="of-two">
        <div className="of-card"><h3>7-day sales trend</h3><div className="of-leg"><span><i style={{ background: 'var(--brand)' }} />Cash</span><span><i style={{ background: '#D98A1F' }} />Digital</span><span><i style={{ background: '#C9A227' }} />Online</span></div>{d.trend.length ? <Trend data={d.trend} /> : <p className="muted">No closings yet.</p>}</div>
        <div className="of-card"><h3>Daily combined variance</h3><p className="of-sub" style={{ margin: '2px 0 4px' }}>Positive means excess. Negative means shortage.</p>{d.trend.length ? <Variance data={d.trend} /> : <p className="muted">No closings yet.</p>}</div>
      </div>
      <div className="of-card"><h3>Recent closing reports <button className="btn small" onClick={() => nav('/closing-reports')}>View all</button></h3>
        {d.recent.length === 0 ? <p className="muted">No closing reports yet.</p> : (
          <div className="of-wx"><table className="of-t"><thead><tr><th>Business date</th><th>Submitted by</th><th>Time</th><th className="r">Total sales</th><th className="r">Cash var.</th><th className="r">Digital var.</th><th className="r">Combined</th><th>Status</th></tr></thead><tbody>
            {d.recent.map((r) => { const s = STAT[r.status] ?? { l: r.status, c: 'n' }; return (
              <tr key={r.id} className="click" onClick={() => nav('/closing-reports?d=' + r.date)}><td>{long(r.date)}</td><td>{r.by ?? '-'}</td><td>{r.at ? when(r.at) : '-'}</td><td className="r">{fmt(Number(r.total ?? 0))}</td>
                <td className={'r ' + vcls(r.cash_var)}>{r.cash_var === null ? '-' : sg(Number(r.cash_var))}</td><td className={'r ' + vcls(r.digital_var)}>{r.digital_var === null ? '-' : sg(Number(r.digital_var))}</td><td className={'r ' + vcls(r.combined)}>{r.combined === null ? '-' : sg(Number(r.combined))}</td>
                <td><span className={'of-tag ' + s.c}>{s.l}</span>{r.late && <span className="of-tag a" style={{ marginLeft: 6 }}>Late</span>}</td></tr>); })}
          </tbody></table></div>)}
      </div>
      <div className="of-card"><h3>Verification pipeline <span className="of-tag n">This month · {d.pipeline.total} reports</span></h3>
        <div className="of-pipe"><div><b>{d.pipeline.verified}</b>Verified</div><div><b>{d.pipeline.review}</b>Under review</div><div><b>{d.pipeline.flagged}</b>Flagged</div><div><b>{d.pipeline.draft}</b>Draft</div></div></div>
    </div>
  );
}
