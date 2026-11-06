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
import { getCounter, setCounter } from '../components/StaffNav';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
interface Week { weekly_off: number | null; shift_start: string | null; shift_end: string | null }

// First screen for every staff member. Order follows the approved mock:
// message board, my week, to do, coming soon, get to work.
export function StaffHome() {
  const { profile, myLocations, signOut } = useSession();
  const nav = useNavigate();
  const { t, local, toggle, canSwitch } = useLang();
  const ids = myLocations.map((l) => l.id);
  const [loc, setLoc] = useState(getCounter(ids));
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
      const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const mon = new Date(today); mon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      const monStr = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
      const w: Record<number, number> = {}; const dd: Record<number, string> = {}; const ww: Record<number, string> = {};
      for (const l of myLocations) {
        const p = await supabase.rpc('pending_issues', { p_location_id: l.id });
        w[l.id] = ((p.data as unknown[]) ?? []).length;
        const k = await supabase.from('stock_counts').select('status').eq('location_id', l.id).eq('business_date', bd).eq('frequency', 'daily').maybeSingle();
        if (k.data) dd[l.id] = (k.data as { status: string }).status;
        const k2 = await supabase.from('stock_counts').select('status').eq('location_id', l.id).eq('frequency', 'weekly').gte('business_date', monStr).order('business_date', { ascending: false }).limit(1);
        const r2 = ((k2.data as { status: string }[]) ?? [])[0];
        if (r2) ww[l.id] = r2.status;
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
  const pick = (id: number) => { setCounter(id); setLoc(id); };
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

      {myLocations.length > 1 && (
        <div className="countersw" role="group" aria-label="Counter">{myLocations.map((l) => <button key={l.id} className={l.id === loc ? 'on' : ''} onClick={() => pick(l.id)}>{l.name}</button>)}</div>
      )}

      {!profile?.photo && <button className="banner warn" style={{ textAlign: 'left', width: '100%' }} onClick={() => nav('/profile')}>Please add your photo. Tap here.</button>}
      <StatusStrip />

      <div className="hsec">Message board</div>
      <NoticeStack />

      <div className="hsec">My week</div>
      <WeekCard week={week} place={cur?.name ?? ''} />

      <div className="hsec">To do</div>
      {myLocations.length === 0 && <p className="banner warn">No counter has been given to you yet. Please tell Admin, so they can set it up.</p>}
      <div className="card stack" style={{ gap: 10 }}>
        {myLocations.map((l) => {
          const s = sentText(status[l.id]);
          const multi = '';
          return (
            <div key={l.id} className="stack" style={{ gap: 10 }}>
              {myLocations.length > 1 && <b className="small" style={{ color: 'var(--ink-3)' }}>{l.name}</b>}
              <button className="row" style={{ justifyContent: 'space-between', background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={() => { pick(l.id); nav(`/indent?loc=${l.id}`); }}>
                <span>📝 {multi}Indent</span>
                <span className={'chip ' + (s ? 'done' : win === 'late' ? 'late' : 'due')}>{s ?? (win === 'early' ? `From ${clock12(rem.indent_open ?? '15:30')}` : win === 'late' ? 'Late, send now' : `Due ${clock12(rem.indent_due ?? '17:00')}`)}</span>
              </button>
              <button className="row" style={{ justifyContent: 'space-between', background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={() => { pick(l.id); nav('/closing'); }}>
                <span>🧮 {multi}Daily closing</span>
                <span className={'chip ' + (daily[l.id] === 'submitted' ? 'done' : 'late')}>{daily[l.id] === 'submitted' ? 'Done ✓' : daily[l.id] ? 'Started' : 'Due tonight'}</span>
              </button>
              <button className="row" style={{ justifyContent: 'space-between', background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={() => { pick(l.id); nav('/closing'); }}>
                <span>📦 {multi}Weekly closing</span>
                <span className={'chip ' + (weekly[l.id] === 'submitted' ? 'done' : sun ? 'late' : 'due')}>{weekly[l.id] === 'submitted' ? 'Done ✓' : sun ? 'Due today' : 'Due Sunday'}</span>
              </button>
              {waiting[l.id] > 0 && (
                <button className="row" style={{ justifyContent: 'space-between', background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={() => nav(`/received?loc=${l.id}`)}>
                  <span>📥 {multi}Items from the store</span><span className="chip late">{waiting[l.id]} to confirm</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {myLocations.length > 0 && (
        <div className="card">
          <b>Your record, last 30 days</b>
          <div className="row" style={{ gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
            <span><b className="num">{rec.on_time}</b> <span className="muted small">indents on time</span></span>
            <span><b className="num" style={{ color: rec.late ? 'var(--bad)' : undefined }}>{rec.late}</b> <span className="muted small">late</span></span>
            <span><b className="num" style={{ color: rec.missed ? 'var(--bad)' : undefined }}>{rec.missed}</b> <span className="muted small">missed</span></span>
            <span><b className="num">{rec.sos_count}</b> <span className="muted small">SOS used</span></span>
          </div>
        </div>
      )}

      <div className="hsec">Coming soon</div>
      {[['🎯', 'Your targets', 'Coming soon. Look out for your targets here.'], ['💰', 'Your incentives', 'Coming soon. Look out for your incentives here.'], ['📉', 'Food cost control', 'Coming soon. See how we are doing on wastage and cost.']].map(([e, h, b]) => (
        <div key={h} className="soonbox"><div style={{ fontSize: 22 }}>{e}</div><b>{h}</b><div className="small muted">{b}</div></div>
      ))}

      <div className="hsec">Get to work</div>
      <div className="tiles2">
        <button className="tile2" onClick={() => nav(`/indent?loc=${loc}`)}><span className="i">📝</span><b>Indent</b><span className="small muted">Order for tomorrow</span></button>
        <button className="tile2" onClick={() => nav('/closing')}><span className="i">🧮</span><b>Closing stock</b><span className="small muted">Daily or weekly</span></button>
        <button className="tile2" onClick={() => window.dispatchEvent(new Event('compass:sos'))}><span className="i">🚨</span><b>SOS</b><span className="small muted">Need something now</span></button>
        <button className="tile2" onClick={() => nav('/messages')}><span className="i">💬</span><b>Messages</b><span className="small muted">Older notices</span></button>
      </div>
      <button className="countercard" onClick={() => nav('/mine')}>
        <Icon name="scale" size={34} stroke={1.6} />
        <span style={{ flex: 1, textAlign: 'left' }}><span className="name" style={{ display: 'block' }}>My Compass</span><span className="small muted" style={{ fontWeight: 700 }}>My sales, targets and incentives</span></span>
      </button>
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
