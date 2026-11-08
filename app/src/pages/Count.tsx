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
const CAT_PHOTO: Record<number, string> = { 1: 'veg', 2: 'dairy', 3: 'chicken', 4: 'atta', 5: 'spices', 6: 'sauces', 7: 'frozen', 17: 'kitchen', 9: 'bread', 10: 'drinks', 11: 'icecream', 12: 'packaging', 13: 'cleaning', 14: 'gas', 15: 'stationery', 16: 'dryfruits' };
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
  const [grp, setGrp] = useState<number | null>(null);
  const [groups, setGroups] = useState<{ id: number; name: string; icon: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sentAlready, setSentAlready] = useState(false);
  const place = locations.find((l) => l.id === loc)?.name ?? '';
  const office = profile?.role === 'owner' || profile?.role === 'store' || profile?.role === 'manager';

  useEffect(() => { supabase.from('item_groups').select('id, name, icon').order('sort').then(({ data }) => setGroups((data as typeof groups) ?? [])); }, []);
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
  const tiles = useMemo(() => {
    const ids = [...new Set(items.map((i) => i.group_id ?? 0))];
    return ids.map((id) => ({ id, name: groups.find((g) => g.id === id)?.name ?? 'Other', icon: groups.find((g) => g.id === id)?.icon ?? null, list: items.filter((i) => (i.group_id ?? 0) === id) }))
      .sort((a, b) => (groups.findIndex((g) => g.id === a.id) + 1 || 99) - (groups.findIndex((g) => g.id === b.id) + 1 || 99));
  }, [items, groups]);
  const cur = tiles.find((x) => x.id === grp) ?? null;
  const shown = cur?.list ?? [];
  const nextTile = cur ? tiles[tiles.findIndex((x) => x.id === cur.id) + 1] : undefined;
  const chipsOf = (i: It) => i.pieceG ? [1, 5, 10] : (i.quick_amounts ?? []).filter((n) => n > 0).map((n) => n * mult(i));
  const chipLabel = (n: number, i: It) => `+${Math.round(n * 1000) / 1000}${i.pieceG ? '' : mult(i) === 1000 ? ' g' : i.unit === 'L' && n < 1 ? ' L' : ''}`;
  const put = (i: It, n: number) => { const sv = String(Math.round(Math.max(0, n) * 1000) / 1000); setVals((p) => ({ ...p, [i.id]: sv })); void save(i, sv); };
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
        {!cur ? (
          <div className="groupgrid" style={{ marginTop: 8 }}>{tiles.map((g) => { const n = g.list.filter((i) => saved[i.id]).length; const all = n === g.list.length; return (
            <button key={g.id} className="grouptile" onClick={() => setGrp(g.id)}>
              <span className="badge" style={all ? { background: 'var(--green, #1F6B4A)', color: '#fff' } : undefined}>{all ? '✓' : `${n}/${g.list.length}`}</span>
              <span className="gphoto">{CAT_PHOTO[g.id] ? <img src={`/cats/${CAT_PHOTO[g.id]}.jpg`} alt="" loading="lazy" /> : <span className="emoji">{g.icon || '🧾'}</span>}</span>
              <span className="gtext"><span className="gname">{g.name}</span><span className="small muted">{g.list.length} {g.list.length === 1 ? t('item') : t('items')}{all ? ` · ${t('done')}` : ''}</span></span>
            </button>); })}</div>
        ) : (
          <>
            <button className="btn quiet" style={{ justifySelf: 'start' }} onClick={() => setGrp(null)}><Icon name="back" /> {cur.name} · {shown.filter((i) => saved[i.id]).length}/{shown.length}</button>
            <div className="stack">{shown.map((i) => (
              <div key={i.id} className="card" style={saved[i.id] ? undefined : { borderColor: '#F3B48E' }}>
                <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                  <div style={{ minWidth: 0, flex: 1 }}><b>{nameOf(i)}</b><div className={'small ' + (saved[i.id] ? 'muted' : '')} style={saved[i.id] ? undefined : { color: '#B3541E' }}>{i.pieceG ? `pieces${vals[i.id] && i.portionKg ? ` · about ${Math.round((Number(vals[i.id]) * i.pieceG / 1000 / i.portionKg) * 10) / 10} portions` : ''}` : mult(i) === 1000 ? 'g (grams, from the weighing machine)' : i.unit}{saved[i.id] ? ' · counted' : ' · not counted yet'}</div></div>
                  <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                    <button className="qchip" aria-label="Less" onClick={() => put(i, Number(vals[i.id] || 0) - step(i))}>−</button>
                    <input inputMode="decimal" className="num" style={{ width: 84, textAlign: 'center' }} aria-label={nameOf(i)} value={vals[i.id] ?? ''} onChange={(e) => { setVals((p) => ({ ...p, [i.id]: e.target.value })); setSaved((p) => { const c = { ...p }; delete c[i.id]; return c; }); }} onBlur={(e) => void save(i, e.target.value)} />
                    <button className="qchip" aria-label="More" onClick={() => put(i, Number(vals[i.id] || 0) + step(i))}>+</button>
                  </div>
                </div>
                <div className="chips">{chipsOf(i).map((n) => <button key={n} className="qchip" onClick={() => put(i, Number(vals[i.id] || 0) + n)}>{chipLabel(n, i)}</button>)}
                  <button className="qchip" style={{ marginLeft: 'auto' }} onClick={() => put(i, 0)}>{t('None left (0)')}</button></div>
              </div>))}</div>
            {shown.every((i) => saved[i.id]) && nextTile && <button className="btn primary" style={{ width: '100%', minHeight: 48 }} onClick={() => setGrp(nextTile.id)}>{t('Next')}: {nextTile.name} ›</button>}
            {shown.every((i) => saved[i.id]) && !nextTile && <button className="btn secondary" style={{ width: '100%', minHeight: 48 }} onClick={() => setGrp(null)}>{t('Back to categories')}</button>}
          </>
        )}
        {err && <p className="banner bad" role="alert">{err}</p>}
        <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg)', paddingBottom: 8 }}>
          <button className="btn primary" style={{ width: '100%', minHeight: 52 }} disabled={busy || left > 0 || items.length === 0} onClick={send}>{busy ? t('Sending…') : left > 0 ? `${left} ${t('still to count')}` : `${t('Send count')} (${done}/${items.length})`}</button>
        </div></>}
    </div>
  );
}
