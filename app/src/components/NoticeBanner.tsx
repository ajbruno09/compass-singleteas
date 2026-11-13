import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import type { Notice } from '../lib/types';
import { Icon } from './Icon';
import '../nt.css';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sentOf = (t: string) => { const d = new Date(t); const h = d.getHours(); return `Sent ${d.getDate()} ${MON[d.getMonth()]}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };

// One blue line at the top of the Store and Admin dashboards for every notice they have not tapped Got it on.
export function NoticeBanner() {
  const { profile } = useSession();
  const [rows, setRows] = useState<Notice[]>([]);
  const [read, setRead] = useState<Set<string>>(new Set());
  const load = useCallback(async () => {
    if (!profile) return;
    const [n, r] = await Promise.all([
      supabase.rpc('my_notices'),
      supabase.from('notice_reads').select('notice_id').eq('profile_id', profile.id).not('read_at', 'is', null)
    ]);
    setRows((n.data as Notice[]) ?? []);
    setRead(new Set(((r.data as { notice_id: string }[]) ?? []).map((x) => x.notice_id)));
  }, [profile]);
  useEffect(() => { void load(); const t = window.setInterval(() => { void load(); }, 60000); return () => window.clearInterval(t); }, [load]);
  const shown = rows.filter((n) => !read.has(n.id));
  const seenSent = useRef<Set<string>>(new Set());
  useEffect(() => { for (const n of shown) if (!seenSent.current.has(n.id)) { seenSent.current.add(n.id); void supabase.rpc('mark_notice_seen', { p_id: n.id }).then(() => undefined); } }, [shown.map((n) => n.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown.length) return null;
  async function got(id: string) { setRead((s) => new Set(s).add(id)); await supabase.rpc('mark_notice_read', { p_id: id }); }
  return (
    <div className="nt" style={{ display: 'grid', gap: 8, marginBottom: 14 }} aria-label="Notices">
      {shown.map((n) => (
        <div key={n.id} className="nt-banner">
          <span className="nt-ico"><Icon name="bell" size={18} stroke={1.8} /></span>
          <div className="nt-sp"><b>{n.title}{n.body ? '.' : ''}</b>{n.body ? ' ' + n.body.replace(/\s*\n+\s*/g, ' ') : ''}</div>
          <span className="nt-sm" style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>{sentOf(n.send_at ?? n.created_at)}</span>
          <button type="button" onClick={() => void got(n.id)}>Got it</button>
        </div>
      ))}
    </div>
  );
}
