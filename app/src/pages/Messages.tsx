import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Notice } from '../lib/types';
import { timeOf } from '../lib/ist';

export function MessagesPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Notice[]>([]);
  useEffect(() => { supabase.from('notices').select('*').order('created_at', { ascending: false }).limit(40).then(({ data }) => setRows((data as Notice[]) ?? [])); }, []);
  return (
    <div className="phone">
      <div className="phone-head"><button className="btn quiet" onClick={() => nav('/')}>‹ Home</button><b>Messages</b><span /></div>
      {rows.length === 0 ? <p className="empty card">No messages yet.</p> : rows.map((n) => (
        <section key={n.id} className="card" style={{ display: 'grid', gap: 4 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><b>{n.pinned ? '📌 ' : ''}{n.title}</b><span className="small muted">{timeOf(n.created_at)}</span></div>
          {n.body && <p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>}
        </section>))}
    </div>
  );
}
