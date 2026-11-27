import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { useToast } from '../components/Toast';
import { isPhone } from './Install';
import '../closing.css';

// Daily closing wizard: 25 questions, one per screen. Moved from the separate Daily Closing app. Same questions, order and rules.
export const DEN = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const;
export const OPEN_BILLS = ['Unmatched (no bill found)'];

type Row = Record<string, string>;
export interface CD {
  pos: string; card: string; upi: string; qr: string; cash: string; online: string; paytm: string;
  edcYes: boolean | null; edc: Row[]; open: string; n: Record<string, string>;
  withdrawn: string; whyOut: string; secured: boolean | null;
  roomYes: boolean | null; rooms: Row[]; dueYes: boolean | null; dues: Row[]; oldYes: boolean | null; olds: Row[];
  noteYes: boolean | null; note: string;
}
const blank = (): CD => ({ pos: '', card: '', upi: '', qr: '', cash: '', online: '', paytm: '', edcYes: null, edc: [], open: '', n: {}, withdrawn: '', whyOut: '', secured: null, roomYes: null, rooms: [], dueYes: null, dues: [], oldYes: null, olds: [], noteYes: null, note: '' });

export const num = (v: unknown) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; };
export const has = (v: unknown) => String(v ?? '').trim() !== '';
export const fmt = (n: number) => (n < 0 ? '-' : '') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
export const sg = (n: number) => (n === 0 ? '₹0' : (n > 0 ? '+' : '-') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN'));
const sum = (a: Row[], k: string) => a.reduce((t, r) => t + num(r[k]), 0);

export function calc(d: CD) {
  const six = num(d.card) + num(d.upi) + num(d.qr) + num(d.cash) + num(d.online);
  const digSales = num(d.card) + num(d.upi) + num(d.qr);
  const edc = d.edcYes ? sum(d.edc, 'amt') : 0;
  const dig = num(d.paytm) - edc - digSales;
  const counted = DEN.reduce((t, x) => t + x * num(d.n[x]), 0);
  const closing = counted + num(d.withdrawn);
  const oldCash = d.oldYes ? d.olds.filter((r) => r.method === 'Cash').reduce((t, r) => t + num(r.amt), 0) : 0;
  const coll = closing - num(d.open) - oldCash;
  const cv = coll - num(d.cash);
  const gap = num(d.pos) - six;
  return { six, digSales, edc, dig, counted, closing, oldCash, coll, cv, comb: dig + cv, gap, opp: dig !== 0 && cv !== 0 && (dig > 0) !== (cv > 0) };
}

interface Col { k: string; l: string; ty: 'text' | 'num' | 'date' | 'bill' | 'method' }
type Step =
  | { t: 'money'; key: keyof CD; q: string; hint: string; extra?: 'split' | 'out' }
  | { t: 'count'; d: number; q: string; hint: string }
  | { t: 'yn'; key: 'secured'; q: string; hint: string }
  | { t: 'rows'; key: 'edc' | 'rooms' | 'dues' | 'olds'; yes: 'edcYes' | 'roomYes' | 'dueYes' | 'oldYes'; q: string; hint: string; cols: Col[] }
  | { t: 'notes'; q: string; hint: string }
  | { t: 'review' };

const STEPS: (Step | null)[] = [null,
  { t: 'money', key: 'pos', q: 'POS total sales', hint: 'Grand total from Petpooja.' },
  { t: 'money', key: 'card', q: 'Card sales', hint: 'Card sales as shown in Petpooja.', extra: 'split' },
  { t: 'money', key: 'upi', q: 'UPI / Paytm sales', hint: 'UPI and Paytm sales as shown in Petpooja.', extra: 'split' },
  { t: 'money', key: 'qr', q: 'Petpooja static QR sales', hint: 'Static QR sales as shown in Petpooja.', extra: 'split' },
  { t: 'money', key: 'cash', q: 'Cash sales', hint: 'Cash sales as shown in Petpooja.', extra: 'split' },
  { t: 'money', key: 'online', q: 'Online sales (Swiggy, Zomato)', hint: 'Online sales as shown in Petpooja.', extra: 'split' },
  { t: 'money', key: 'paytm', q: 'Paytm merchant collections', hint: 'Total collected, from the Paytm dashboard (not from Petpooja).' },
  { t: 'rows', key: 'edc', yes: 'edcYes', q: 'Did Proximus hotel guests use the Single Teas EDC today?', hint: "Add one row for each transaction. These are taken out of today's digital collections.",
    cols: [{ k: 'date', l: 'Date', ty: 'date' }, { k: 'ref', l: 'Reference', ty: 'text' }, { k: 'room', l: 'Room', ty: 'text' }, { k: 'amt', l: 'Amount', ty: 'num' }] },
  { t: 'money', key: 'open', q: 'POS opening cash (float)', hint: 'Cash kept in the drawer at the start of the day.' },
  ...DEN.map((d) => ({ t: 'count' as const, d, q: `How many ₹${d} ${d >= 10 ? 'notes' : 'coins'}?`, hint: 'Count only, not the amount.' })),
  { t: 'money', key: 'withdrawn', q: 'Any cash taken from the drawer for expenses?', hint: 'Cash taken out of the drawer for expenses today. Enter 0 if none.', extra: 'out' },
  { t: 'yn', key: 'secured', q: 'Is the cash secured or deposited?', hint: 'Choose Yes once the cash is locked away or deposited.' },
  { t: 'rows', key: 'rooms', yes: 'roomYes', q: 'Any pending Proximus room-charge bills?', hint: 'These go into the Outstanding Bills register.',
    cols: [{ k: 'bill', l: 'Bill number', ty: 'text' }, { k: 'room', l: 'Room', ty: 'text' }, { k: 'amt', l: 'Amount', ty: 'num' }] },
  { t: 'rows', key: 'dues', yes: 'dueYes', q: 'Any customer DUE bills outstanding?', hint: 'Bills the customer will pay later.',
    cols: [{ k: 'bill', l: 'Bill number', ty: 'text' }, { k: 'amt', l: 'Amount', ty: 'num' }, { k: 'name', l: 'Customer name', ty: 'text' }, { k: 'phone', l: 'Phone', ty: 'text' }, { k: 'why', l: 'Reason for credit', ty: 'text' }] },
  { t: 'rows', key: 'olds', yes: 'oldYes', q: 'Any payments received against older outstanding bills?', hint: "Cash taken in for older bills is taken out of today's cash before checking.",
    cols: [{ k: 'bill', l: 'Bill', ty: 'bill' }, { k: 'amt', l: 'Amount', ty: 'num' }, { k: 'method', l: 'Paid by', ty: 'method' }] },
  { t: 'notes', q: 'Any notes or discrepancies?', hint: 'Tell Accounts anything they should know about today.' },
  { t: 'review' }
];
const TOTAL = 25;

function valid(d: CD, n: number): boolean {
  const s = STEPS[n]; if (!s) return false;
  const c = calc(d);
  if (s.t === 'money') {
    if (!has(d[s.key])) return false;
    if (s.key === 'online') return c.gap > -0.5;
    if (s.key === 'withdrawn' && num(d.withdrawn) > 0 && !has(d.whyOut)) return false;
    return true;
  }
  if (s.t === 'count') return has(d.n[s.d]);
  if (s.t === 'yn') return d[s.key] !== null;
  if (s.t === 'rows') {
    const y = d[s.yes]; if (y === null) return false;
    if (s.key === 'dues' && c.gap > 0.5 && !y) return false;
    if (!y) return true;
    const a = d[s.key]; return a.length > 0 && a.every((r) => s.cols.every((cl) => has(r[cl.k])));
  }
  if (s.t === 'notes') return d.noteYes !== null && (!d.noteYes || has(d.note));
  return true;
}

type Status = 'none' | 'draft' | 'submitted' | 'reopen_requested' | 'reopened' | 'verified' | 'flagged';

export function ClosingWizard() {
  const { profile } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [d, setD] = useState<CD>(blank());
  const [step, setStep] = useState(0);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<Status>('none');
  const [loaded, setLoaded] = useState(false);
  const [sheet, setSheet] = useState<'submit' | 'reopen' | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [bd, setBd] = useState('');
  const [res, setRes] = useState<{ digital: number; cash: number; combined: number } | null>(null);
  const [closed, setClosed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  const isStaff = profile?.role === 'closing_staff';
  const [openBills, setOpenBills] = useState<OpenBill[]>([]);
  useEffect(() => { void supabase.rpc('bills_open').then(({ data, error }) => { if (!error && Array.isArray(data)) setOpenBills(data as OpenBill[]); }); }, []);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('closing_today');
      if (error) { toast('Could not load. Please try again.'); setLoaded(true); return; }
      const j = data as { business_date: string; row: { status: Status; data: Partial<CD>; digital: number; cash: number; combined: number } | null };
      setBd(j.business_date);
      if (j.row) {
        setStatus(j.row.status);
        setD({ ...blank(), ...(j.row.data as Partial<CD>) });
        if (j.row.status === 'reopened') setStep(25);
        if (j.row.digital !== null) setRes({ digital: Number(j.row.digital), cash: Number(j.row.cash), combined: Number(j.row.combined) });
      }
      // Opening cash (question 9) comes from the petty cash float the opening staff accepted today.
      if (!j.row || ['draft', 'reopened'].includes(j.row.status)) {
        const f = await supabase.rpc('petty_float_today');
        const amt = Number(f.data);
        if (!f.error && amt > 0) setD((x) => (String(x.open ?? '').trim() === '' ? { ...x, open: String(amt) } : x));
      }
      setLoaded(true);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draft saves as you go.
  const change = (fn: (x: CD) => CD) => {
    setD((x) => fn(x));
    dirty.current = true;
  };
  useEffect(() => {
    if (!dirty.current || (status !== 'none' && status !== 'draft' && status !== 'reopened')) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const { error } = await supabase.rpc('closing_save', { p_data: d });
      if (!error && status === 'none') setStatus('draft');
      dirty.current = false;
    }, 700);
    return () => window.clearTimeout(timer.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  const c = useMemo(() => calc(d), [d]);
  const dateLabel = bd ? new Date(bd + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) : '';

  async function submit() {
    setBusy(true);
    const { data, error } = await supabase.rpc('closing_submit', { p_data: d });
    setBusy(false);
    if (error) { toast(error.message); return; }
    setRes(data as typeof res);
    setStatus('submitted'); setSheet(null); dirty.current = false;
  }
  async function reopen() {
    setBusy(true);
    const { error } = await supabase.rpc('closing_request_reopen', { p_reason: why });
    setBusy(false);
    if (error) { toast(error.message); return; }
    setStatus('reopen_requested'); setSheet(null); setWhy('');
    toast('Sent. Waiting for approval.');
  }

  if (isPhone() && profile?.role !== 'owner' && profile?.role !== 'manager') {
    return <div className="cw"><div className="cw-card"><div className="cw-body cw-center"><div className="cw-q">Please use the POS computer</div><p className="cw-hint">The daily closing is done on the POS computer only.</p><button className="cw-btn" onClick={() => nav('/')}>Back</button></div></div></div>;
  }
  if (!loaded) return <div className="cw"><div className="cw-card"><p className="muted" style={{ padding: 20 }}>Loading…</p></div></div>;

  const locked = status === 'submitted' || status === 'reopen_requested' || status === 'verified' || status === 'flagged';

  if (closed) {
    return <div className="cw"><div className="cw-card"><div className="cw-body cw-center"><div className="cw-tick">&#10003;</div><div className="cw-q">All done</div><p className="cw-hint">Thank you. You can close this window now.</p></div></div></div>;
  }

  if (locked) {
    const r = res ?? { digital: 0, cash: 0, combined: 0 };
    return (
      <div className="cw"><div className="cw-card">
        <div className="cw-head"><div className="cw-row"><div className="cw-t">Daily closing</div><span className="cw-s">{profile?.full_name}</span></div></div>
        <div className="cw-body cw-center">
          <div className="cw-tick">&#10003;</div>
          <div className="cw-q">Report submitted</div>
          <p className="cw-hint">{status === 'reopen_requested' ? 'You asked to open it for change. It will open once a manager approves.' : `Your closing for ${dateLabel} is locked and sent to Accounts and Management.`}</p>
          <div className="cw-box" style={{ textAlign: 'left' }}>
            <div className="cw-l"><span>Digital variance</span><span>{sg(r.digital)}</span></div>
            <div className="cw-l"><span>Cash variance</span><span>{sg(r.cash)}</span></div>
            <div className="cw-l cw-tot"><span>Combined</span><span>{sg(r.combined)}</span></div>
          </div>
        </div>
        <div className="cw-foot">
          {status === 'submitted' && <button className="cw-btn" onClick={() => setSheet('reopen')}>Ask to open for change</button>}
          <button className="cw-btn cw-p" onClick={() => (isStaff ? setClosed(true) : nav('/closing-reports'))}>Close</button>
        </div>
        {sheet === 'reopen' && (
          <div className="cw-sheet"><div>
            <div className="cw-q" style={{ fontSize: 17 }}>Ask to open for change</div>
            <p className="cw-hint">Tell the manager what needs to change. The report opens once they approve.</p>
            <textarea className="cw-ta" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="What needs to change?" />
            <div className="cw-row" style={{ gap: 10, marginTop: 12 }}><button className="cw-btn" onClick={() => setSheet(null)}>Cancel</button><button className="cw-btn cw-p" disabled={!has(why) || busy} onClick={reopen}>Send request</button></div>
          </div></div>
        )}
      </div></div>
    );
  }

  if (step === 0) {
    const started = status === 'draft' || has(d.pos);
    return (
      <div className="cw"><div className="cw-card">
        <div className="cw-head"><div className="cw-row"><div className="cw-t">Daily closing</div><span className="cw-s">{profile?.full_name}</span></div></div>
        <div className="cw-body">
          <p className="cw-hint" style={{ margin: '0 0 12px' }}>Good evening, {(profile?.full_name ?? '').split(' ')[0]}.</p>
          <div className="cw-home">
            <div className="cw-row" style={{ justifyContent: 'space-between' }}><b>Daily closing</b><span className={'cw-tag ' + (started ? 'a' : 'n')}>{started ? 'Draft saved' : 'Not started'}</span></div>
            <p className="cw-hint" style={{ margin: '6px 0 12px' }}>{dateLabel}. 25 short questions, one at a time. Your answers save as you go, so you can stop and carry on later.</p>
            <button className="cw-btn cw-p" style={{ width: '100%' }} onClick={() => setStep(1)}>{started ? 'Continue closing' : 'Start closing'}</button>
          </div>
        </div>
      </div></div>
    );
  }

  const s = STEPS[step]!;
  const ok = valid(d, step);
  const next = () => { if (editing) { setEditing(false); setStep(25); } else setStep(step + 1); };
  const back = () => { if (editing) { setEditing(false); setStep(25); } else setStep(step - 1); };

  return (
    <div className="cw"><div className="cw-card">
      <div className="cw-head">
        <div className="cw-row"><button className="cw-back" onClick={back} aria-label="Back">&#8592;</button><div className="cw-t">Daily closing</div><span className="cw-s">Draft saved</span></div>
        <div className="cw-s" style={{ marginTop: 8 }}>{s.t === 'review' ? 'Review' : `Question ${step} of ${TOTAL}`}</div>
        <div className="cw-bar"><i style={{ width: `${(step / TOTAL) * 100}%` }} /></div>
      </div>
      <div className="cw-body">
        {s.t === 'review' ? <Review d={d} c={c} go={(n) => { setStep(n); setEditing(true); }} /> : <Question key={step} s={s} d={d} c={c} step={step} change={change} next={() => ok && next()} bills={openBills} />}
      </div>
      <div className="cw-foot">
        {s.t === 'review' ? <button className="cw-btn cw-p" onClick={() => setSheet('submit')}>Submit report</button> : <button className="cw-btn cw-p" disabled={!ok} onClick={next}>{editing ? 'Back to review' : 'Next'}</button>}
      </div>
      {sheet === 'submit' && (
        <div className="cw-sheet"><div>
          <div className="cw-q" style={{ fontSize: 17 }}>Submit this report?</div>
          <p className="cw-hint">After you submit, the report is locked and goes to Accounts and Management. To change it you must ask for it to be opened.</p>
          <div className="cw-row" style={{ gap: 10 }}><button className="cw-btn" onClick={() => setSheet(null)}>Go back</button><button className="cw-btn cw-p" disabled={busy} onClick={submit}>Yes, submit</button></div>
        </div></div>
      )}
    </div></div>
  );
}

function Money({ v, onChange, onEnter }: { v: string; onChange: (s: string) => void; onEnter: () => void }) {
  return <div className="cw-field"><span>{'₹'}</span><input autoFocus inputMode="decimal" value={v} placeholder="0" onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }} /></div>;
}

function Question({ s, d, c, step, change, next, bills }: { s: Exclude<Step, { t: 'review' }>; d: CD; c: ReturnType<typeof calc>; step: number; change: (f: (x: CD) => CD) => void; next: () => void; bills: OpenBill[] }) {
  const yn = (v: boolean | null, set: (y: boolean) => void) => (
    <div className="cw-yn"><button className={v === true ? 'on' : ''} onClick={() => set(true)}>Yes</button><button className={v === false ? 'on' : ''} onClick={() => set(false)}>No</button></div>
  );
  return (
    <>
      <div className="cw-q">{s.q}</div>
      <p className="cw-hint">{s.hint}</p>
      {s.t === 'money' && (
        <>
          <Money v={String(d[s.key] ?? '')} onChange={(x) => change((p) => ({ ...p, [s.key]: x }))} onEnter={next} />
          {s.extra === 'split' && <SplitBox d={d} c={c} last={step === 6} />}
          {s.extra === 'out' && (
            <>
              {num(d.withdrawn) > 0 && (<><label className="cw-lab" style={{ marginTop: 14 }}>What was it for?</label><input className="cw-in" value={d.whyOut} placeholder="Reason for the expense" onChange={(e) => change((p) => ({ ...p, whyOut: e.target.value }))} /></>)}
              <div className="cw-box"><div className="cw-l"><span>Total counted cash</span><span>{fmt(c.counted)}</span></div><div className="cw-l"><span>Taken for expenses</span><span>{fmt(num(d.withdrawn))}</span></div><div className="cw-l cw-tot"><span>Closing cash</span><span>{fmt(c.closing)}</span></div></div>
            </>
          )}
        </>
      )}
      {s.t === 'count' && (
        <>
          <div className="cw-cnt"><div className="cw-field" style={{ flex: 1 }}><input autoFocus inputMode="numeric" value={d.n[s.d] ?? ''} placeholder="0" onChange={(e) => change((p) => ({ ...p, n: { ...p.n, [s.d]: e.target.value.replace(/[^0-9]/g, '') } }))} onKeyDown={(e) => { if (e.key === 'Enter') next(); }} /></div><div className="cw-x">&times; {'₹'}{s.d}</div></div>
          <div className="cw-box"><div className="cw-l"><span>This is</span><span>{fmt(s.d * num(d.n[s.d]))}</span></div></div>
        </>
      )}
      {s.t === 'yn' && (
        <>
          {yn(d.secured, (y) => change((p) => ({ ...p, secured: y })))}
          {d.secured && (
            <>
              <p className="cw-hint" style={{ margin: '16px 0 8px' }}>This is the cash you counted. Change a count only if it is different. Otherwise just tap Next.</p>
              <div className="cw-sec">
                {DEN.map((x) => (
                  <div key={x} className="cw-den"><span>{'₹'}{x} &times;</span><input inputMode="numeric" value={d.n[x] ?? ''} onChange={(e) => change((p) => ({ ...p, n: { ...p.n, [x]: e.target.value.replace(/[^0-9]/g, '') } }))} /><span className="cw-r">{fmt(x * num(d.n[x]))}</span></div>
                ))}
                <div className="cw-den cw-tot"><span>Total secured</span><span /><span className="cw-r">{fmt(c.counted)}</span></div>
              </div>
            </>
          )}
        </>
      )}
      {s.t === 'rows' && (
        <>
          {s.key === 'dues' && c.gap > 0.5 && <DueBox gap={c.gap} e={sum(d.dues, 'amt')} />}
          {yn(d[s.yes], (y) => change((p) => ({ ...p, [s.yes]: y, [s.key]: y ? (p[s.key].length ? p[s.key] : [{}]) : [] })))}
          {d[s.yes] && <Rows s={s} bills={bills} rows={d[s.key]} set={(rows) => change((p) => ({ ...p, [s.key]: rows, ...(rows.length ? {} : { [s.yes]: null }) }))} />}
        </>
      )}
      {s.t === 'notes' && (
        <>
          {yn(d.noteYes, (y) => change((p) => ({ ...p, noteYes: y, note: y ? p.note : '' })))}
          {d.noteYes && <textarea className="cw-ta" placeholder="Write your note here" value={d.note} onChange={(e) => change((p) => ({ ...p, note: e.target.value }))} />}
        </>
      )}
    </>
  );
}

function SplitBox({ d, c, last }: { d: CD; c: ReturnType<typeof calc>; last: boolean }) {
  const ok = Math.abs(c.gap) < 0.5;
  return (
    <div className="cw-box">
      <div className="cw-l"><span>Questions 2 to 6 added up</span><span>{fmt(c.six)}</span></div>
      <div className="cw-l"><span>POS total (question 1)</span><span>{fmt(num(d.pos))}</span></div>
      <div className="cw-l cw-tot"><span>{ok ? 'Matches' : c.gap > 0 ? 'Not paid yet' : 'Over'}</span><span>{ok ? <span className="cw-tag g">Matches</span> : <span className="cw-tag a">{fmt(Math.abs(c.gap))}{c.gap > 0 ? ' due' : ' over'}</span>}</span></div>
      {last && !ok && (c.gap > 0
        ? <div className="cw-note info">{fmt(c.gap)} of today's sales is not paid yet. That is fine if it is a customer due bill. You will enter it in question 22, and it must add up to {fmt(c.gap)}.</div>
        : <div className="cw-note">Next is locked. The five figures add up to {fmt(c.six)}, which is {fmt(-c.gap)} more than the POS total of {fmt(num(d.pos))}. Please check the figures.</div>)}
    </div>
  );
}
function DueBox({ gap, e }: { gap: number; e: number }) {
  const ok = Math.abs(e - gap) < 0.5;
  return (
    <div className="cw-box" style={{ marginTop: 0, marginBottom: 14 }}>
      <div className="cw-l"><span>Unpaid sales from question 6</span><span>{fmt(gap)}</span></div>
      <div className="cw-l"><span>Entered here</span><span>{fmt(e)}</span></div>
      <div className="cw-l cw-tot"><span>Check</span><span>{ok ? <span className="cw-tag g">Matches</span> : <span className="cw-tag a">{fmt(gap - e)} to go</span>}</span></div>
    </div>
  );
}

interface OpenBill { id: string; no: string | null; who: string | null; bal: number }
const billLabel = (b: OpenBill) => `${b.no ?? 'No number'} · ${b.who ?? 'Customer'} · balance ${fmt(Number(b.bal))}`;
function Rows({ s, rows, set, bills }: { s: Extract<Step, { t: 'rows' }>; rows: Row[]; set: (r: Row[]) => void; bills: OpenBill[] }) {
  const upd = (i: number, k: string, v: string) => set(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <>
      {rows.map((r, i) => (
        <div className="cw-rowc" key={i}>
          <div className="cw-rh"><span>Entry {i + 1}</span><button onClick={() => set(rows.filter((_, j) => j !== i))}>Remove</button></div>
          {s.cols.map((cl) => (
            <div key={cl.k}>
              <label className="cw-lab">{cl.l}</label>
              {cl.ty === 'bill' && <select className="cw-in" value={r[cl.k] ?? ''} onChange={(e) => { const v = e.target.value; const b = bills.find((x) => billLabel(x) === v); set(rows.map((x, j) => (j === i ? { ...x, [cl.k]: v, bid: b ? b.id : '' } : x))); }}><option value="">Choose</option>{OPEN_BILLS.map((o) => <option key={o}>{o}</option>)}{bills.map((b) => <option key={b.id}>{billLabel(b)}</option>)}</select>}
              {cl.ty === 'method' && <select className="cw-in" value={r[cl.k] ?? ''} onChange={(e) => upd(i, cl.k, e.target.value)}><option value="">Choose</option>{['Cash', 'UPI', 'Card', 'Split'].map((o) => <option key={o}>{o}</option>)}</select>}
              {(cl.ty === 'text' || cl.ty === 'num' || cl.ty === 'date') && <input className="cw-in" type={cl.ty === 'date' ? 'date' : 'text'} inputMode={cl.ty === 'num' ? 'decimal' : undefined} value={r[cl.k] ?? ''} onChange={(e) => upd(i, cl.k, cl.ty === 'num' ? e.target.value.replace(/[^0-9.]/g, '') : e.target.value)} />}
            </div>
          ))}
        </div>
      ))}
      <button className="cw-add" onClick={() => set([...rows, {}])}>+ Add {rows.length ? 'another' : 'an'} entry</button>
    </>
  );
}

function Review({ d, c, go }: { d: CD; c: ReturnType<typeof calc>; go: (n: number) => void }) {
  const yn = (y: boolean | null, a: Row[], k: string) => (y === null ? '-' : y ? `${a.length} entered (${fmt(sum(a, k))})` : 'None');
  const Sec = ({ t, n, lines }: { t: string; n: number; lines: [string, string][] }) => (
    <div className="cw-secx"><div className="cw-sh"><span>{t}</span><button onClick={() => go(n)}>Edit</button></div>{lines.map((l) => <div className="cw-sl" key={l[0]}><span>{l[0]}</span><span>{l[1]}</span></div>)}</div>
  );
  const vt = (v: number) => (v === 0 ? 'g' : 'a');
  return (
    <>
      <div className="cw-q">Check your report</div>
      <p className="cw-hint">Look it over. Once you submit, the report is locked.</p>
      <div className="cw-box" style={{ marginTop: 0, marginBottom: 12 }}>
        <div className="cw-l"><span>Digital variance</span><span className={'cw-tag ' + vt(c.dig)}>{sg(c.dig)}</span></div>
        <div className="cw-sub">Paytm {fmt(num(d.paytm))} less EDC {fmt(c.edc)} less POS digital sales {fmt(c.digSales)}</div>
        <div className="cw-l"><span>Cash variance</span><span className={'cw-tag ' + vt(c.cv)}>{sg(c.cv)}</span></div>
        <div className="cw-sub">Cash collected {fmt(c.coll)}{c.oldCash ? ` (after ${fmt(c.oldCash)} for older bills)` : ''} against POS cash {fmt(num(d.cash))}</div>
        <div className="cw-l cw-tot"><b>Combined</b><span className={'cw-tag ' + vt(c.comb)}>{sg(c.comb)}</span></div>
      </div>
      {c.opp && <div className="cw-note">Digital and cash are off in opposite directions. Please check both before you submit. It may be a payment entered under the wrong type.</div>}
      <Sec t="Sales" n={1} lines={[['POS total', fmt(num(d.pos))], ['Card', fmt(num(d.card))], ['UPI / Paytm', fmt(num(d.upi))], ['Static QR', fmt(num(d.qr))], ['Cash', fmt(num(d.cash))], ['Online', fmt(num(d.online))]]} />
      <Sec t="Digital collections" n={7} lines={[['Paytm collections', fmt(num(d.paytm))], ['Proximus EDC', yn(d.edcYes, d.edc, 'amt')]]} />
      <Sec t="Cash" n={9} lines={[['Opening cash', fmt(num(d.open))], ['Counted cash', fmt(c.counted)], ['Taken for expenses', fmt(num(d.withdrawn)) + (has(d.whyOut) ? ` (${d.whyOut})` : '')], ['Secured or deposited', d.secured === null ? '-' : d.secured ? 'Yes' : 'No']]} />
      <Sec t="Bills" n={21} lines={[['Room-charge bills', yn(d.roomYes, d.rooms, 'amt')], ['Customer due bills', yn(d.dueYes, d.dues, 'amt')], ['Payments on older bills', yn(d.oldYes, d.olds, 'amt')]]} />
      <Sec t="Notes" n={24} lines={[['Note', d.noteYes ? d.note : 'None']]} />
    </>
  );
}
