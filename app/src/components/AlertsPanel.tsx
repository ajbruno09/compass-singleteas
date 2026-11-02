import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AlertRow } from '../lib/types';
import { timeOf } from '../lib/ist';

const ORDER = { urgent: 0, today: 1, fyi: 2 } as const;
const LABEL = { urgent: 'Urgent', today: 'Needs action today', fyi: 'For your information' } as const;
const CHIP = { urgent: 'flag', today: 'late', fyi: 'off' } as const;

// Things that need attention, most urgent first. Each has a Done button so nothing just sits there.
export function AlertsPanel() {
  const [rows, setRows] = useState<AlertRow[]>([]);
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
          <button className="btn secondary" onClick={() => void done(a.id)}>Done</button>
        </div>
      ))}
    </section>
  );
}
