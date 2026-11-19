import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { AlertRow } from '../lib/types';
import { routeForAlert } from '../lib/alertRoutes';
import { loadCountDetail, countDetailHtml } from '../lib/countDetail';
import { alertAge, ageText, ageClass, DROP_AFTER } from '../lib/alertAge';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { useToast } from './Toast';
import { Sheet } from './Sheet';

type Filter = 'all' | 'old' | 'wait';

// Things that need attention, oldest first so nothing is forgotten. Fix it takes you to the problem.
// An item open for more than 5 days can be sent to the owner to drop, with a reason.
export function AlertsPanel() {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const nav = useNavigate();
  const toast = useToast();
  const { profile } = useSession();
  const canDone = profile?.role === 'owner' || profile?.role === 'manager';
  const [detail, setDetail] = useState<string | null>(null);
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('alerts-open') !== '0'; } catch { return true; } });
  const [filter, setFilter] = useState<Filter>('all');
  const [dropFor, setDropFor] = useState<AlertRow | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  async function openCount(id: string) { const d = await loadCountDetail(id); if (!d) { nav('/counts'); return; } setDetail(countDetailHtml(d)); }
  const load = useCallback(async () => {
    const { data } = await supabase.from('alerts').select('*').is('done_at', null).order('created_at', { ascending: true }).limit(100);
    setRows((data as AlertRow[]) ?? []);
  }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => { void load(); }, 30000); return () => window.clearInterval(t); }, [load]);
  if (!rows.length) return null;
  const aged = rows.map((a) => ({ a, age: alertAge(a.created_at) })).sort((x, y) => y.age - x.age);
  const old = aged.filter((x) => x.age > DROP_AFTER).length;
  const waiting = aged.filter((x) => x.a.drop_status === 'asked').length;
  const shown = aged.filter((x) => filter === 'all' || (filter === 'old' && x.age > DROP_AFTER) || (filter === 'wait' && x.a.drop_status === 'asked'));
  function toggle() { const v = !open; setOpen(v); try { localStorage.setItem('alerts-open', v ? '1' : '0'); } catch { /* ignore */ } }
  async function done(id: string) { setRows((r) => r.filter((x) => x.id !== id)); await supabase.rpc('finish_alert', { p_id: id }); }
  async function sendDrop() {
    if (!dropFor) return; setBusy(true);
    try { const { error } = await supabase.rpc('alert_ask_drop', { p_id: dropFor.id, p_reason: why }); if (error) throw error; toast('Sent to the owner. It stays here until he approves.'); setDropFor(null); setWhy(''); void load(); }
    catch (e) { toast(errText(e)); } finally { setBusy(false); }
  }
  const chip = (k: Filter, label: string) => <button key={k} className={'btn' + (filter === k ? ' primary' : '')} style={{ padding: '2px 10px' }} onClick={() => setFilter(k)}>{label}</button>;
  return (
    <section className="card" style={{ display: 'grid', gap: 0, padding: 0 }} aria-label="Needs attention">
      <button className="row" onClick={toggle} aria-expanded={open} style={{ gap: 10, padding: '12px 14px', width: '100%', border: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer' }}>
        <span style={{ display: 'inline-block', transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
        <b style={{ fontSize: 16 }}>Needs attention</b>
        <span className="chip flag" style={{ minWidth: 26, textAlign: 'center' }}>{rows.length}</span>
        <span className="small muted">{old ? `${old} older than ${DROP_AFTER} days` : `Nothing older than ${DROP_AFTER} days`}</span>
        <span className="small muted" style={{ marginLeft: 'auto' }}>{open ? 'Tap to hide' : 'Tap to see'}</span>
      </button>
      {open && (
        <div style={{ display: 'grid', gap: 10, padding: '0 14px 14px' }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{chip('all', `All (${rows.length})`)}{chip('old', `Older than ${DROP_AFTER} days (${old})`)}{chip('wait', `Waiting for owner (${waiting})`)}</div>
          {!shown.length && <p className="small muted">Nothing here.</p>}
          {shown.map(({ a, age }) => {
            const r = routeForAlert(a);
            const asked = a.drop_status === 'asked';
            return (
              <div key={a.id} className="row" style={{ justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'nowrap', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                <span className={'chip ' + ageClass(age)} style={{ flexShrink: 0 }}>{ageText(age)}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row" style={{ gap: 8 }}><b>{a.title}</b>{asked && <span className="chip due">Waiting for owner</span>}</div>
                  {a.body && <p className="small muted">{a.body}</p>}
                  {a.drop_status === 'kept' && <p className="small" style={{ color: 'var(--warn)' }}>Owner says keep it open{a.drop_note ? ': ' + a.drop_note : ''}</p>}
                </div>
                <span className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {a.source === 'count' ? <button className="btn primary" onClick={() => void openCount(a.id)}>See items</button> : r && <button className="btn primary" onClick={() => nav(r.to)}>{r.label}</button>}
                  {!asked && age > DROP_AFTER && !canDone && <button className="btn" onClick={() => { setDropFor(a); setWhy(''); }}>Ask to drop</button>}
                  {canDone && <button className="btn secondary" onClick={() => void done(a.id)}>Done</button>}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {detail && <Sheet title="Counted higher than the books" onClose={() => setDetail(null)}><div dangerouslySetInnerHTML={{ __html: detail }} /></Sheet>}
      {dropFor && (
        <Sheet title="Ask the owner to drop this" onClose={() => setDropFor(null)} footer={<button className="btn primary" disabled={busy || why.trim().length < 4} onClick={() => void sendDrop()}>{busy ? 'Sending…' : 'Send to owner for approval'}</button>}>
          <p className="small muted">{dropFor.title}. Open for {alertAge(dropFor.created_at)} days.</p>
          <label className="field"><span>Why can this be dropped?</span><textarea rows={3} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="For example: it was never made that day, the kitchen confirmed." /></label>
        </Sheet>
      )}
    </section>
  );
}
