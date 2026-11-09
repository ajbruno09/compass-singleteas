import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { errText } from '../lib/format';
import { useToast } from './Toast';

// Owner dashboard band: month to date sales, expenses, profit, break even. Fixed costs come from Monthly costs.
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const lk = (n: number) => (Math.abs(n) >= 100000 ? '₹' + (Math.round(n / 1000) / 100) + 'L' : inr(n));
const FACTOR: Record<string, number> = { monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
const FREQ: Record<string, string> = { monthly: 'Every month', quarterly: 'Every 3 months', yearly: 'Every year' };
// Running costs as a share of sales. Food cost waits for recipes, so it is an assumption for now.
const RUN = { food: 34.2, gas: 2.0, pack: 1.0 };

interface Cost { id: number; name: string; section: string; amount: number; frequency: string; to_verify: boolean; note: string | null; actual: number | null }
interface Day { d: string; status: string; net: number }
interface Mtd { month_start: string; dim: number; done: number; days: Day[]; pastries: number; staff_qty: number; costs: Cost[]; last_ingest: { received_at: string; result: string; message: string | null; report_date: string | null } | null }

interface LogRow { id: number; received_at: string; sender: string | null; filename: string | null; report_date: string | null; items: number | null; net_total: number | null; result: string; message: string | null; replaced: boolean }

const eff = (c: Cost) => (c.actual != null ? Number(c.actual) : Number(c.amount) * (FACTOR[c.frequency] ?? 1));

export function MonthToDate() {
  const toast = useToast();
  const [m, setM] = useState<Mtd | null>(null);
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<LogRow[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const loadLog = useCallback(async () => { const { data } = await supabase.rpc('pos_log'); setLog((data as LogRow[]) ?? []); }, []);
  useEffect(() => { void loadLog(); }, [loadLog]);
  async function upload(f: File) {
    setBusy(true);
    try {
      const buf = new Uint8Array(await f.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const { data: sess } = await supabase.auth.getSession();
      const r = await fetch((import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/pos-inbox', { method: 'POST', headers: { Authorization: 'Bearer ' + sess.session?.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: f.name, b64: btoa(bin) }) });
      const j = await r.json();
      if (j.ok) toast(`Loaded ${j.date}: ${inr(j.net)}${j.replaced ? ' (replaced the earlier one)' : ''}`); else toast(j.message ?? 'Could not read that file');
    } catch (e) { toast(errText(e)); } finally { setBusy(false); void load(); void loadLog(); }
  }
  const load = useCallback(async () => { const { data, error } = await supabase.rpc('owner_mtd'); if (!error) setM(data as Mtd); }, []);
  useEffect(() => { void load(); }, [load]);

  const c = useMemo(() => {
    if (!m) return null;
    const done = Math.max(m.done, 1); const dim = m.dim;
    const F = m.costs.reduce((a, x) => a + eff(x), 0);
    const open_ = m.days.filter((d) => d.status === 'open'); const closed = m.days.filter((d) => d.status === 'closed');
    const sales = open_.reduce((a, d) => a + Number(d.net), 0);
    const cakesPct = sales > 0 ? (Number(m.pastries) * 0.7 / sales) * 100 : 0;
    const vp = (RUN.food + RUN.gas + RUN.pack + cakesPct) / 100; const cm = 1 - vp;
    const BE = F / cm; const beTD = BE * done / dim; const gap = sales - beTD;
    const avgOpen = open_.length ? sales / open_.length : 0; const remaining = Math.max(dim - done, 0);
    const proj = sales + avgOpen * remaining;
    const mtdVar = sales * vp; const mtdFix = F * done / dim; const exp = mtdVar + mtdFix;
    const need = remaining > 0 ? Math.max(0, (BE - sales) / remaining) : 0;
    const have = new Set(m.days.map((d) => d.d));
    const missing: string[] = [];
    for (let i = 1; i <= done; i++) { const d = `${m.month_start.slice(0, 8)}${String(i).padStart(2, '0')}`; if (!have.has(d)) missing.push(d); }
    return { done, dim, F, BE, beTD, gap, sales, avgOpen, proj, mtdVar, mtdFix, exp, profit: sales - exp, need, remaining, vp, cm, cakes: Number(m.pastries) * 0.7, openDays: open_.length, closedDays: closed.length, missing, cakesPct };
  }, [m]);

  if (!m || !c) return null;
  const mon = new Date(m.month_start + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short' });
  const ok = c.gap >= 0;
  const noData = c.openDays === 0;

  // chart
  const W = 640, H = 230, l = 46, r = 14, t = 12, b = 26, pw = W - l - r, ph = H - t - b;
  const mx = Math.max(200000, Math.ceil(Math.max(c.BE, c.proj, c.sales) * 1.06 / 200000) * 200000);
  const X = (d: number) => l + d / c.dim * pw; const Y = (v: number) => t + ph - v / mx * ph;
  let run = 0; const pts = [`${X(0)},${Y(0)}`];
  for (let i = 1; i <= c.done; i++) { const d = `${m.month_start.slice(0, 8)}${String(i).padStart(2, '0')}`; run += Number(m.days.find((x) => x.d === d && x.status === 'open')?.net ?? 0); pts.push(`${X(i)},${Y(run)}`); }
  const gapCol = ok ? 'var(--good)' : 'var(--bad)';
  const grid = Array.from({ length: mx / 200000 + 1 }, (_, i) => 200000 * i).map((v) => <g key={v}><line x1={l} x2={W - r} y1={Y(v)} y2={Y(v)} stroke="var(--line)" /><text x={l - 6} y={Y(v) + 3} textAnchor="end">{v ? lk(v) : 0}</text></g>);

  const fl = [...m.costs].map((x) => [x.name, eff(x) * c.done / c.dim] as [string, number]).sort((a, b2) => b2[1] - a[1]);
  const pctOf = (v: number) => (c.sales > 0 ? (v / c.sales * 100).toFixed(1) + '%' : '—');
  const tiles: [string, string, string, string][] = [
    ['MTD sales', inr(c.sales), noData ? 'No sales report yet' : `${c.openDays} open days. Average ${inr(c.avgOpen)} a day`, ''],
    ['MTD expenses', inr(c.exp), `Running ${lk(c.mtdVar)} + fixed ${lk(c.mtdFix)}`, ''],
    [c.profit >= 0 ? 'MTD profit' : 'MTD loss', (c.profit < 0 ? '−' : '') + inr(Math.abs(c.profit)), c.sales > 0 ? (c.profit / c.sales * 100).toFixed(1) + '% of sales' : '', c.profit >= 0 ? 'up' : 'dn'],
    [ok ? 'Ahead of break even' : 'Shortage to break even', (ok ? '+' : '−') + inr(Math.abs(c.gap)), 'Break even to date ' + inr(c.beTD), ok ? 'up' : 'dn']];
  const needRows: [string, string][] = [
    ['Break even for the whole month', inr(c.BE)],
    [`Break even to date (${c.done} of ${c.dim} days)`, inr(c.beTD)],
    ['Sales so far', inr(c.sales)],
    [ok ? 'Ahead by' : 'Shortage so far', inr(Math.abs(c.gap))],
    ['Month end sales at this pace', lk(c.proj)],
    ['Needed a day for the rest of the month', `${inr(c.need)}${c.avgOpen ? ` (${c.need > c.avgOpen ? 'more' : 'less'} than the ${inr(c.avgOpen)} so far)` : ''}`]];

  async function closedDay(d: string) { const { error } = await supabase.rpc('mark_closed', { p_date: d, p_closed: true }); if (error) toast(errText(error)); else { toast('Marked as closed'); void load(); } }
  const pretty = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  return (
    <div className="sec mtd" id="mtd">
      <div className="mhead"><h2>Month to date: sales, expenses and break even</h2><button className="btn" onClick={() => setOpen(true)}>Monthly costs</button></div>
      <div className="grid four">
        {tiles.map((x) => (
          <div className="card big" key={x[0]}><div className="l"><span>{x[0]}</span><span className="chip att">Partial</span></div><div className={'v num ' + x[3]}>{x[1]}</div><div className={'d ' + (x[3] || 'mut')}>{x[2]}</div></div>
        ))}
      </div>
      {c.missing.length > 0 && (
        <div className="card mmiss"><div className="sm mut">No sales report for {c.missing.map(pretty).join(', ')}. Was the cafe shut? A report that arrives later fills the day in by itself.</div><div className="mbtns">{c.missing.map((d) => <button key={d} className="btn" onClick={() => closedDay(d)}>{pretty(d)}: we were closed</button>)}</div></div>
      )}
      <div className="grid two mrow">
        <div className="card"><div className="mrh"><h2>Sales against break even, this month</h2><span className={'chip ' + (ok ? 'ok' : 'crit')}>{ok ? 'Ahead of break even' : 'Behind break even'}</span></div>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%">
            {grid}
            {[1, 5, 10, 15, 20, 25, 30].filter((d) => d <= c.dim).map((d) => <text key={d} x={X(d)} y={H - 8} textAnchor="middle">{d}</text>)}
            <line x1={X(0)} y1={Y(0)} x2={X(c.dim)} y2={Y(c.BE)} stroke="var(--acc2)" strokeWidth="2" strokeDasharray="5 4" />
            <line x1={X(c.done)} y1={Y(c.sales)} x2={X(c.dim)} y2={Y(c.proj)} stroke="var(--acc)" strokeWidth="2" strokeDasharray="2 4" opacity=".7" />
            <polyline points={pts.join(' ')} fill="none" stroke="var(--acc)" strokeWidth="2.6" strokeLinejoin="round" />
            <line x1={X(c.done)} x2={X(c.done)} y1={Y(c.beTD)} y2={Y(c.sales)} stroke={gapCol} strokeWidth="5" strokeLinecap="round" />
            <circle cx={X(c.done)} cy={Y(c.sales)} r="4.5" fill="var(--acc)" />
            <text x={X(c.done) + 8} y={Y(c.sales) - 8} style={{ fill: 'var(--ink)' }}>{lk(c.sales)}</text>
            <text x={X(c.dim)} y={Y(c.BE) + (c.proj >= c.BE ? 26 : -8)} textAnchor="end" style={{ fill: 'var(--acc2)' }}>Break even {lk(c.BE)}</text>
            <text x={X(c.dim)} y={Y(c.proj) + (c.proj >= c.BE ? -8 : 26)} textAnchor="end">Month end at this pace {lk(c.proj)}</text>
          </svg>
          <div className="eq"><span><span style={{ color: 'var(--acc)' }}>━</span> Sales so far</span><span><span style={{ color: 'var(--acc2)' }}>╌╌</span> Break even path</span><span><span style={{ color: 'var(--acc)' }}>···</span> At this pace</span><span style={{ color: gapCol }}>▌ {ok ? 'Ahead' : 'Shortage'} {inr(Math.abs(c.gap))}</span></div>
        </div>
        <div className="card"><h2>What it takes to break even</h2><div style={{ marginTop: 8 }}>
          {needRows.map((x, i) => <div key={x[0]} className="nrow" style={i ? { borderTop: '1px solid var(--line)' } : undefined}><span className="mut sm">{x[0]}</span><span className="num" style={{ textAlign: 'right' }}>{x[1]}</span></div>)}
          <div className="note">{c.proj >= c.BE ? `At this pace the month ends above break even by ${lk(c.proj - c.BE)}.` : `At this pace the month ends ${lk(c.BE - c.proj)} short of break even.`}{c.closedDays > 0 ? ` ${c.closedDays} closed ${c.closedDays === 1 ? 'day' : 'days'} so far, and rent and salaries still ran on them.` : ''}</div>
        </div></div>
      </div>
      <div className="grid two mrow">
        <div className="card"><div className="mrh"><h2>Month to date expenses</h2><span className="sm mut">to {c.done} {mon}, {c.done} of {c.dim} days</span></div>
          <table><thead><tr><th>Where it went</th><th className="r">Amount</th><th className="r">% of sales</th></tr></thead><tbody>
            {([['Food cost', c.sales * RUN.food / 100], ['Gas', c.sales * RUN.gas / 100], ['Packaging', c.sales * RUN.pack / 100], ['Cakes By M, their 70%', c.cakes]] as [string, number][]).map((x) => <tr key={x[0]}><td>{x[0]} <span className="pill">running</span></td><td className="r num">{inr(x[1])}</td><td className="r num mut">{pctOf(x[1])}</td></tr>)}
            {fl.slice(0, 6).map((x) => <tr key={x[0]}><td>{x[0]} <span className="pill">fixed</span></td><td className="r num">{inr(x[1])}</td><td className="r num mut">{pctOf(x[1])}</td></tr>)}
            <tr><td className="mut">{Math.max(fl.length - 6, 0)} other fixed costs</td><td className="r num">{inr(fl.slice(6).reduce((a, x) => a + x[1], 0))}</td><td className="r num mut">{pctOf(fl.slice(6).reduce((a, x) => a + x[1], 0))}</td></tr>
            <tr className="tot"><td>All expenses to date</td><td className="r num">{inr(c.exp)}</td><td className="r num">{pctOf(c.exp)}</td></tr>
          </tbody></table>
        </div>
        <div className="card"><h2>How these are worked out</h2><div className="sm mut mhow">
          <div><b>Sales</b> are net of tax, from the nightly POS report, with container charges and round off included.</div>
          <div><b>Running costs</b> (food, gas, packaging) are assumptions of {RUN.food}%, {RUN.gas}% and {RUN.pack}% until recipes and gas weights feed in. Cakes By M is their real 70% of pastry sales.</div>
          <div><b>Fixed costs</b> (salary, rent, electricity and the rest) are spread evenly across the month.</div>
          <div><b>Break even</b> is the sales where what is left after running costs covers the fixed costs.</div>
          <div><b>Staff tea:</b> {Math.round(Number(m.staff_qty))} cups logged this month by the POS.</div>
          {m.last_ingest && <div><b>Last report:</b> {m.last_ingest.result}{m.last_ingest.report_date ? ` for ${pretty(m.last_ingest.report_date)}` : ''}.</div>}
        </div></div>
      </div>
      <div className="card mlog">
        <div className="mrh"><div><h2>Sales reports</h2><div className="sm mut">{log[0] ? `Last one: ${log[0].result}${log[0].report_date ? ' for ' + pretty(log[0].report_date) : ''}, ${new Date(log[0].received_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : 'The nightly POS email will show up here.'}</div></div>
          <div className="mbtns"><label className="btn p" style={{ cursor: 'pointer' }}>{busy ? 'Reading…' : "Upload a day's report"}<input type="file" accept=".xlsx,.xls" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} /></label><button className="btn" onClick={() => setShowLog(!showLog)}>{showLog ? 'Hide the log' : 'See the log'}</button></div></div>
        {showLog && <table style={{ marginTop: 8 }}><thead><tr><th>Arrived</th><th>From</th><th>File</th><th>Day</th><th className="r">Net sales</th><th>Result</th></tr></thead><tbody>
          {log.map((x) => <tr key={x.id}><td>{new Date(x.received_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td><td className="mut">{x.sender ?? ''}</td><td className="mut">{x.filename ?? ''}</td><td>{x.report_date ? pretty(x.report_date) : ''}</td><td className="r num">{x.net_total != null ? inr(Number(x.net_total)) : ''}</td><td><span className={'chip ' + (x.result === 'rejected' ? 'crit' : x.result === 'replaced' ? 'att' : 'ok')}>{x.result}</span>{x.message ? <div className="sm mut">{x.message}</div> : null}</td></tr>)}
          {!log.length && <tr><td colSpan={6} className="mut">Nothing yet.</td></tr>}
        </tbody></table>}
      </div>
      {open && <CostsSheet m={m} c={c} onClose={() => { setOpen(false); void load(); }} reload={load} />}
    </div>
  );
}

function CostsSheet({ m, c, onClose, reload }: { m: Mtd; c: { F: number; BE: number; dim: number }; onClose: () => void; reload: () => Promise<void> }) {
  const toast = useToast();
  const [form, setForm] = useState<{ id: number | null; name: string; section: string; amount: string; frequency: string; note: string } | null>(null);
  const sections = [...new Set(m.costs.map((x) => x.section))];
  async function setActual(id: number, v: string) { const { error } = await supabase.rpc('set_cost_actual', { p_cost: id, p_amount: v.trim() === '' ? null : Number(v) }); if (error) toast(errText(error)); else void reload(); }
  async function stop(id: number) { const { error } = await supabase.rpc('stop_cost', { p_id: id }); if (error) toast(errText(error)); else void reload(); }
  async function save() {
    if (!form || !form.name.trim() || !Number(form.amount)) { toast('Add a name and an amount'); return; }
    const { error } = await supabase.rpc('save_cost', { p_id: form.id, p_name: form.name.trim(), p_section: form.section || 'Running the cafe', p_amount: Number(form.amount), p_frequency: form.frequency, p_note: form.note });
    if (error) toast(errText(error)); else { setForm(null); void reload(); }
  }
  return (
    <div className="mback" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="msheet">
        <div className="mrh"><div><h2>Monthly costs</h2><div className="sm mut">Admin, Finance. Enter each cost once. A bill that changes gets this month's actual when it arrives.</div></div><div className="mbtns"><button className="btn p" onClick={() => setForm({ id: null, name: '', section: 'Running the cafe', amount: '', frequency: 'monthly', note: '' })}>+ Add a cost</button><button className="btn" onClick={onClose}>Close</button></div></div>
        <div className="eq" style={{ margin: '10px 0 4px' }}><span>Fixed costs this month</span><b className="num">{inr(c.F)} a month</b><span className="pill">{m.costs.filter((x) => x.actual == null).length} still on estimate</span><span className="pill">{m.costs.filter((x) => x.to_verify).length} to verify</span></div>
        <div className="mscroll"><table><thead><tr><th>Cost</th><th>How often</th><th className="r">Amount</th><th className="r">This month's actual</th><th className="r">Counts this month</th><th /></tr></thead><tbody>
          {sections.map((s) => [
            <tr className="grp" key={'g' + s}><td colSpan={6}>{s}</td></tr>,
            ...m.costs.filter((x) => x.section === s).map((x) => (
              <tr key={x.id}>
                <td>{x.name}{x.to_verify && <span className="chip att" style={{ marginLeft: 6 }}>To verify</span>}<div className="sm mut">{x.note}</div></td>
                <td className="mut">{FREQ[x.frequency]}</td>
                <td className="r num">{inr(x.amount)}</td>
                <td className="r"><input className="amt num" inputMode="decimal" placeholder="Not yet" defaultValue={x.actual ?? ''} onBlur={(e) => { if (e.target.value !== String(x.actual ?? '')) void setActual(x.id, e.target.value.replace(/[^0-9.]/g, '')); }} /></td>
                <td className="r num">{inr(eff(x))} <span className={'chip ' + (x.actual != null ? 'ok' : 'wait')}>{x.actual != null ? 'Actual' : 'Estimate'}</span></td>
                <td className="r"><button className="btn" onClick={() => setForm({ id: x.id, name: x.name, section: x.section, amount: String(x.amount), frequency: x.frequency, note: x.note ?? '' })}>Edit</button> <button className="btn" onClick={() => stop(x.id)}>Stop</button></td>
              </tr>))]).flat()}
        </tbody></table></div>
        <div className="note">Running costs (food, gas, packaging) come from the app and are not entered here. Break even is now {inr(c.BE)} a month, about {inr(c.BE / c.dim)} a day.</div>
        {form && (
          <div className="mback inner" onClick={(e) => { if (e.target === e.currentTarget) setForm(null); }}><div className="msheet small">
            <h2>{form.id ? 'Edit cost' : 'Add a cost'}</h2>
            <label className="mf"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="mf"><span>Group</span><select value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })}>{[...new Set([...sections, 'Running the cafe'])].map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="mf"><span>Amount</span><input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
            <label className="mf"><span>How often</span><select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}><option value="monthly">Every month</option><option value="quarterly">Every 3 months</option><option value="yearly">Every year</option></select></label>
            <label className="mf"><span>Note</span><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            <div className="mbtns" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn p" onClick={save}>Save</button></div>
          </div></div>
        )}
      </div>
    </div>
  );
}
