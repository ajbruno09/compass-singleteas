import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Location, Profile } from './types';

interface Ctx { loadError: boolean; session: Session | null; profile: Profile | null; locations: Location[]; allLocations: Location[]; myLocations: Location[]; party: { loc: Location; label: string; open: boolean; until: string | null } | null; loading: boolean; recovery: boolean; clearRecovery: () => void; reload: () => Promise<void>; signOut: () => Promise<void>; }
const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [allLocations, setAllLocations] = useState<Location[]>([]);
  const [myLocations, setMyLocations] = useState<Location[]>([]);
  const [partyStat, setPartyStat] = useState<{ active: boolean; label?: string; location_id?: number; open_until?: string | null; ordering_open?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const [loadError, setLoadError] = useState(false);

  async function load(s: Session | null) {
    setSession(s);
    if (!s) { setProfile(null); setLocations([]); setAllLocations([]); setMyLocations([]); setLoading(false); return; }
    let p: unknown = null; let locs: unknown = null; let mine: unknown = null; let failed = true;
    for (let attempt = 0; attempt < 3 && failed; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 800 * attempt));
      const [a, b, c] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle(),
        supabase.from('locations').select('*').order('sort'),
        supabase.from('profile_locations').select('location_id').eq('profile_id', s.user.id)
      ]);
      p = a.data; locs = b.data; mine = c.data; failed = !!(a.error || b.error || c.error);
    }
    setLoadError(failed);
    if (failed) { setLoading(false); return; }
    setProfile((p as Profile) ?? null);
    const all = (locs as Location[]) ?? [];
    setAllLocations(all);
    setLocations(all.filter((l) => l.active)); // hidden counters disappear everywhere except the Counters screen
    const ids = new Set(((mine as { location_id: number }[]) ?? []).map((m) => m.location_id));
    setMyLocations(all.filter((l) => ids.has(l.id) && l.active));
    setLoading(false);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data } = supabase.auth.onAuthStateChange((e, s) => { if (e === 'PASSWORD_RECOVERY') setRecovery(true); load(s); });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    const get = () => { if (document.visibilityState === 'visible') supabase.rpc('party_status').then(({ data }) => setPartyStat((data as typeof partyStat) ?? null)); };
    get();
    const iv = window.setInterval(get, 2 * 60 * 1000);
    document.addEventListener('visibilitychange', get); window.addEventListener('compass:party', get);
    return () => { window.clearInterval(iv); document.removeEventListener('visibilitychange', get); window.removeEventListener('compass:party', get); };
  }, [session?.user.id]);

  const party = (() => {
    if (!partyStat?.active) return null;
    const pl = allLocations.find((l) => l.id === partyStat.location_id);
    const kitchen = myLocations.some((l) => [8, 9, 10, 11].includes(l.id));
    return pl && kitchen ? { loc: { ...pl, active: true }, label: partyStat.label ?? 'Party', open: partyStat.ordering_open !== false, until: partyStat.open_until ?? null } : null;
  })();

  useEffect(() => {
    if (!session) return;
    const beat = () => { if (document.visibilityState === 'visible') void supabase.rpc('touch_me'); };
    beat();
    const id = window.setInterval(beat, 3 * 60 * 1000);
    document.addEventListener('visibilitychange', beat);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', beat); };
  }, [session?.user.id]);

  return (
    <SessionCtx.Provider value={{ loadError, session, profile, locations, allLocations, myLocations, party, loading, recovery, clearRecovery: () => setRecovery(false), reload: () => load(session), signOut: async () => {
      // Always leaves, even when the saved sign in is stale and the server refuses the request.
      try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* ignore */ }
      try { Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
      setSession(null); setProfile(null);
      window.location.assign('/');
    } }}>
      {children}
    </SessionCtx.Provider>
  );
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error('useSession outside provider');
  return c;
}
