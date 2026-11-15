import { useEffect, useState } from 'react';
import { useSession } from '../lib/session';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Notice } from '../lib/types';
import { timeOf } from '../lib/ist';
import { NoticeFiles } from '../components/NoticeFiles';

export function MessagesPage() {
  const nav = useNavigate();
  const { profile } = useSession();
  const [rows, setRows] = useState<Notice[]>([]);
  const [read, setRead] = useState<Set<string>>(new Set());
  useEffect(() => {
    supabase.from('notices').select('*').lte('send_at', new Date().toISOString()).order('pinned', { ascending: false }).order('send_at', { ascending: false }).limit(60).then(({ data }) => setRows((data as Notice[]) ?? []));
    if (profile) supabase.from('notice_reads').select('notice_id').eq('profile_id', profile.id).not('read_at', 'is', null).then(({ data }) => setRead(new Set(((data as { notice_id: string }[]) ?? []).map((x) => x.notice_id))));
  }, [profile]);
  return (
    <div className="phone">
      <div className="phone-head"><button className="btn quiet" onClick={() => nav('/')}>‹ Home</button><b>Messages</b><span /></div>
      {rows.length === 0 ? <p className="empty card">No messages yet.</p> : rows.map((n) => (
        <section key={n.id} className="card" style={{ display: 'grid', gap: 4 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><b>{n.pinned ? '📌 ' : ''}{n.title}</b><span className="small muted">{timeOf(n.send_at ?? n.created_at)}{read.has(n.id) ? ' · Read' : ' · New'}</span></div>
          {n.body && <p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>}
          <NoticeFiles files={n.files} />
        </section>))}
    </div>
  );
}
