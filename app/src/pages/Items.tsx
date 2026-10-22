import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useMasters, DEFAULT_QUICK, photoUrl } from '../lib/masters';
import { useSession } from '../lib/session';
import { money2, quick, errText } from '../lib/format';
import { LANGUAGES, type Item } from '../lib/types';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

interface ItemRow extends Item { item_locations: { location_id: number; par_level: number | null }[] }

export function Items() {
  const { profile, locations } = useSession();
  const { categories } = useMasters();
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState<number | 'all'>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<ItemRow | 'new' | null>(null);
  const canEdit = profile?.role === 'owner' || profile?.role === 'manager';

  async function load() {
    const { data } = await supabase.from('items').select('*, item_locations(location_id, par_level)').order('name');
    setRows((data as ItemRow[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => rows.filter((r) => (cat === 'all' || r.category_id === cat) && r.name.toLowerCase().includes(q.trim().toLowerCase())), [rows, cat, q]);
  const locName = (id: number) => locations.find((l) => l.id === id)?.name ?? '';

  return (
    <>
      <div className="pagehead">
        <div><p className="label">Masters</p><h1>Items</h1></div>
        {canEdit && <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" />Add item</button>}
      </div>
      <div className="row">
        <div className="seg" role="group" aria-label="Category">
          <button aria-pressed={cat === 'all'} onClick={() => setCat('all')}>All</button>
          {categories.map((c) => <button key={c.id} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</button>)}
        </div>
        <label style={{ marginLeft: 'auto', minWidth: 220 }}>
          <span className="label" style={{ display: 'none' }}>Search</span>
          <input id="item-search" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Item</th><th>Category</th><th>Unit</th><th>Quick amounts</th><th>Used at</th><th>Count</th><th className="r">Last cost</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={canEdit ? 'click' : ''} onClick={() => canEdit && setEditing(r)}>
                <td><strong>{r.name}</strong>{!r.active && <span className="chip off" style={{ marginLeft: 8 }}>Inactive</span>}
                  {Object.values(r.local_names ?? {}).filter(Boolean).length > 0 && <div className="small muted">{Object.values(r.local_names).join(' · ')}</div>}</td>
                <td className="small">{categories.find((c) => c.id === r.category_id)?.name}</td>
                <td>{r.unit}</td>
                <td className="small num">{(r.quick_amounts ?? []).map((n) => quick(Number(n), r.unit)).join('  ')}</td>
                <td className="small">{r.item_locations.map((l) => locName(l.location_id)).join(', ') || <span className="muted">Not set</span>}</td>
                <td className="small">{r.count_frequency === 'daily' ? 'Daily' : 'Weekly'}</td>
                <td className="r num">{money2(r.last_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && shown.length === 0 && (
          <p className="empty">{rows.length === 0 ? 'No items yet. Add the first item, or send the item list and it will be loaded for you.' : 'No items match.'}</p>
        )}
      </div>
      {editing && <ItemForm item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function ItemForm({ item, onClose, onSaved }: { item: ItemRow | null; onClose: () => void; onSaved: () => void }) {
  const { locations } = useSession();
  const { categories, units } = useMasters();
  const toast = useToast();
  const [name, setName] = useState(item?.name ?? '');
  const [categoryId, setCategoryId] = useState<number>(item?.category_id ?? 1);
  const [unit, setUnit] = useState(item?.unit ?? 'kg');
  const [purchaseUnit, setPurchaseUnit] = useState(item?.purchase_unit ?? '');
  const [factor, setFactor] = useState(item?.purchase_factor?.toString() ?? '');
  const [quickText, setQuickText] = useState((item?.quick_amounts ?? DEFAULT_QUICK[item?.unit ?? 'kg'] ?? [1]).join(', '));
  const [freq, setFreq] = useState<'daily' | 'weekly'>(item?.count_frequency ?? 'weekly');
  const [tol, setTol] = useState(String(item?.tolerance_pct ?? 5));
  const [cost, setCost] = useState(item?.last_cost?.toString() ?? '');
  const [active, setActive] = useState(item?.active ?? true);
  const [local, setLocal] = useState<Record<string, string>>(item?.local_names ?? {});
  const [locs, setLocs] = useState<Record<number, string>>(() => Object.fromEntries((item?.item_locations ?? []).map((l) => [l.location_id, l.par_level?.toString() ?? ''])));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { photoUrl(item?.photo_path ?? null).then(setPreview); }, [item]);
  useEffect(() => { if (!item) setQuickText((DEFAULT_QUICK[unit] ?? [1]).join(', ')); }, [unit, item]);

  async function save() {
    setError('');
    const quickVals = quickText.split(/[ ,]+/).filter(Boolean).map(Number);
    if (!name.trim()) return setError('Give the item a name.');
    if (quickVals.some((n) => !(n > 0))) return setError('Quick amounts must be numbers above zero, separated by commas.');
    if (purchaseUnit && !(Number(factor) > 0)) return setError(`Say how many ${unit} are in one ${purchaseUnit}.`);
    setBusy(true);
    try {
      const body = {
        name: name.trim(), category_id: categoryId, unit, purchase_unit: purchaseUnit || null,
        purchase_factor: purchaseUnit ? Number(factor) : null, quick_amounts: quickVals, count_frequency: freq,
        tolerance_pct: Number(tol) || 0, last_cost: cost === '' ? null : Number(cost), active,
        local_names: Object.fromEntries(Object.entries(local).filter(([, v]) => v.trim()))
      };
      let id = item?.id;
      if (id) {
        const { error } = await supabase.from('items').update(body).eq('id', id); if (error) throw error;
      } else {
        const { data, error } = await supabase.from('items').insert(body).select('id').single(); if (error) throw error;
        id = data.id as number;
      }
      if (file) {
        const path = `${id}/${Date.now()}.${(file.name.split('.').pop() || 'jpg').toLowerCase()}`;
        const up = await supabase.storage.from('item-photos').upload(path, file, { upsert: true });
        if (up.error) throw up.error;
        const { error } = await supabase.from('items').update({ photo_path: path }).eq('id', id); if (error) throw error;
      }
      const del = await supabase.from('item_locations').delete().eq('item_id', id); if (del.error) throw del.error;
      const rows = Object.entries(locs).map(([lid, par]) => ({ item_id: id, location_id: Number(lid), par_level: par === '' ? null : Number(par) }));
      if (rows.length) { const { error } = await supabase.from('item_locations').insert(rows); if (error) throw error; }
      toast(item ? 'Item saved' : 'Item added');
      onSaved();
    } catch (e) {
      setError(errText(e));
    } finally { setBusy(false); }
  }

  return (
    <Sheet title={item ? 'Edit item' : 'Add item'} onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save item'}</button></>}>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <div style={{ width: 96, height: 96, borderRadius: 12, background: 'var(--surface-200)', overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
          {preview ? <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="camera" size={32} />}
        </div>
        <label className="field" style={{ flex: 1 }}>
          <span>Photo staff will see</span>
          <input id="item-photo" type="file" accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f) setPreview(URL.createObjectURL(f)); }} />
          <span className="small muted">Take a clear photo of the actual item on a plain surface.</span>
        </label>
      </div>
      <label className="field"><span>Name</span><input id="item-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Curd" /></label>
      <div className="form-grid">
        <label className="field"><span>Category</span>
          <select id="item-cat" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field"><span>Counted in</span>
          <select id="item-unit" value={unit} onChange={(e) => setUnit(e.target.value)}>{units.map((u) => <option key={u.code} value={u.code}>{u.name} ({u.code})</option>)}</select></label>
        <label className="field"><span>Bought in (if different)</span>
          <select id="item-punit" value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)}><option value="">Same</option>{units.map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}</select></label>
        {purchaseUnit && <label className="field"><span>{unit} in one {purchaseUnit}</span><input id="item-factor" inputMode="decimal" value={factor} onChange={(e) => setFactor(e.target.value)} className="num" /></label>}
      </div>
      <label className="field"><span>Quick amounts (in {unit})</span>
        <input id="item-quick" value={quickText} onChange={(e) => setQuickText(e.target.value)} className="num" />
        <span className="small muted">Staff see these as one-tap buttons: {quickText.split(/[ ,]+/).filter(Boolean).map(Number).filter((n) => n > 0).map((n) => quick(n, unit)).join('  ')}</span>
      </label>
      <div className="form-grid">
        <label className="field"><span>Closing count</span>
          <select id="item-freq" value={freq} onChange={(e) => setFreq(e.target.value as 'daily' | 'weekly')}><option value="daily">Daily (key item)</option><option value="weekly">Weekly</option></select></label>
        <label className="field"><span>Allowed gap (%)</span><input id="item-tol" inputMode="decimal" value={tol} onChange={(e) => setTol(e.target.value)} className="num" /></label>
        <label className="field"><span>Last cost per {unit} (₹)</span><input id="item-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className="num" /></label>
      </div>
      <fieldset className="card" style={{ display: 'grid', gap: 10 }}>
        <legend className="label">Used at, with usual level</legend>
        {locations.map((l) => (
          <div key={l.id} className="row" style={{ justifyContent: 'space-between' }}>
            <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={l.id in locs} onChange={(e) => setLocs((p) => { const n = { ...p }; if (e.target.checked) n[l.id] = ''; else delete n[l.id]; return n; })} />{l.name}</label>
            {l.id in locs && <input aria-label={`Usual level at ${l.name}`} style={{ width: 120 }} inputMode="decimal" placeholder={`usual ${unit}`} value={locs[l.id]} onChange={(e) => setLocs((p) => ({ ...p, [l.id]: e.target.value }))} className="num" />}
          </div>
        ))}
      </fieldset>
      <fieldset className="card" style={{ display: 'grid', gap: 10 }}>
        <legend className="label">Name in other languages (optional)</legend>
        {Object.entries(LANGUAGES).map(([code, label]) => (
          <label key={code} className="row" style={{ gap: 10 }}><span className="small" style={{ width: 150 }}>{label}</span>
            <input id={`item-local-${code}`} value={local[code] ?? ''} onChange={(e) => setLocal((p) => ({ ...p, [code]: e.target.value }))} /></label>
        ))}
      </fieldset>
      <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active</label>
      {error && <p className="banner bad" role="alert">{error}</p>}
    </Sheet>
  );
}
