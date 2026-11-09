import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { Icon } from './Icon';

// Floats just above the SOS button on Home and Indent. Opens the older notices.
export function MessagesPill() {
  const { profile } = useSession();
  const nav = useNavigate();
  const here = useLocation().pathname;
  const [n, setN] = useState(0);
  const load = useCallback(async () => {
    if (!profile) return;
    const [a, r] = await Promise.all([
      supabase.from('notices').select('id').limit(30),
      supabase.from('notice_reads').select('notice_id').eq('profile_id', profile.id).not('read_at', 'is', null)
    ]);
    const read = new Set(((r.data as { notice_id: string }[]) ?? []).map((x) => x.notice_id));
    setN(((a.data as { id: string }[]) ?? []).filter((x) => !read.has(x.id)).length);
  }, [profile]);
  useEffect(() => { void load(); const t = window.setInterval(() => { void load(); }, 60000); return () => window.clearInterval(t); }, [load, here]);
  if (here !== '/' && !here.startsWith('/indent')) return null;
  return (
    <button className="msgfab" onClick={() => nav('/messages')} aria-label="Messages">
      <Icon name="chat" size={20} stroke={1.8} /> Messages{n > 0 && <em>{n}</em>}
    </button>
  );
}
