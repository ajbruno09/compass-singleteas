import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { useLang } from '../lib/i18n';
import { errText } from '../lib/format';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

interface It { id: number; name: string; local_names: Record<string, string> | null; unit: string; group_id: number | null; quick_amounts: number[] | null; count_frequency: string }

export function CountPage() {
  const [sp] = useSearchParams();
  const loc = Number(sp.get('loc'));
  const { locations, profile } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const { t, hi } = useLang();
  const [items, setItems] = useState<It[]>([]);
  const [countId, setCountId] = useState('');
  const [vals, setVals] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState<Record<number, boolean>>({});
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sentAlready, setSentAlready] = useState(false);
  const place = locations.find((l) => l.id === loc)?.name ?? '';
  const office = profile?.role === 'owner' || profile?.role === 'store' || profile?.role === 'manager';

  useEffect(() => {
    if (!loc) return;
    (async () => {
      let list: It[] = [];
      if (loc === 1) {
        const { data } = await supabase.from('items').select('id, name, local_names, unit, group_id, quick_amounts, count_frequency').eq('active', true).order('name');
        list = (data as It[]) ?? [];
      } else {
        const { data } = await supabase.rpc('department_items', { p_location_id: loc });
        list = ((data as It[]) ?? []);
      }
      const daily = list.filter((i) => i.count_frequency === 'daily');
      setItems(daily.length ? daily : list);
      const { data: id, error } = await supabase.rpc('open_count', { p_location_id: loc, p_freq: 'daily' });
      if (error) { setErr(errText(error)); return; }
      setCountId(String(id));
      const { data: st } = await supabase.from('stock_counts').select('status').eq('id', String(id)).maybeSingle();
      if ((st as { status: string } | null)?.status === 'submitted') setSentAlready(true);
      const { data: ls } = await supabase.from('stock_count_lines').select('item_id, qty').eq('count_id', String(id));
      const rows = (ls as { item_id: number; qty: number }[]) ?? [];
      setVals(Object.fromEntries(rows.map((r) => [r.item_id, String(Number(r.qty))])));
      setSaved(Object.fromEntries(rows.map((r) => [r.item_id, true])));
    })();
  }, [loc]);

  const step = (i: It) => { const a = (i.quick_amounts ?? []).filter((n) => n > 0); return a.length ? Math.min(...a) : 1; };
  const nameOf = (i: It) => (hi && i.local_names?.hi) || i.name;
  const shown = useMemo(() => items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase())), [items, q]);
  const done = Object.keys(saved).length;

  async function save(i: It, v: string) {
    if (!countId || v.trim() === '' || Number.isNaN(Number(v))) return;
    const { error } = await supabase.rpc('save_count_line', { p_count_id: countId, p_item_id: i.id, p_qty: Number(v) });
    if (error) setErr(errText(error)); else { setErr(''); setSaved((p) => ({ ...p, [i.id]: true })); }
  }
  async function send() {
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('submit_count', { p_count_id: countId });
    setBusy(false);
    if (error) return setErr(errText(error));
    toast(t('Count sent')); void data; nav(office ? '/counts' : '/');
  }

  if (!loc) return <div className="phone"><p>Choose a counter first.</p></div>;
  return (
    <div className="phone">
      <div className="phone-head"><button className="btn quiet" onClick={() => nav(office ? '/counts' : '/')}><Icon name="back" /> {t('Back')}</button><b>{t('Closing stock')} · {place}</b></div>
      {sentAlready ? <p className="banner">{t('Today\'s count is already sent. Thank you.')}</p> : <>
        <p className="muted small">{t('Count what is left. Type the number for each item. Leave out only what you do not have.')}</p>
        <input placeholder={t('Find an item')} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="stack">{shown.map((i) => (
          <div key={i.id} className="card row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <div style={{ minWidth: 0, flex: 1 }}><b>{nameOf(i)}</b><div className="small muted">{i.unit}{saved[i.id] ? ' · saved' : ''}</div></div>
            <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <button className="qchip" aria-label="Less" onClick={() => { const n = Math.max(0, Number(vals[i.id] || 0) - step(i)); const s = String(Math.round(n * 1000) / 1000); setVals((p) => ({ ...p, [i.id]: s })); void save(i, s); }}>−</button>
              <input inputMode="decimal" className="num" style={{ width: 84, textAlign: 'center' }} aria-label={nameOf(i)} value={vals[i.id] ?? ''} onChange={(e) => { setVals((p) => ({ ...p, [i.id]: e.target.value })); setSaved((p) => { const c = { ...p }; delete c[i.id]; return c; }); }} onBlur={(e) => void save(i, e.target.value)} />
              <button className="qchip" aria-label="More" onClick={() => { const n = Number(vals[i.id] || 0) + step(i); const s = String(Math.round(n * 1000) / 1000); setVals((p) => ({ ...p, [i.id]: s })); void save(i, s); }}>+</button>
            </div>
          </div>))}</div>
        {err && <p className="banner bad" role="alert">{err}</p>}
        <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg)', paddingBottom: 8 }}>
          <button className="btn primary" style={{ width: '100%', minHeight: 52 }} disabled={busy || done === 0} onClick={send}>{busy ? t('Sending…') : `${t('Send count')} (${done}/${items.length})`}</button>
        </div></>}
    </div>
  );
}
