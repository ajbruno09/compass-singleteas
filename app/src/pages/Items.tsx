import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useMasters, DEFAULT_QUICK, photoUrl } from '../lib/masters';
import { useSession } from '../lib/session';
import { money2, quick, errText } from '../lib/format';
import { LANGUAGES, type Item } from '../lib/types';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { downloadWorkbook } from '../lib/sheets';
import { useToast } from '../components/Toast';

interface ItemRow extends Item { item_locations: { location_id: number; par_level: number | null }[] }

export function Items() {
  const { profile, locations } = useSession();
  const { categories } = useMasters();
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState<number | 'all'>('all');
  const [grp, setGrp] = useState<number | 'all'>('all');
  const [ctr, setCtr] = useState<number | 'all'>('all');
  const [groupList, setGroupList] = useState<{ id: number; name: string }[]>([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<ItemRow | 'new' | null>(null);
  const canEdit = profile?.role === 'owner' || profile?.role === 'manager';

  async function load() {
    const { data } = await supabase.from('items').select('*, item_locations(location_id, par_level)').order('name');
    setRows((data as ItemRow[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); supabase.from('item_groups').select('id, name').order('sort').then(({ data }) => setGroupList((data as { id: number; name: string }[]) ?? [])); }, []);
  const tabCats = useMemo(() => categories.filter((c) => rows.some((r) => r.category_id === c.id)), [categories, rows]);
  const groupsHere = useMemo(() => groupList.filter((g) => rows.some((r) => (cat === 'all' || r.category_id === cat) && (r as { group_id?: number | null }).group_id === g.id)), [groupList, rows, cat]);
  const ctrsHere = useMemo(() => locations.filter((l) => rows.some((r) => r.item_locations.some((x) => x.location_id === l.id))), [locations, rows]);

  const shown = useMemo(() => rows.filter((r) => (cat === 'all' || r.category_id === cat) && (grp === 'all' || (r as { group_id?: number | null }).group_id === grp) && (ctr === 'all' || r.item_locations.some((l) => l.location_id === ctr)) && r.name.toLowerCase().includes(q.trim().toLowerCase())), [rows, cat, grp, ctr, q]);
  async function exportXlsx() {
    const catName = (id: number) => categories.find((c) => c.id === id)?.name ?? '';
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    await downloadWorkbook(`Items_${day}.xlsx`, `Single Teas items, ${day}`, [`${shown.length} items${cat !== 'all' || grp !== 'all' || ctr !== 'all' || q ? ' (filtered as on screen)' : ''}.`],
      [{ name: 'Items', cols: [{ label: 'Item', width: 34 }, { label: 'Category', width: 22 }, { label: 'Unit', width: 8 }, { label: 'Counted', width: 10 }, { label: 'Used at', width: 34 }, { label: 'Last cost', width: 11 }, { label: 'Pack', width: 20 }, { label: 'Active', width: 8 }],
        rows: shown.map((r) => [r.name, catName(r.category_id), r.unit, r.count_frequency === 'daily' ? 'Daily' : 'Weekly', r.item_locations.map((l) => locName(l.location_id)).join(', '), r.last_cost ?? null, (r as { pack_note?: string }).pack_note || '', r.active ? 'Yes' : 'No']) }]);
  }
  const locName = (id: number) => locations.find((l) => l.id === id)?.name ?? '';

  return (
    <>
      <div className="pagehead">
        <div><p className="label">Masters</p><h1>Items</h1><p className="muted small" style={{ marginTop: 2 }}>{loading ? 'Loading…' : shown.length === rows.length ? `${rows.length} items${rows.some((r) => !r.photo_path) ? ` · ${rows.filter((r) => !r.photo_path).length} without a photo` : ''}` : `Showing ${shown.length} of ${rows.length} items`}</p></div>
        <div className="row"><button className="btn" onClick={exportXlsx}><Icon name="layers" />Download Excel</button>{canEdit && <Link to="/upload?tab=items" className="btn"><Icon name="layers" />Bulk upload</Link>}
        {canEdit && <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" />Add item</button>}</div>
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="seg" role="group" aria-label="Category">
          <button aria-pressed={cat === 'all'} onClick={() => { setCat('all'); setGrp('all'); }}>All</button>
          {tabCats.map((c) => <button key={c.id} aria-pressed={cat === c.id} onClick={() => { setCat(c.id); setGrp('all'); }}>{c.name} <span className="muted small">{rows.filter((r) => r.category_id === c.id).length}</span></button>)}
        </div>
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <label style={{ minWidth: 190 }}><span className="label" style={{ display: 'none' }}>Group</span>
          <select aria-label="Group" value={grp} onChange={(e) => setGrp(e.target.value === 'all' ? 'all' : Number(e.target.value))}><option value="all">Group: all</option>{groupsHere.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
        <label style={{ minWidth: 190 }}><span className="label" style={{ display: 'none' }}>Counter</span>
          <select aria-label="Counter" value={ctr} onChange={(e) => setCtr(e.target.value === 'all' ? 'all' : Number(e.target.value))}><option value="all">Counter: all</option>{ctrsHere.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
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
                  {!!profile?.extra_language && Object.values(r.local_names ?? {}).filter(Boolean).length > 0 && <div className="small muted">{Object.values(r.local_names).join(' · ')}</div>}</td>
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
  const { locations, profile } = useSession();
  const { categories, units } = useMasters();
  const toast = useToast();
  const [name, setName] = useState(item?.name ?? '');
  const [categoryId, setCategoryId] = useState<number>(item?.category_id ?? 1);
  const [groupId, setGroupId] = useState<number>((item as { group_id?: number | null } | null)?.group_id ?? 0);
  const [groupList, setGroupList] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => { supabase.from('item_groups').select('id, name').order('sort').then(({ data }) => setGroupList((data as { id: number; name: string }[]) ?? [])); }, []);
  const [unit, setUnit] = useState(item?.unit ?? 'kg');
  const [purchaseUnit, setPurchaseUnit] = useState(item?.purchase_unit ?? '');
  const [factor, setFactor] = useState(item?.purchase_factor?.toString() ?? '');
  const [quickText, setQuickText] = useState((item?.quick_amounts ?? DEFAULT_QUICK[item?.unit ?? 'kg'] ?? [1]).join(', '));
  const [freq, setFreq] = useState<'daily' | 'weekly'>(item?.count_frequency ?? 'weekly');
  const [tol, setTol] = useState(String(item?.tolerance_pct ?? 5));
  const [active, setActive] = useState(item?.active ?? true);
  const [baseUnit, setBaseUnit] = useState(item?.base_unit ?? '');
  const [packOrder, setPackOrder] = useState(Boolean(item?.show_as));
  const [countsAs, setCountsAs] = useState(item?.counts_as ?? '');
  const [packName, setPackName] = useState(item?.pack_name ?? '');
  const [packSize, setPackSize] = useState(item?.pack_size?.toString() ?? '');
  const [pieces, setPieces] = useState(item?.pieces_per_pack?.toString() ?? '');
  const [slices, setSlices] = useState(item?.slices_per_pack?.toString() ?? '');
  const [packG, setPackG] = useState(item?.weight_per_pack_g?.toString() ?? '');
  const [waste, setWaste] = useState(item?.wastage_pct?.toString() ?? '');
  const [local, setLocal] = useState<Record<string, string>>(item?.local_names ?? {});
  const [locs, setLocs] = useState<Record<number, string>>(() => Object.fromEntries((item?.item_locations ?? []).map((l) => [l.location_id, l.par_level?.toString() ?? ''])));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { photoUrl(item?.photo_path ?? null).then(setPreview); }, [item]);
  useEffect(() => { if (!item) setQuickText((DEFAULT_QUICK[unit] ?? [1]).join(', ')); }, [unit, item]);

  async function remove() {
    if (!item) return;
    if (!window.confirm(`Delete "${item.name}" for good? This cannot be undone. Any opening stock entered for it will be removed too.`)) return;
    setBusy(true); setError('');
    const { error } = await supabase.rpc('delete_item', { p_id: item.id });
    setBusy(false);
    if (error) return setError(errText(error));
    toast('Item deleted'); onSaved();
  }

  async function save() {
    setError('');
    const quickVals = quickText.split(/[ ,]+/).filter(Boolean).map(Number);
    if (!name.trim()) return setError('Give the item a name.');
    if (quickVals.some((n) => !(n > 0))) return setError('Quick amounts must be numbers above zero, separated by commas.');
    if (purchaseUnit && !(Number(factor) > 0)) return setError(`Say how many ${unit} are in one ${purchaseUnit}.`);
    setBusy(true);
    try {
      const body = {
        name: name.trim(), category_id: categoryId, group_id: groupId || null, unit, purchase_unit: purchaseUnit || null,
        purchase_factor: purchaseUnit ? Number(factor) : null, quick_amounts: quickVals, count_frequency: freq,
        tolerance_pct: Number(tol) || 0, active,
        show_as: purchaseUnit && packOrder ? purchaseUnit : null, base_unit: baseUnit || null, counts_as: countsAs || null, pack_name: packName || null,
        pack_size: packSize === '' ? null : Number(packSize), pieces_per_pack: pieces === '' ? null : Number(pieces),
        slices_per_pack: slices === '' ? null : Number(slices), weight_per_pack_g: packG === '' ? null : Number(packG),
        wastage_pct: waste === '' ? null : Number(waste),
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
      footer={<>{item && profile?.role === 'owner' && <button className="btn quiet" style={{ color: '#B42335', marginRight: 'auto' }} disabled={busy} onClick={remove}><Icon name="trash" /> Delete item</button>}<button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save item'}</button></>}>
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
          <select id="item-cat" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>{categories.filter((c) => c.id === categoryId || !['chemicals', 'safety', 'guest_supplies', 'durables'].includes(c.code ?? '')).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field"><span>Shelf group (where it shows in Stock in hand)</span>
          <select id="item-group" value={groupId} onChange={(e) => setGroupId(Number(e.target.value))}><option value={0}>No group yet</option>{groupList.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
        <label className="field"><span>Counted in</span>
          <select id="item-unit" value={unit} onChange={(e) => setUnit(e.target.value)}>{units.map((u) => <option key={u.code} value={u.code}>{u.name} ({u.code})</option>)}</select></label>
        <label className="field"><span>Bought in (if different)</span>
          <select id="item-punit" value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)}><option value="">Same</option>{units.map((u) => <option key={u.code} value={u.code}>{u.name} ({u.code})</option>)}</select></label>
        {purchaseUnit && <label className="field"><span>{unit} in one {purchaseUnit}</span><input id="item-factor" inputMode="decimal" value={factor} onChange={(e) => setFactor(e.target.value)} className="num" /></label>}
        {purchaseUnit && <label className="row" style={{ gap: 8, gridColumn: '1 / -1' }}><input type="checkbox" checked={packOrder} onChange={(e) => setPackOrder(e.target.checked)} />Counters order, and the store issues and stocks, in {purchaseUnit}s (the closing count stays in {unit})</label>}
      </div>
      <h2 style={{ marginTop: 8 }}>Stock details</h2>
      <p className="small muted">Optional. Leave anything blank and Compass simply shows “Not set yet”. You can fill these in later.</p>
      <div className="form-grid">
        <label className="field"><span>Stored and issued in</span>
          <select id="item-base" value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)}><option value="">Not set yet</option>{units.map((u) => <option key={u.code} value={u.code}>{u.name} ({u.code})</option>)}</select></label>
        <label className="field"><span>Counted how</span>
          <select id="item-counts" value={countsAs} onChange={(e) => setCountsAs(e.target.value)}><option value="">Not set yet</option>{['By weight', 'By volume', 'By count', 'Whole packs only'].map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
        <label className="field"><span>Pack name</span><input id="item-packname" value={packName} onChange={(e) => setPackName(e.target.value)} placeholder="e.g. Packet, Pouch, Tub" /></label>
        <label className="field"><span>Pack size (in the unit above)</span><input id="item-packsize" inputMode="decimal" className="num" value={packSize} onChange={(e) => setPackSize(e.target.value)} /></label>
        <label className="field"><span>Pieces in a pack</span><input id="item-pieces" inputMode="decimal" className="num" value={pieces} onChange={(e) => setPieces(e.target.value)} /></label>
        <label className="field"><span>Slices in a pack</span><input id="item-slices" inputMode="decimal" className="num" value={slices} onChange={(e) => setSlices(e.target.value)} /></label>
        <label className="field"><span>Weight of a pack (g)</span><input id="item-packg" inputMode="decimal" className="num" value={packG} onChange={(e) => setPackG(e.target.value)} /></label>
        <label className="field"><span>Wastage allowed (%)</span><input id="item-waste" inputMode="decimal" className="num" value={waste} onChange={(e) => setWaste(e.target.value)} /></label>
      </div>
      <label className="field"><span>Quick amounts (in {unit})</span>
        <input id="item-quick" value={quickText} onChange={(e) => setQuickText(e.target.value)} className="num" />
        <span className="small muted">Staff see these as one-tap buttons: {quickText.split(/[ ,]+/).filter(Boolean).map(Number).filter((n) => n > 0).map((n) => quick(n, unit)).join('  ')}</span>
      </label>
      <div className="form-grid">
        <label className="field"><span>Closing count</span>
          <select id="item-freq" value={freq} onChange={(e) => setFreq(e.target.value as 'daily' | 'weekly')}><option value="daily">Daily (key item)</option><option value="weekly">Weekly</option></select></label>
        <label className="field"><span>Allowed gap (%)</span><input id="item-tol" inputMode="decimal" value={tol} onChange={(e) => setTol(e.target.value)} className="num" /></label>
        <div className="field"><span>Price</span><span className="small muted">Set in Buying setup and prices, where it also follows the bills.</span></div>
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
      <details className="card langs" open={Object.values(local).some((v) => v)}>
        <summary className="label" style={{ cursor: 'pointer' }}>Name in other languages (optional){Object.values(local).filter((v) => v).length > 0 ? ` · ${Object.values(local).filter((v) => v).length} filled` : ''}</summary>
        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          {Object.entries(LANGUAGES).map(([code, label]) => (
            <label key={code} className="row" style={{ gap: 10 }}><span className="small" style={{ width: 150 }}>{label}</span>
              <input id={`item-local-${code}`} value={local[code] ?? ''} onChange={(e) => setLocal((p) => ({ ...p, [code]: e.target.value }))} /></label>
          ))}
        </div>
      </details>
      <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active</label>
      {error && <p className="banner bad" role="alert">{error}</p>}
    </Sheet>
  );
}
