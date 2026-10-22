import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { photoUrl } from '../lib/masters';
import { quick } from '../lib/format';
import { LANGUAGES } from '../lib/types';
import { Icon } from '../components/Icon';

interface DeptItem { id: number; name: string; local_names: Record<string, string>; unit: string; quick_amounts: number[]; photo_path: string | null }

export function StaffHome() {
  const { profile, myLocations, signOut } = useSession();
  const [loc, setLoc] = useState<number | null>(null);
  const [items, setItems] = useState<DeptItem[]>([]);
  const [photos, setPhotos] = useState<Record<number, string>>({});
  const [local, setLocal] = useState(() => { try { return localStorage.getItem('compass-lang') === 'local'; } catch { return false; } });
  const lang = profile?.extra_language ?? null;

  useEffect(() => { if (loc == null && myLocations.length) setLoc(myLocations[0].id); }, [myLocations, loc]);
  useEffect(() => {
    if (loc == null) return;
    supabase.rpc('department_items', { p_location_id: loc }).then(async ({ data }) => {
      const list = (data as DeptItem[]) ?? [];
      setItems(list);
      const urls: Record<number, string> = {};
      await Promise.all(list.map(async (i) => { const u = await photoUrl(i.photo_path); if (u) urls[i.id] = u; }));
      setPhotos(urls);
    });
  }, [loc]);

  function toggle() { const n = !local; setLocal(n); try { localStorage.setItem('compass-lang', n ? 'local' : 'en'); } catch { /* ignore */ } }
  const label = (i: DeptItem) => (local && lang && i.local_names?.[lang]) || i.name;
  const where = myLocations.find((l) => l.id === loc)?.name ?? '';

  return (
    <div className="phone">
      <div className="phone-head">
        <div className="row" style={{ gap: 8 }}>
          <img src="/icon.svg" alt="" width={32} height={32} />
          <div><p style={{ font: '800 18px/20px var(--font-display)' }}>{where || 'Compass'}</p>
            <p className="small muted">{profile?.full_name}</p></div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {lang && <button className="btn secondary" style={{ minHeight: 40, borderRadius: 999 }} onClick={toggle}><Icon name="globe" size={16} />{local ? 'English' : (LANGUAGES[lang] ?? lang).split(' ')[0]}</button>}
          <button className="btn quiet" onClick={signOut} aria-label="Sign out"><Icon name="out" /></button>
        </div>
      </div>
      {myLocations.length > 1 && (
        <div className="seg" role="group" aria-label="Where">{myLocations.map((l) => <button key={l.id} aria-pressed={loc === l.id} onClick={() => setLoc(l.id)}>{l.name}</button>)}</div>
      )}
      <div className="bigtiles">
        {[['clip', 'Indent'], ['box', 'Receive'], ['scale', 'Count'], ['trash', 'Waste']].map(([icon, name]) => (
          <div key={name} className="bigtile" aria-disabled="true">
            <Icon name={icon} size={40} stroke={1.6} />
            <span><span className="name" style={{ display: 'block' }}>{name}</span><span className="small muted" style={{ fontWeight: 700 }}>Starts soon</span></span>
          </div>
        ))}
      </div>
      <h2>Your items</h2>
      {items.length === 0 ? <p className="empty card">No items are set up for {where || 'you'} yet.</p> : (
        <div className="itemgrid">
          {items.map((i) => (
            <div key={i.id} className="itemtile">
              <div className="pic">{photos[i.id] ? <img src={photos[i.id]} alt="" /> : i.name.slice(0, 1)}</div>
              <span className="nm">{label(i)}</span>
              <span className="small muted num">{(i.quick_amounts ?? []).slice(0, 3).map((n) => quick(Number(n), i.unit)).join(' ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
