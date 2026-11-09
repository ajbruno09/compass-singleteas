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

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
interface Week { weekly_off: number | null; shift_start: string | null; shift_end: string | null }

// First screen for every staff member. Order follows the approved mock:
// message board, my week, to do, coming soon, get to work.
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

      <div className="hsec">My week</div>
      <WeekCard week={week} place={myLocations.length === 1 ? (cur?.name ?? '') : ''} />

      <div className="hsec">To do</div>
      {myLocations.length === 0 && <p className="banner warn">No counter has been given to you yet. Please tell Admin, so they can set it up.</p>}
      {myLocations.length > 1 ? (() => {
        const n = myLocations.length;
        const sentIds = myLocations.filter((l) => sentText(status[l.id]));
        const dailyDone = myLocations.filter((l) => daily[l.id] === 'submitted');
        const weeklyDone = myLocations.filter((l) => weekly[l.id] === 'submitted');
        const toConfirm = myLocations.reduce((a, l) => a + (waiting[l.id] || 0), 0);
        const names = (done: typeof myLocations) => myLocations.filter((l) => !done.includes(l)).map((l) => l.name).join(', ');
        const Line = ({ e, label, done, all, chip, left, go }: { e: string; label: string; done: number; all: number; chip: string; left: string; go: () => void }) => (
          <button style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left', display: 'grid', gap: 2 }} onClick={go}>
            <span className="row" style={{ justifyContent: 'space-between' }}><span className="lbl"><Icon name={e} size={20} /> {label}</span><span className={'chip ' + chip}>{done} of {all}{done === all ? ' ✓' : ''}</span></span>
            {done < all && left && <span className="small muted">Still to do: {left}</span>}
          </button>
        );
        return (
          <div className="card stack" style={{ gap: 12 }}>
            <Line e="note" label="Indents sent" done={sentIds.length} all={n} chip={sentIds.length === n ? 'done' : win === 'late' ? 'late' : 'due'} left={names(sentIds)} go={() => nav(`/indent?loc=${loc}`)} />
            <Line e="calbars" label="Daily closing done" done={dailyDone.length} all={n} chip={dailyDone.length === n ? 'done' : 'late'} left={names(dailyDone)} go={() => nav('/closing')} />
            <Line e="cal" label="Weekly closing done" done={weeklyDone.length} all={n} chip={weeklyDone.length === n ? 'done' : sun ? 'late' : 'due'} left={sun ? names(weeklyDone) : 'Due Sunday'} go={() => nav('/closing')} />
            {toConfirm > 0 && <button className="row" style={{ justifyContent: 'space-between', background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }} onClick={() => nav(`/received?loc=${loc}`)}><span className="lbl"><Icon name="inbox" size={20} /> Items from the store</span><span className="chip late">{toConfirm} to confirm</span></button>}
          </div>
        );
      })() : (
      <div className="card stack" style={{ gap: 10 }}>
        {myLocations.map((l) => {
          const s = sentText(status[l.id]);
          return (
            <div key={l.id} className="stack" style={{ gap: 10 }}>
              <button className="row" style={{ justifyContent: 'space-between', background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={() => nav(`/indent?loc=${l.id}`)}>
                <span className="lbl"><Icon name="note" size={20} /> Indent</span>
                <span className={'chip ' + (s ? 'done' : win === 'late' ? 'late' : 'due')}>{s ?? (win === 'early' ? `From ${clock12(rem.indent_open ?? '15:30')}` : win === 'late' ? 'Late, send now' : `Due ${clock12(rem.indent_due ?? '17:00')}`)}</span>
              </button>
              <button className="row" style={{ justifyContent: 'space-between', background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={() => nav('/closing')}>
                <span className="lbl"><Icon name="calbars" size={20} /> Daily closing</span>
                <span className={'chip ' + (daily[l.id] === 'submitted' ? 'done' : 'late')}>{daily[l.id] === 'submitted' ? 'Done ✓' : daily[l.id] ? 'Started' : 'Due tonight'}</span>
              </button>
              <button className="row" style={{ justifyContent: 'space-between', background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={() => nav('/closing')}>
                <span className="lbl"><Icon name="cal" size={20} /> Weekly closing</span>
                <span className={'chip ' + (weekly[l.id] === 'submitted' ? 'done' : sun ? 'late' : 'due')}>{weekly[l.id] === 'submitted' ? 'Done ✓' : sun ? 'Due today' : 'Due Sunday'}</span>
              </button>
              {waiting[l.id] > 0 && (
                <button className="row" style={{ justifyContent: 'space-between', background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={() => nav(`/received?loc=${l.id}`)}>
                  <span className="lbl"><Icon name="inbox" size={20} /> Items from the store</span><span className="chip late">{waiting[l.id]} to confirm</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
      )}

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
      {[['target', 'Your targets', 'Coming soon. Look out for your targets here.'], ['coin', 'Your incentives', 'Coming soon. Look out for your incentives here.'], ['trenddown', 'Food cost control', 'Coming soon. See how we are doing on wastage and cost.']].map(([e, h, b]) => (
        <div key={h} className="soonbox"><div style={{ color: 'var(--brand)', display: 'grid', placeItems: 'center', marginBottom: 2 }}><Icon name={e} size={26} stroke={1.6} /></div><b>{h}</b><div className="small muted">{b}</div></div>
      ))}

      <div className="hsec">Get to work</div>
      <div className="tiles2">
        <button className="tile2" onClick={() => nav(`/indent?loc=${loc}`)}><span className="i"><Icon name="note" size={26} /></span><b>Indent</b><span className="small muted">Order for tomorrow</span></button>
        <button className="tile2" onClick={() => nav('/closing')}><span className="i"><Icon name="calbars" size={26} /></span><b>Closing stock</b><span className="small muted">Daily or weekly</span></button>
        <button className="tile2" onClick={() => window.dispatchEvent(new Event('compass:sos'))}><span className="i"><Icon name="siren2" size={26} /></span><b>SOS</b><span className="small muted">Need something now</span></button>
        {myLocations.some((l) => l.code === 'snacks_production') && <button className="tile2" onClick={() => nav('/production')}><span className="i"><Icon name="box" size={26} /></span><b>Production</b><span className="small muted">Today's snacks</span></button>}
        {gasDuty && <button className="tile2" onClick={() => nav('/gas')}><span className="i"><Icon name="box" size={26} /></span><b>Weigh gas</b><span className="small muted">Cylinders tonight</span></button>}
        <button className="tile2" onClick={() => nav('/messages')}><span className="i"><Icon name="chat" size={26} /></span><b>Messages</b><span className="small muted">Older notices</span></button>
      </div>
      <button className="countercard" onClick={() => nav('/mine')}>
        <Icon name="scale" size={34} stroke={1.6} />
        <span style={{ flex: 1, textAlign: 'left' }}><span className="name" style={{ display: 'block' }}>My Compass</span><span className="small muted" style={{ fontWeight: 600 }}>My sales, targets and incentives</span></span>
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
