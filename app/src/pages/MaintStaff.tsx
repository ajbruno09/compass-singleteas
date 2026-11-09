import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { MaintRaise } from '../components/MaintRaise';

export interface MReq { id: number; category: string; where_text: string; note: string; urgency: string; photos: string[]; status: 'new' | 'job' | 'fixed'; created_at: string; fix_note: string; raised_by: string }
export const ago = (s: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(s));
const ST: Record<string, [string, string]> = { new: ['Sent', 'late'], job: ['Being fixed', 'due'], fixed: ['Fixed', 'ok'] };

export function MaintStaff() {
  const [mine, setMine] = useState<MReq[]>([]);
  const [raise, setRaise] = useState(false);
  const load = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    const { data } = await supabase.from('maint_requests').select('*').eq('raised_by', u.user?.id ?? '').order('created_at', { ascending: false }).limit(30);
    setMine((data as MReq[]) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="stack" style={{ padding: 16, paddingBottom: 90 }}>
      <div><h1>Maintenance</h1><p className="muted small">Something broken or not working? Tell us here. Add a photo so it gets fixed faster.</p></div>
      {raise ? (
        <div className="card"><MaintRaise onDone={() => { setRaise(false); void load(); }} /><button className="btn quiet" style={{ marginTop: 8 }} onClick={() => setRaise(false)}>Cancel</button></div>
      ) : <button className="btn primary" onClick={() => setRaise(true)}>Raise a new request</button>}
      <div className="label">My requests</div>
      {mine.length === 0 ? <p className="empty card">Nothing raised yet.</p> : mine.map((r) => (
        <div key={r.id} className="card"><div className="row" style={{ justifyContent: 'space-between' }}>
          <div><b>{r.category}</b> <span className="muted small">· {r.where_text}</span>{r.note && <div className="small">{r.note}</div>}
            <div className="small muted">{ago(r.created_at)}{r.photos.length ? ` · ${r.photos.length} photo${r.photos.length > 1 ? 's' : ''}` : ''}{r.status === 'fixed' && r.fix_note ? ` · ${r.fix_note}` : ''}</div></div>
          <span className={'chip ' + ST[r.status][1]}>{ST[r.status][0]}</span></div></div>
      ))}
    </div>
  );
}
