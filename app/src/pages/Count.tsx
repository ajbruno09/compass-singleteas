import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { useLang } from '../lib/i18n';
import { errText } from '../lib/format';
import { AvatarButton } from '../components/AvatarButton';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

interface It { id: number; name: string; local_names: Record<string, string> | null; unit: string; group_id: number | null; quick_amounts: number[] | null; count_frequency: string; base_unit?: string | null; pieceG?: number; portionKg?: number }

// Shown per kg stored: grams for weighed items, pieces for chicken counted by the piece.
const mult = (i: { unit: string; base_unit?: string | null; pieceG?: number }) => (i.pieceG ? 1000 / i.pieceG : i.unit === 'kg' && i.base_unit === 'g' ? 1000 : 1);

export function CountPage() {
  const [sp] = useSearchParams();
  const loc = Number(sp.get('loc'));
  const freq = sp.get('freq') === 'weekly' ? 'weekly' : 'daily';
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
      // Chicken portions are counted by the piece; stock stays in kg underneath.
      const ex = await supabase.from('items').select('id, pack_name, pieces_per_pack, weight_per_pack_g, details').in('id', list.map((x) => x.id));
      for (const r of ((ex.data as { id: number; pack_name: string | null; pieces_per_pack: number | null; weight_per_pack_g: number | null; details: { piece_g?: number } | null }[]) ?? [])) {
        const it = list.find((x) => x.id === r.id);
        if (it && it.unit === 'kg' && r.pack_name === 'portion' && Number(r.details?.piece_g) > 0) { it.pieceG = Number(r.details?.piece_g); it.portionKg = Number(r.weight_per_pack_g) / 1000; }
      }
      const daily = list.filter((i) => i.count_frequency === freq);
      setItems(loc === 1 && !daily.length ? list : daily);
      const { data: id, error } = await supabase.rpc('open_count', { p_location_id: loc, p_freq: freq });
      if (error) { setErr(errText(error)); return; }
      setCountId(String(id));
      const { data: st } = await supabase.from('stock_counts').select('status').eq('id', String(id)).maybeSingle();
      if ((st as { status: string } | null)?.status === 'submitted') setSentAlready(true);
      const { data: ls } = await supabase.from('stock_count_lines').select('item_id, qty').eq('count_id', String(id));
      const rows = (ls as { item_id: number; qty: number }[]) ?? [];
      const um = new Map(list.map((x) => [x.id, mult(x)]));
      setVals(Object.fromEntries(rows.map((r) => [r.item_id, String(Math.round(Number(r.qty) * (um.get(r.item_id) ?? 1) * 1000) / 1000)])));
      setSaved(Object.fromEntries(rows.map((r) => [r.item_id, true])));
    })();
  }, [loc, freq]);

  const step = (i: It) => { if (i.pieceG) return 1; const a = (i.quick_amounts ?? []).filter((n) => n > 0); return (a.length ? Math.min(...a) : 1) * mult(i); };
  const nameOf = (i: It) => (hi && i.local_names?.hi) || i.name;
  const shown = useMemo(() => items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase())), [items, q]);
  const done = items.filter((i) => saved[i.id]).length;
  const left = items.length - done;

  async function save(i: It, v: string) {
    if (!countId || v.trim() === '' || Number.isNaN(Number(v))) return;
    const { error } = await supabase.rpc('save_count_line', { p_count_id: countId, p_item_id: i.id, p_qty: Number(v) / mult(i) });
    if (error) setErr(errText(error)); else { setErr(''); setSaved((p) => ({ ...p, [i.id]: true })); }
  }
  async function send() {
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('submit_count', { p_count_id: countId });
    setBusy(false);
    if (error) return setErr(errText(error));
    toast(t('Count sent')); void data; nav(office ? '/counts' : '/closing');
  }

  if (!loc) return <div className="phone"><p>Choose a counter first.</p></div>;
  return (
    <div className="phone">
      <div className="phone-head"><button className="btn quiet" onClick={() => nav(office ? '/counts' : '/closing')}><Icon name="back" /> {t('Back')}</button><b>{freq === 'weekly' ? 'Weekly closing' : t('Closing stock')} · {place}</b><AvatarButton /></div>
      {sentAlready ? <p className="banner">{t('Today\'s count is already sent. Thank you.')}</p> : <>
        <p className="muted small">{t('Count what is left. Every item must be counted. If you have none, enter 0.')}</p>
        <div style={{ height: 8, borderRadius: 8, background: 'var(--line, #E3E8E5)', overflow: 'hidden' }}><div style={{ width: `${items.length ? (done / items.length) * 100 : 0}%`, height: '100%', background: 'var(--green, #1F6B4A)' }} /></div>
        <p className="small"><b>{done} of {items.length}</b> {t('counted')}{left > 0 ? ` · ${left} ${t('still to count')}` : ''}</p>
        <input placeholder={t('Find an item')} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="stack">{shown.map((i) => (
          <div key={i.id} className="card row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <div style={{ minWidth: 0, flex: 1 }}><b>{nameOf(i)}</b><div className={'small ' + (saved[i.id] ? 'muted' : '')} style={saved[i.id] ? undefined : { color: '#B3541E' }}>{i.pieceG ? `pieces${vals[i.id] && i.portionKg ? ` · about ${Math.round((Number(vals[i.id]) * i.pieceG / 1000 / i.portionKg) * 10) / 10} portions` : ''}` : mult(i) === 1000 ? 'g (grams, from the weighing machine)' : i.unit}{saved[i.id] ? ' · counted' : ' · not counted yet'}</div></div>
            <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <button className="qchip" aria-label="Less" onClick={() => { const n = Math.max(0, Number(vals[i.id] || 0) - step(i)); const s = String(Math.round(n * 1000) / 1000); setVals((p) => ({ ...p, [i.id]: s })); void save(i, s); }}>−</button>
              <input inputMode="decimal" className="num" style={{ width: 84, textAlign: 'center' }} aria-label={nameOf(i)} value={vals[i.id] ?? ''} onChange={(e) => { setVals((p) => ({ ...p, [i.id]: e.target.value })); setSaved((p) => { const c = { ...p }; delete c[i.id]; return c; }); }} onBlur={(e) => void save(i, e.target.value)} />
              <button className="qchip" aria-label="More" onClick={() => { const n = Number(vals[i.id] || 0) + step(i); const s = String(Math.round(n * 1000) / 1000); setVals((p) => ({ ...p, [i.id]: s })); void save(i, s); }}>+</button>
            </div>
          </div>))}</div>
        {err && <p className="banner bad" role="alert">{err}</p>}
        <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg)', paddingBottom: 8 }}>
          <button className="btn primary" style={{ width: '100%', minHeight: 52 }} disabled={busy || left > 0 || items.length === 0} onClick={send}>{busy ? t('Sending…') : left > 0 ? `${left} ${t('still to count')}` : `${t('Send count')} (${done}/${items.length})`}</button>
        </div></>}
    </div>
  );
}
