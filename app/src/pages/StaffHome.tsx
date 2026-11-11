import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { clock12, dayLabel, timeOf, windowState, type Reminders } from '../lib/ist';
import { type IndentRec } from '../lib/types';
import { useLang } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { StatusStrip } from '../components/StatusStrip';
import { AvatarButton } from '../components/AvatarButton';
import { NoticeStack } from '../components/NoticeStack';
import { getCounter } from '../components/StaffNav';
import { MyCounter } from '../components/MyCounter';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
interface Week { weekly_off: number | null; shift_start: string | null; shift_end: string | null }

// First screen for every staff member. Order follows the approved mock:
// message board, to do, my week, then My Compass opened up (sales, placeholders, cost to the cafe, record).
export function StaffHome() {
  const { profile, myLocations, party, signOut } = useSession();
  const nav = useNavigate();
  const { t, local, toggle, canSwitch } = useLang();
  const ids = myLocations.map((l) => l.id);
  const [loc, setLoc] = useState(getCounter(ids));
  const [gasDuty, setGasDuty] = useState(false);
  useEffect(() => { if (!profile) return; void supabase.from('duty_people').select('duty').eq('profile_id', profile.id).eq('duty', 'gas_weigh').then(({ data }) => setGasDuty(!!data?.length)); }, [profile]);
  const [status, setStatus] = useState<Record<number, IndentRec>>({});
  const [date, setDate] = useState('');
  const [rem, setRem] = useState<Reminders>({});
  const [waiting, setWaiting] = useState<Record<number, number>>({});
  const [daily, setDaily] = useState<Record<number, string>>({});
  const [weekly, setWeekly] = useState<Record<number, string>>({});
  const [week, setWeek] = useState<Week | null>(null);
  const [rec, setRec] = useState({ on_time: 0, late: 0, missed: 0, sos_count: 0 });

  useEffect(() => { setLoc(getCounter(ids)); const h = () => setLoc(getCounter(ids)); window.addEventListener('compass:counter', h); return () => window.removeEventListener('compass:counter', h); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ids.join(',')]);

  useEffect(() => {
    (async () => {
      if (!profile) return;
      const [w, sc] = await Promise.all([
        supabase.from('staff_schedule').select('weekly_off, shift_start, shift_end').eq('profile_id', profile.id).maybeSingle(),
        supabase.rpc('counter_scorecard', { p_days: 30 })
      ]);
      setWeek((w.data as Week) ?? null);
      const mine = new Set(ids);
      const rows = ((sc.data as { location_id: number; on_time: number; late: number; missed: number; sos_count: number }[]) ?? []).filter((x) => mine.has(x.location_id));
      setRec(rows.reduce((a, x) => ({ on_time: a.on_time + x.on_time, late: a.late + x.late, missed: a.missed + x.missed, sos_count: a.sos_count + x.sos_count }), { on_time: 0, late: 0, missed: 0, sos_count: 0 }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, ids.join(',')]);

  useEffect(() => {
    (async () => {
      const [{ data: d }, { data: w }] = await Promise.all([supabase.rpc('indent_for_date'), supabase.rpc('indent_window')]);
      setDate(String(d)); setRem((w as Reminders) ?? {});
      const { data } = await supabase.from('indents').select('id, location_id, for_date, status, submitted_at, nothing_needed').eq('for_date', String(d));
      setStatus(Object.fromEntries(((data as IndentRec[]) ?? []).map((r) => [r.location_id, r])));
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const bd = String((await supabase.rpc('business_date', { p_at: new Date().toISOString() })).data);
      const w: Record<number, number> = {}; const dd: Record<number, string> = {}; const ww: Record<number, string> = {};
      for (const l of myLocations) {
        const p = await supabase.rpc('pending_issues', { p_location_id: l.id });
        w[l.id] = ((p.data as unknown[]) ?? []).length;
        const k = await supabase.from('stock_counts').select('status').eq('location_id', l.id).eq('business_date', bd).eq('frequency', 'daily').maybeSingle();
        if (k.data) dd[l.id] = (k.data as { status: string }).status;
        const k2 = await supabase.from('stock_counts').select('status').eq('location_id', l.id).eq('frequency', 'weekly').eq('business_date', bd).limit(1);
        const r2 = ((k2.data as { status: string }[]) ?? [])[0];
        if (r2) { ww[l.id] = r2.status; if (r2.status === 'submitted') dd[l.id] = 'submitted'; }
      }
      setWaiting(w); setDaily(dd); setWeekly(ww);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')]);

  const win = windowState(rem);
  const sentText = (r?: IndentRec) => !r || r.status === 'draft' ? null : r.nothing_needed ? t('Nothing needed') : t('Sent {time}', { time: timeOf(r.submitted_at) });
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = profile?.full_name?.split(' ')[0] ?? '';
  const cur = myLocations.find((l) => l.id === loc);
  const sun = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getDay() === 0;

  return (
    <div className="phone">
      <div className="phone-head">
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <AvatarButton size={40} />
          <div><p style={{ font: '800 18px/20px var(--font-display)' }}>{greet}, {first}</p>
            <p className="small muted">{myLocations.length === 1 ? myLocations[0].name + ' · ' : ''}{date ? t('Indent for {day}', { day: dayLabel(date) }) : ''}</p></div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          {canSwitch && <div className="langsw" role="group" aria-label="Language"><button aria-pressed={local} onClick={() => { if (!local) toggle(); }}>हिंदी</button><button aria-pressed={!local} onClick={() => { if (local) toggle(); }}>English</button></div>}
          <button className="btn quiet" onClick={signOut} aria-label={t('Sign out')}><Icon name="out" /></button>
        </div>
      </div>

      {party?.open && (
        <button className="countercard" onClick={() => nav(`/indent?loc=${party.loc.id}`)} style={{ borderColor: '#F3B48E', background: '#FFF1E8' }}>
          <Icon name="box" size={30} stroke={1.6} /><span style={{ flex: 1, textAlign: 'left' }}><span className="name" style={{ display: 'block' }}>Party order: {party.label}</span><span className="small muted">Order what the party needs. Any number of items{party.until ? ', until ' + new Date(party.until).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : ''}.</span></span><span className="chip due">Open</span>
        </button>
      )}

      {!profile?.photo && <button className="banner warn" style={{ textAlign: 'left', width: '100%' }} onClick={() => nav('/profile')}>Please add your photo. Tap here.</button>}
      <StatusStrip />

      <div className="hsec">Message board</div>
      <NoticeStack />

      <div className="hsec">To do</div>
      {myLocations.length === 0 && <p className="banner warn">No counter has been given to you yet. Please tell Admin, so they can set it up.</p>}
      {myLocations.length > 0 && (() => {
        const notSent = myLocations.filter((l) => !sentText(status[l.id]));
        const dailyLeft = myLocations.filter((l) => daily[l.id] !== 'submitted');
        const weeklyLeft = sun ? myLocations.filter((l) => weekly[l.id] !== 'submitted') : [];
        const toConfirm = myLocations.reduce((a, l) => a + (waiting[l.id] || 0), 0);
        const many = myLocations.length > 1;
        const names = (xs: typeof myLocations) => xs.map((l) => l.name).join(', ');
        const rows: { k: string; e: string; label: string; chip: string; cls: string; sub?: string; go: () => void }[] = [];
        if (notSent.length) rows.push({ k: 'ind', e: 'note', label: 'Send indent', cls: win === 'late' ? 'late' : 'due', go: () => nav(`/indent?loc=${notSent[0].id}`),
          chip: many ? `${notSent.length} left` : win === 'early' ? `From ${clock12(rem.indent_open ?? '15:30')}` : win === 'late' ? 'Late, send now' : `Due ${clock12(rem.indent_due ?? '17:00')}`, sub: many ? names(notSent) : undefined });
        if (dailyLeft.length) rows.push({ k: 'dc', e: 'calbars', label: 'Do daily closing', cls: 'late', go: () => nav('/closing'),
          chip: many ? `${dailyLeft.length} left` : daily[dailyLeft[0].id] ? 'Started' : 'Due tonight', sub: many ? names(dailyLeft) : undefined });
        if (weeklyLeft.length) rows.push({ k: 'wc', e: 'cal', label: 'Do weekly closing', cls: 'late', go: () => nav('/closing'),
          chip: many ? `${weeklyLeft.length} left` : 'Due today', sub: many ? names(weeklyLeft) : undefined });
        if (toConfirm > 0) rows.push({ k: 'rc', e: 'inbox', label: 'Confirm items from the store', cls: 'late', go: () => nav(`/received?loc=${myLocations.find((l) => (waiting[l.id] || 0) > 0)?.id ?? loc}`), chip: `${toConfirm} to confirm` });
        if (gasDuty) rows.push({ k: 'gas', e: 'box', label: 'Weigh LPG', cls: 'due', go: () => nav('/gas'), chip: 'Tonight', sub: 'Both cylinders, with a photo of each' });
        if (!rows.length) return <div className="card"><span className="lbl"><Icon name="check" size={20} /> Nothing to do right now. All done.</span></div>;
        return (
          <div className="card stack" style={{ gap: 12 }}>
            {rows.map((r) => (
              <button key={r.k} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left', display: 'grid', gap: 2 }} onClick={r.go}>
                <span className="row" style={{ justifyContent: 'space-between' }}><span className="lbl"><Icon name={r.e} size={20} /> {r.label}</span><span className={'chip ' + r.cls}>{r.chip}</span></span>
                {r.sub && <span className="small muted">{r.sub}</span>}
              </button>
            ))}
          </div>
        );
      })()}

      <div className="hsec">My week</div>
      <WeekCard week={week} place={myLocations.length === 1 ? (cur?.name ?? '') : ''} />

      <MyCounter counters={myLocations.length > 3 ? 'your counters' : myLocations.map((l) => l.name).join(' and ')} />

      {myLocations.length > 0 && (
        <div className="card">
          <b style={{ fontWeight: 500 }}>Your record, last 30 days</b>
          <div className="row" style={{ gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
            <span><b className="num">{rec.on_time}</b> <span className="muted small">indents on time</span></span>
            <span><b className="num" style={{ color: rec.late ? 'var(--bad)' : undefined }}>{rec.late}</b> <span className="muted small">late</span></span>
            <span><b className="num" style={{ color: rec.missed ? 'var(--bad)' : undefined }}>{rec.missed}</b> <span className="muted small">missed</span></span>
            <span><b className="num">{rec.sos_count}</b> <span className="muted small">SOS used</span></span>
          </div>
        </div>
      )}
      <div style={{ height: 120 }} aria-hidden />
    </div>
  );
}

function WeekCard({ week, place }: { week: Week | null; place: string }) {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const dow = (today.getDay() + 6) % 7;
  const days = DAY_NAMES.map((d, i) => { const dt = new Date(today); dt.setDate(today.getDate() - dow + i); return { d, n: dt.getDate(), i }; });
  const hm = (x: string | null) => (x ? clock12(x) : '');
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{week?.shift_start && week?.shift_end ? `${hm(week.shift_start)} to ${hm(week.shift_end)}` : 'Shift not set yet'}</b>
        {place && <span className="chip off">{place}</span>}
      </div>
      <p className="small muted" style={{ marginTop: 2 }}>{week?.weekly_off != null ? <>Weekly off: <b style={{ color: 'var(--ink)' }}>{FULL[week.weekly_off]}</b></> : 'Your weekly off has not been set yet.'}</p>
      <div className="weekstrip">
        {days.map((x) => (
          <div key={x.d} className={(x.i === week?.weekly_off ? 'off ' : '') + (x.i === dow ? 'today' : '')}>
            <span>{x.d}</span><b>{x.n}</b>{x.i === week?.weekly_off ? 'Off' : ''}
          </div>))}
      </div>
    </div>
  );
}
