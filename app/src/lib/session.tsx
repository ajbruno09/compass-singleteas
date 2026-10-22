import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Location, Profile } from './types';

interface Ctx { session: Session | null; profile: Profile | null; locations: Location[]; myLocations: Location[]; loading: boolean; reload: () => Promise<void>; signOut: () => Promise<void>; }
const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [myLocations, setMyLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);

  async function load(s: Session | null) {
    setSession(s);
    if (!s) { setProfile(null); setLocations([]); setMyLocations([]); setLoading(false); return; }
    const [{ data: p }, { data: locs }, { data: mine }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle(),
      supabase.from('locations').select('*').order('sort'),
      supabase.from('profile_locations').select('location_id').eq('profile_id', s.user.id)
    ]);
    setProfile((p as Profile) ?? null);
    const all = (locs as Location[]) ?? [];
    setLocations(all);
    const ids = new Set(((mine as { location_id: number }[]) ?? []).map((m) => m.location_id));
    setMyLocations(all.filter((l) => ids.has(l.id)));
    setLoading(false);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => { load(s); });
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <SessionCtx.Provider value={{ session, profile, locations, myLocations, loading, reload: () => load(session), signOut: async () => { await supabase.auth.signOut(); } }}>
      {children}
    </SessionCtx.Provider>
  );
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error('useSession outside provider');
  return c;
}
