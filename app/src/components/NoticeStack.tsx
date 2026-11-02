import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import type { Notice } from '../lib/types';
import { timeOf } from '../lib/ist';
import { Icon } from './Icon';

// The first thing a person sees: notices from the owner or manager.
export function NoticeStack() {
  const { profile } = useSession();
  const [rows, setRows] = useState<Notice[]>([]);
  const [read, setRead] = useState<Set<string>>(new Set());
  const load = useCallback(async () => {
    if (!profile) return;
    const [n, r] = await Promise.all([
      supabase.from('notices').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(10),
      supabase.from('notice_reads').select('notice_id').eq('profile_id', profile.id)
    ]);
    setRows((n.data as Notice[]) ?? []);
    setRead(new Set(((r.data as { notice_id: string }[]) ?? []).map((x) => x.notice_id)));
  }, [profile]);
  useEffect(() => { void load(); const t = window.setInterval(() => { void load(); }, 60000); return () => window.clearInterval(t); }, [load]);
  const shown = rows.filter((n) => !read.has(n.id) || n.pinned);
  if (!shown.length) return null;
  async function got(id: string) { setRead((s) => new Set(s).add(id)); await supabase.rpc('mark_notice_read', { p_id: id }); }
  return (
    <div className="stack" aria-label="Notices">
      {shown.map((n) => (
        <section key={n.id} className="card" style={{ display: 'grid', gap: 6, borderLeft: '4px solid var(--brand)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <b style={{ fontSize: 16 }}>{n.pinned ? '📌 ' : ''}{n.title}</b>
            <span className="small muted">{timeOf(n.created_at)}</span>
          </div>
          {n.body && <p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>}
          {read.has(n.id)
            ? <span className="small muted"><Icon name="check" size={14} /> Read</span>
            : <button className="btn primary" style={{ justifySelf: 'start' }} onClick={() => void got(n.id)}>Got it</button>}
        </section>
      ))}
    </div>
  );
}
