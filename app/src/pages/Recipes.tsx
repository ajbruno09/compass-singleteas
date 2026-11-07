import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText, money2 } from '../lib/format';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { recipePreview, recipeTemplate } from './Upload';

interface Dish { id: number; name: string; price: number | null; status: string }
interface Itm { id: number; name: string; unit: string; last_cost: number | null }
interface Line { item_id: number; qty: string; waste: string; note: string }

export function Recipes() {
  const { profile } = useSession();
  const toast = useToast();
  const canEdit = profile?.role === 'owner' || profile?.role === 'manager';
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [items, setItems] = useState<Itm[]>([]);
  const [have, setHave] = useState<Record<number, number>>({});
  const [sel, setSel] = useState<number | ''>('');
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState('');
  const [portions, setPortions] = useState('1');
  const [find, setFind] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const loadAll = useCallback(async () => {
    const [d, i, r] = await Promise.all([supabase.from('menu_items').select('id, name, price, status').eq('status', 'active').order('name').limit(3000), supabase.from('items').select('id, name, unit, last_cost').eq('active', true).order('name'), supabase.from('recipes').select('menu_item_id, recipe_lines(id)')]);
    setDishes((d.data as Dish[]) ?? []); setItems((i.data as Itm[]) ?? []);
    setHave(Object.fromEntries(((r.data ?? []) as { menu_item_id: number; recipe_lines: unknown[] }[]).map((x) => [x.menu_item_id, x.recipe_lines.length])));
  }, []);
  useEffect(() => { void loadAll(); }, [loadAll]);

  const loadRecipe = useCallback(async (id: number) => {
    const { data } = await supabase.from('recipes').select('portion_size, portions, note, recipe_lines(item_id, qty, wastage_pct, note, sort)').eq('menu_item_id', id).maybeSingle();
    const r = data as { portion_size: string; portions: number; recipe_lines: { item_id: number; qty: number; wastage_pct: number | null; note: string; sort: number }[] } | null;
    setSize(r?.portion_size ?? ''); setPortions(String(r?.portions ?? 1));
    setLines((r?.recipe_lines ?? []).sort((a, b) => a.sort - b.sort).map((l) => ({ item_id: l.item_id, qty: String(l.qty), waste: l.wastage_pct == null ? '' : String(l.wastage_pct), note: l.note })));
    setMsg('');
  }, []);
  useEffect(() => { if (sel !== '') void loadRecipe(sel); else setLines([]); }, [sel, loadRecipe]);

  const dish = dishes.find((d) => d.id === sel);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const matches = useMemo(() => find.trim().length < 2 ? [] : items.filter((i) => i.name.toLowerCase().includes(find.toLowerCase()) && !lines.some((l) => l.item_id === i.id)).slice(0, 8), [find, items, lines]);
  const cost = useMemo(() => { const p = Number(portions) || 1; return lines.reduce((s, l) => s + (Number(l.qty) || 0) * (1 + (Number(l.waste) || 0) / 100) * (byId.get(l.item_id)?.last_cost ?? 0), 0) / p; }, [lines, portions, byId]);
  const missingCost = lines.filter((l) => !byId.get(l.item_id)?.last_cost).length;
  const shown = dishes.filter((d) => !onlyMissing || !have[d.id]);

  async function save() {
    if (sel === '') return; setBusy(true); setMsg('');
    const { error } = await supabase.rpc('save_recipe', { p_menu_item_id: sel, p_portion_size: size, p_portions: Number(portions) || 1, p_note: '', p_lines: lines.map((l) => ({ item_id: l.item_id, qty: Number(l.qty), waste: l.waste, note: l.note })) });
    setBusy(false); if (error) return setMsg(errText(error));
    toast('Recipe saved'); void loadAll();
  }
  async function upload(f: File | undefined) {
    if (!f || !dish) return; setBusy(true); setMsg('');
    try { const p = await recipePreview(f, dish.name); if (p.problems.length) setMsg(p.problems.slice(0, 5).join(' | ')); if (p.good) { const r = await p.apply(); toast(r); await loadAll(); await loadRecipe(dish.id); } }
    catch (e) { setMsg(errText(e)); } finally { setBusy(false); if (file.current) file.current.value = ''; }
  }

  return (
    <>
      <div className="pagehead"><div><p className="label">Masters</p><h1>Recipes</h1><p className="muted small" style={{ marginTop: 2 }}>{Object.keys(have).length} of {dishes.length} active dishes have a recipe. Snack recipes (samosas, cutlets, spring rolls) are under Snacks production, Recipes tab.</p></div>
        <Link to="/upload?tab=recipes" className="btn"><Icon name="layers" /> Bulk upload all recipes</Link></div>
      <div className="row">
        <label className="field" style={{ minWidth: 300, flex: 1 }}><span>Choose a dish</span>
          <select value={sel} onChange={(e) => setSel(e.target.value ? Number(e.target.value) : '')}><option value="">Select…</option>{shown.map((d) => <option key={d.id} value={d.id}>{d.name}{have[d.id] ? ` · ${have[d.id]} lines` : ' · no recipe'}</option>)}</select></label>
        <label className="row small" style={{ gap: 6, alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Only dishes without a recipe</label>
      </div>
      {dishes.length === 0 && <p className="empty card">No menu yet. Add dishes first on the Bulk upload page, Menu tab.</p>}
      {dish && (
        <section className="card" style={{ display: 'grid', gap: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div><h2>{dish.name}</h2><p className="small muted">Selling price {money2(dish.price)}</p></div>
            <div className="row">
              <button className="btn" disabled={busy} onClick={() => void recipeTemplate(dish.name)}><Icon name="receipt" /> Template for this dish</button>
              {canEdit && <label className="btn" style={{ cursor: 'pointer' }}><Icon name="plus" /> Upload recipe<input ref={file} type="file" accept=".xlsx" hidden onChange={(e) => void upload(e.target.files?.[0])} /></label>}
            </div>
          </div>
          <div className="form-grid">
            <label className="field"><span>Portion size (for example 250 ml, 1 plate)</span><input value={size} onChange={(e) => setSize(e.target.value)} disabled={!canEdit} /></label>
            <label className="field"><span>Portions this recipe makes</span><input inputMode="decimal" className="num" value={portions} onChange={(e) => setPortions(e.target.value)} disabled={!canEdit} /></label>
          </div>
          <div className="tablewrap"><table>
            <thead><tr><th>Ingredient</th><th className="r" style={{ width: 130 }}>Quantity</th><th style={{ width: 70 }}>Unit</th><th className="r" style={{ width: 110 }}>Wastage %</th><th>Note</th>{canEdit && <th style={{ width: 44 }} />}</tr></thead>
            <tbody>{lines.map((l, k) => { const it = byId.get(l.item_id); return (
              <tr key={l.item_id}><td><b>{it?.name}</b></td>
                <td className="r"><input inputMode="decimal" className="num" style={{ textAlign: 'right', width: 110 }} value={l.qty} disabled={!canEdit} onChange={(e) => setLines((p) => p.map((x, j) => (j === k ? { ...x, qty: e.target.value } : x)))} /></td>
                <td className="muted">{it?.unit}</td>
                <td className="r"><input inputMode="decimal" className="num" style={{ textAlign: 'right', width: 90 }} value={l.waste} disabled={!canEdit} onChange={(e) => setLines((p) => p.map((x, j) => (j === k ? { ...x, waste: e.target.value } : x)))} /></td>
                <td><input value={l.note} disabled={!canEdit} onChange={(e) => setLines((p) => p.map((x, j) => (j === k ? { ...x, note: e.target.value } : x)))} /></td>
                {canEdit && <td><button className="btn quiet" aria-label="Remove" onClick={() => setLines((p) => p.filter((_, j) => j !== k))}><Icon name="trash" /></button></td>}</tr>); })}</tbody>
          </table>{lines.length === 0 && <p className="empty">No ingredients yet. Add them below, or upload a file.</p>}</div>
          {canEdit && <><label className="field"><span>Add an ingredient</span><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type a few letters" /></label>
            {matches.length > 0 && <div className="row">{matches.map((m) => <button key={m.id} className="qchip" onClick={() => { setLines((p) => [...p, { item_id: m.id, qty: '', waste: '', note: '' }]); setFind(''); }}>{m.name}</button>)}</div>}</>}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div><b>Cost per portion {money2(cost)}</b>{dish.price ? <span className="muted"> · {Math.round((cost / dish.price) * 100)}% of the selling price</span> : null}
              {missingCost > 0 && <div className="small" style={{ color: 'var(--watch, #A35405)' }}>{missingCost} ingredient{missingCost > 1 ? 's have' : ' has'} no cost yet, so this is low.</div>}</div>
            {canEdit && <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save recipe'}</button>}
          </div>
          {msg && <p className="banner warn" role="alert">{msg}</p>}
        </section>
      )}
    </>
  );
}
