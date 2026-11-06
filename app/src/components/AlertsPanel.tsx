import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { AlertRow } from '../lib/types';
import { timeOf } from '../lib/ist';

const ORDER = { urgent: 0, today: 1, fyi: 2 } as const;
const LABEL = { urgent: 'Urgent', today: 'Needs action today', fyi: 'For your information' } as const;
const CHIP = { urgent: 'flag', today: 'late', fyi: 'off' } as const;

// Where to go to look at the problem, by what raised the alert.
const GO: Record<string, { to: string; label: string }> = {
  issue: { to: '/issue', label: 'Open issues' }, count: { to: '/counts', label: 'Open counts' }, maint: { to: '/maintenance', label: 'Open maintenance' },
  indent: { to: '/indents', label: 'Open indents' }, sos: { to: '/sos', label: 'Open SOS' }, buying: { to: '/buying', label: 'Open buying' }, receive: { to: '/receive', label: 'Open receiving' }
};
const guess = (a: { source: string; title: string }) => GO[a.source] ?? (/indent/i.test(a.title) ? GO.indent : /sos/i.test(a.title) ? GO.sos : /maint|overdue|due/i.test(a.title) ? GO.maint : /count/i.test(a.title) ? GO.count : /issue|received/i.test(a.title) ? GO.issue : null);

// Things that need attention, most urgent first. Open takes you to the problem; Done clears it once it is sorted.
export function AlertsPanel() {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const nav = useNavigate();
  const load = useCallback(async () => {
    const { data } = await supabase.from('alerts').select('*').is('done_at', null).order('created_at', { ascending: false }).limit(30);
    setRows(((data as AlertRow[]) ?? []).sort((a, b) => ORDER[a.level] - ORDER[b.level]));
  }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => { void load(); }, 30000); return () => window.clearInterval(t); }, [load]);
  if (!rows.length) return null;
  async function done(id: string) { setRows((r) => r.filter((x) => x.id !== id)); await supabase.rpc('finish_alert', { p_id: id }); }
  return (
    <section className="card" style={{ display: 'grid', gap: 10 }} aria-label="Needs attention">
      <h2>Needs attention</h2>
      {rows.map((a) => (
        <div key={a.id} className="row" style={{ justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}><span className={'chip ' + CHIP[a.level]}>{LABEL[a.level]}</span><b>{a.title}</b></div>
            {a.body && <p className="small muted">{a.body} · {timeOf(a.created_at)}</p>}
          </div>
          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            {guess(a) && <button className="btn primary" onClick={() => nav(guess(a)!.to)}>{guess(a)!.label}</button>}
            <button className="btn secondary" onClick={() => void done(a.id)}>Done</button>
          </span>
        </div>
      ))}
    </section>
  );
}
