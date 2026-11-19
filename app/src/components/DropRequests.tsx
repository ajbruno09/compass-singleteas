import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AlertRow } from '../lib/types';
import { alertAge, ageText, ageClass } from '../lib/alertAge';
import { errText } from '../lib/format';
import { useToast } from './Toast';

// Owner only. Alerts the store has asked to drop. Approve closes the alert; Keep open sends it back to the store.
export function DropRequests() {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const toast = useToast();
  const load = useCallback(async () => { const { data } = await supabase.from('alerts').select('*').is('done_at', null).eq('drop_status', 'asked').order('created_at', { ascending: true }); setRows((data as AlertRow[]) ?? []); }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => { void load(); }, 30000); return () => window.clearInterval(t); }, [load]);
  async function decide(id: string, ok: boolean) {
    try { const { error } = await supabase.rpc('alert_decide_drop', { p_id: id, p_approve: ok, p_note: null }); if (error) throw error; toast(ok ? 'Dropped. It is kept in history.' : 'Kept open. The store is told.'); void load(); }
    catch (e) { toast(errText(e)); }
  }
  if (!rows.length) return null;
  return (
    <div className="card" style={{ borderLeft: '5px solid var(--warn, #9A4A06)', margin: '12px 0' }}>
      <div className="row" style={{ gap: 8 }}><b>Drop requests</b><span className="chip late">{rows.length}</span></div>
      {rows.map((a) => (
        <div key={a.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'nowrap', borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 10 }}>
          <span className={'chip ' + ageClass(alertAge(a.created_at))}>{ageText(alertAge(a.created_at))}</span>
          <div style={{ flex: 1, minWidth: 0 }}><b>{a.title}</b>{a.body && <div className="small muted">{a.body}</div>}<div className="small" style={{ marginTop: 4 }}>Store says: <i>{a.drop_reason}</i></div></div>
          <span className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}><button className="btn primary" onClick={() => void decide(a.id, true)}>Approve drop</button><button className="btn" onClick={() => void decide(a.id, false)}>Keep open</button></span>
        </div>
      ))}
    </div>
  );
}
