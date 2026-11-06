import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { errText } from '../lib/format';
import type { IndentReason } from '../lib/types';
import { useToast } from '../components/Toast';

// Admin keeps two short lists: why a quantity is above usual, and why an indent was missed.
export function IndentReasons() {
  const toast = useToast();
  const [rows, setRows] = useState<IndentReason[]>([]);
  const [fresh, setFresh] = useState<{ more: string; missed: string }>({ more: '', missed: '' });
  const load = useCallback(async () => { const { data } = await supabase.from('indent_reasons').select('*').order('sort'); setRows((data as IndentReason[]) ?? []); }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(id: number | null, kind: 'more' | 'missed', label: string, active: boolean) {
    const { error } = await supabase.rpc('save_indent_reason', { p_id: id, p_kind: kind, p_label: label, p_active: active });
    if (error) { toast(errText(error)); return; }
    if (id == null) setFresh((f) => ({ ...f, [kind]: '' }));
    void load();
  }
  const block = (kind: 'more' | 'missed', title: string, help: string) => (
    <section className="card" style={{ display: 'grid', gap: 10, maxWidth: 640 }}>
      <div><b>{title}</b><p className="muted small" style={{ margin: '2px 0 0' }}>{help}</p></div>
      {rows.filter((r) => r.kind === kind).map((r) => (
        <div key={r.id} className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <input aria-label="Reason" defaultValue={r.label} maxLength={60} style={{ flex: 1, opacity: r.active ? 1 : 0.5 }} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.label) void save(r.id, kind, v, r.active); }} />
          <button className="btn secondary" onClick={() => void save(r.id, kind, r.label, !r.active)}>{r.active ? 'Hide' : 'Show again'}</button>
        </div>
      ))}
      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
        <input aria-label="New reason" placeholder="Add a reason" maxLength={60} style={{ flex: 1 }} value={fresh[kind]} onChange={(e) => setFresh((f) => ({ ...f, [kind]: e.target.value }))} />
        <button className="btn primary" disabled={!fresh[kind].trim()} onClick={() => void save(null, kind, fresh[kind], true)}>Add</button>
      </div>
    </section>
  );
  return (
    <>
      <div className="pagehead"><div><p className="label">Indent</p><h1>Indent reasons</h1></div></div>
      <p className="muted">Keep each list short, three or four is best. Hidden reasons stay on old indents but are not offered any more.</p>
      <div className="stack">
        {block('more', 'When a quantity is more than usual', 'The counter must pick one of these before sending.')}
        {block('missed', 'When an indent was missed', 'The counter picks one when asking you to open a closed indent.')}
      </div>
    </>
  );
}
