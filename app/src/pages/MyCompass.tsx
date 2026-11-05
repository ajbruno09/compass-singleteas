import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { money } from '../lib/format';
import { Icon } from '../components/Icon';

interface Sales { has_data: boolean; as_of?: string; day_mine?: number; day_share?: number; month_mine?: number; month_share?: number }
interface Pack { food: number; stay: number }

// A page just for the person: their counters' sales, targets and incentives (coming), and the cost the cafe bears for them.
// Salary is never loaded or shown. Only the person's own food and stay amounts come back, and only to them.
export function MyCompass() {
  const { myLocations } = useSession();
  const nav = useNavigate();
  const [s, setS] = useState<Sales | null>(null);
  const [p, setP] = useState<Pack | null>(null);
  useEffect(() => {
    void supabase.rpc('my_sales').then(({ data }) => setS((data as Sales) ?? { has_data: false }));
    void supabase.rpc('my_package').then(({ data }) => setP((data as Pack) ?? { food: 0, stay: 0 }));
  }, []);
  const names = myLocations.map((l) => l.name).join(' and ');
  const dayText = s?.as_of ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(s.as_of + 'T00:00:00')) : '';
  return (
    <div className="phone">
      <div className="phone-head">
        <button className="btn quiet" onClick={() => nav('/')} aria-label="Back">←</button>
        <p style={{ font: '800 18px/20px var(--font-display)' }}>My Compass</p>
        <span />
      </div>
      <div className="stack">
        <div className="card" style={{ display: 'grid', gap: 8 }}>
          <p className="label">Sales of {names || 'your counters'}</p>
          {s?.has_data ? (
            <>
              <p style={{ font: '800 30px/34px var(--font-display)' }}>{money(s.day_mine ?? 0)}</p>
              <p className="small muted">On {dayText}. That is <b>{s.day_share}%</b> of the cafe's sales that day.</p>
              <div style={{ height: 10, background: 'var(--line, #e5e5e5)', borderRadius: 6, overflow: 'hidden' }}><div style={{ width: `${Math.min(100, s.day_share ?? 0)}%`, height: '100%', background: 'var(--green, #0F4D2A)' }} /></div>
              <p className="small muted">This month so far: <b>{money(s.month_mine ?? 0)}</b> ({s.month_share}% of the cafe).</p>
            </>
          ) : <p className="muted">Your daily sales will show here soon. Keep an eye on this page.</p>}
        </div>

        <div className="card" style={{ display: 'grid', gap: 6 }}>
          <p className="label">Targets and incentives</p>
          <p style={{ font: '700 16px/22px var(--font-display)' }}>Coming soon</p>
          <p className="small muted">Your sales target and the incentive you can earn will be shown here. Something good is on its way.</p>
        </div>

        <div className="card" style={{ display: 'grid', gap: 6 }}>
          <p className="label">What the cafe spends on you every month</p>
          <div className="row" style={{ justifyContent: 'space-between' }}><span>Salary</span><b>XXXXX</b></div>
          <div className="row" style={{ justifyContent: 'space-between' }}><span>Food</span><b>{p && p.food > 0 ? money(p.food) : 'XXXXX'}</b></div>
          <div className="row" style={{ justifyContent: 'space-between' }}><span>Stay</span><b>{p && p.stay > 0 ? money(p.stay) : 'XXXXX'}</b></div>
          <p className="small muted">This is only for you. Your salary is kept private and never shown here.</p>
        </div>
      </div>
      <button className="btn secondary" style={{ marginTop: 12 }} onClick={() => nav('/')}><Icon name="home" /> Back to my work</button>
    </div>
  );
}
