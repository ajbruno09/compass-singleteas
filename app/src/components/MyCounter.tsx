import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { money } from '../lib/format';
import { Icon } from './Icon';

interface Sales { has_data: boolean; as_of?: string; day_mine?: number; day_share?: number; month_mine?: number; month_share?: number }
interface Part { name: string; amt: number }
interface Day { d: string; amt: number; has: boolean; parts?: Part[] }
const PAL = ['#1B6A4D', '#E0A030', '#1D4F91', '#7A5AB8', '#B02A1E'];

const when = (d: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(d + 'T00:00:00'));

// My Compass, opened up on the counter home. Cards with real data show it, the rest stay as placeholders until their data exists.
export function MyCounter({ counters }: { counters: string }) {
  const [s, setS] = useState<Sales | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    void supabase.rpc('my_sales').then(({ data }) => setS((data as Sales) ?? { has_data: false }));
    void supabase.rpc('my_sales_daily', { p_days: 14 }).then(({ data }) => setDays((data as Day[]) ?? []));
  }, []);
  const [side, setSide] = useState(false);
  const names = [...new Set(days.flatMap((x) => (x.parts ?? []).map((q) => q.name)))].sort();
  const colour = (n: string) => PAL[names.indexOf(n) % PAL.length];
  const multi = names.length > 1;
  const totals = names.map((n) => ({ n, v: days.reduce((a, x) => a + ((x.parts ?? []).find((q) => q.name === n)?.amt ?? 0), 0) }));
  const any = days.some((x) => x.has);
  const max = Math.max(1, ...(multi && side ? days.flatMap((x) => (x.parts ?? []).map((q) => q.amt)) : days.map((x) => x.amt))) * 1.1;
  const H = 104;
  const last = [...days].reverse().find((x) => x.has);
  const best = days.filter((x) => x.has).reduce<Day | null>((a, x) => (!a || x.amt > a.amt ? x : a), null);
  return (
    <>
      <div className="hsec">My Compass</div>
      <div className="card" style={{ display: 'grid', gap: 6 }}>
        <p className="label">Sales of {counters || 'your counters'}</p>
        {s?.has_data ? (
          <>
            <p style={{ font: '500 26px/30px var(--font)' }} className="num">{money(s.day_mine ?? 0)}</p>
            <p className="small muted">On {s.as_of ? when(s.as_of) : ''}. That is {s.day_share}% of the cafe's sales that day.</p>
            <p className="small muted">This month so far: {money(s.month_mine ?? 0)} ({s.month_share}% of the cafe).</p>
          </>
        ) : <p className="small muted">Your daily sales will show here soon.</p>}
      </div>

      <div className="card" style={{ display: 'grid', gap: 4 }}>
        <p className="label">Daily sales, last 14 days</p>
        {any ? (
          <>
            {multi && <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>{totals.map((t) => <span key={t.n} className="small"><i style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 3, background: colour(t.n), marginRight: 5 }} />{t.n} <b>{money(t.v)}</b></span>)}</div>}
            <p className="small muted">Tap a bar to see the day's amount{multi ? ' and the split' : ''}.</p>
            <div className="mcbars" style={{ height: H + 30 }}>
              {days.map((x, i) => {
                const h = Math.max(2, Math.round(x.amt / max * H));
                return (
                  <button key={x.d} className={'mccol' + (sel === i ? ' sel' : '')} onClick={() => setSel(sel === i ? null : i)} aria-label={`${when(x.d)}, ${x.has ? money(x.amt) : 'no sales entered'}`}>
                    {sel === i && <span className="mcbub" style={i < 2 ? { left: 0 } : i > days.length - 3 ? { right: 0 } : { left: '50%', transform: 'translateX(-50%)' }}>{x.has ? money(x.amt) : 'Not entered'}{multi && x.has ? (x.parts ?? []).map((q) => <small key={q.name} style={{ display: 'block' }}>{q.name} {money(q.amt)}</small>) : null}<small>{when(x.d)}</small></span>}
                    {multi && x.has && !side
                      ? <div style={{ height: h, width: '100%', display: 'flex', flexDirection: 'column-reverse', borderRadius: '4px 4px 0 0', overflow: 'hidden' }}>{(x.parts ?? []).map((q) => <span key={q.name} style={{ height: x.amt > 0 ? `${(q.amt / x.amt) * 100}%` : 0, background: colour(q.name) }} />)}</div>
                      : multi && x.has && side
                        ? <div style={{ height: h, width: '100%', display: 'flex', alignItems: 'flex-end', gap: 1 }}>{(x.parts ?? []).map((q) => <span key={q.name} style={{ flex: 1, height: Math.max(2, Math.round(q.amt / max * H)), background: colour(q.name), borderRadius: '3px 3px 0 0' }} />)}</div>
                        : <i style={{ height: h, opacity: x.has ? 1 : 0.25 }} />}
                  </button>
                );
              })}
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}><span className="small muted">14 days ago</span><span className="small muted">Today</span></div>
            {multi && <div className="row" style={{ gap: 6 }}><button className={'btn' + (!side ? ' primary' : '')} onClick={() => setSide(false)}>Together</button><button className={'btn' + (side ? ' primary' : '')} onClick={() => setSide(true)}>Side by side</button></div>}
            <div className="row" style={{ gap: 10, marginTop: 6, flexWrap: 'nowrap' }}>
              <div className="mctile"><span className="small muted">LAST ENTERED</span><b className="num">{last ? money(last.amt) : '—'}</b><span className="small muted">{last ? when(last.d) : ''}</span></div>
              <div className="mctile"><span className="small muted">BEST DAY</span><b className="num">{best ? money(best.amt) : '—'}</b><span className="small muted">{best ? when(best.d) : ''}</span></div>
            </div>
          </>
        ) : <p className="small muted">Your daily sales graph will show here once sales are entered.</p>}
      </div>

      <div className="mcsoon">
        {[['target', 'Your pace this month', 'Coming soon'], ['coin', 'Your bonus', 'Coming soon'], ['trenddown', 'Food and fuel cost', 'Coming soon'], ['scale', 'Every ₹100 you sell', 'Coming soon']].map(([e, h, b]) => (
          <div key={h} className="soonbox"><div style={{ color: 'var(--brand)', display: 'grid', placeItems: 'center', marginBottom: 2 }}><Icon name={e} size={22} stroke={1.6} /></div><b style={{ fontWeight: 500, fontSize: 13 }}>{h}</b><div className="small muted">{b}</div></div>
        ))}
      </div>

      <div className="soonbox"><div style={{ color: 'var(--brand)', display: 'grid', placeItems: 'center', marginBottom: 2 }}><Icon name="coin" size={22} stroke={1.6} /></div><b style={{ fontWeight: 500, fontSize: 13 }}>Your cost to the company</b><div className="small muted">Coming soon</div></div>
    </>
  );
}
