import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { downloadWorkbook, readSheet, num, type SheetDef } from '../lib/sheets';
import { DEFAULT_QUICK } from '../lib/masters';
import { Icon } from '../components/Icon';

interface Preview { summary: string; problems: string[]; good: number; apply: () => Promise<string> }
const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const yes = (s: string) => /^(x|y|yes|1|true|✓|tick)$/i.test(s.trim());
const chunk = <T,>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

export function Upload() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'items';
  const tabs = [['items', 'Items and opening stock'], ['menu', 'Menu'], ['recipes', 'Recipes'], ['durables', 'Plates, glasses and cutlery']];
  return (
    <>
      <div className="pagehead"><div><p className="label">Masters</p><h1>Bulk upload</h1><p className="muted small" style={{ marginTop: 2 }}>Download the Excel template, fill it in, and upload it. Compass checks everything first and tells you what to fix before saving. Upload again any time to update.</p></div></div>
      <div className="seg" role="tablist">{tabs.map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => setSp({ tab: k })}>{l}</button>)}</div>
      {tab === 'items' && <ItemsUpload />}
      {tab === 'menu' && <MenuUpload />}
      {tab === 'recipes' && <RecipeUpload />}
      {tab === 'durables' && <DurableUpload />}
    </>
  );
}

function Card({ title, desc, onDownload, onFile, accept = '.xlsx' }: { title: string; desc: string; onDownload: () => Promise<void>; onFile: (f: File) => Promise<Preview>; accept?: string }) {
  const [busy, setBusy] = useState(false);
  const [prev, setPrev] = useState<Preview | null>(null);
  const [done, setDone] = useState('');
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  async function pick(f: File | undefined) {
    if (!f) return;
    setErr(''); setDone(''); setPrev(null); setBusy(true);
    try { setPrev(await onFile(f)); } catch (e) { setErr(errText(e)); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  async function go() {
    if (!prev) return; setBusy(true); setErr('');
    try { setDone(await prev.apply()); setPrev(null); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  return (
    <section className="card" style={{ display: 'grid', gap: 12 }}>
      <div><h2>{title}</h2><p className="muted small">{desc}</p></div>
      <div className="row">
        <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { await onDownload(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } }}><Icon name="receipt" /> Download template</button>
        <label className="btn primary" style={{ cursor: 'pointer' }}><Icon name="plus" /> Upload filled file<input ref={input} type="file" accept={accept} hidden onChange={(e) => void pick(e.target.files?.[0])} /></label>
      </div>
      {busy && <p className="muted small">Working…</p>}
      {err && <p className="banner bad" role="alert">{err}</p>}
      {done && <p className="banner" style={{ background: 'var(--good-tint, #DDF1E7)' }}>{done}</p>}
      {prev && (
        <div className="stack">
          <p><b>{prev.summary}</b></p>
          {prev.problems.length > 0 && <div className="banner warn"><b>{prev.problems.length} to fix. These rows are skipped:</b><ul style={{ margin: '6px 0 0 18px' }}>{prev.problems.slice(0, 40).map((p, i) => <li key={i} className="small">{p}</li>)}</ul>{prev.problems.length > 40 && <p className="small">…and {prev.problems.length - 40} more.</p>}</div>}
          <div className="row"><button className="btn primary" disabled={busy || prev.good === 0} onClick={go}>{busy ? 'Saving…' : `Save ${prev.good} rows`}</button><button className="btn quiet" onClick={() => setPrev(null)}>Cancel</button></div>
        </div>
      )}
    </section>
  );
}

function ItemsUpload() {
  const { locations } = useSession();
  const loadRefs = async () => {
    const [c, u, g, v, it] = await Promise.all([
      supabase.from('categories').select('id, name').order('sort'), supabase.from('units').select('code, name').order('code'),
      supabase.from('item_groups').select('id, name').order('sort'), supabase.from('vendors').select('id, name').eq('active', true).order('name'),
      supabase.from('items').select('*, item_locations(location_id)').order('name')
    ]);
    return { cats: (c.data ?? []) as { id: number; name: string }[], units: (u.data ?? []) as { code: string; name: string }[], groups: (g.data ?? []) as { id: number; name: string }[], vendors: (v.data ?? []) as { id: string; name: string }[], items: (it.data ?? []) as Record<string, unknown>[] };
  };
  const counters = locations.filter((l) => l.kind === 'department' && l.active);
  const places = locations.filter((l) => l.active);
  const heads = ['Item name', 'Category', 'Picture group', 'Counted in', 'Bought in', 'Counted units in one bought pack', 'Pack name', 'Pack size', 'Pieces in a pack', 'Slices in a pack', 'Weight of a pack (g)', 'Wastage %', 'Closing count', 'Allowed gap %', 'Cost per counted unit', 'Usual vendor', 'Quick amounts'];

  async function download() {
    const r = await loadRefs();
    const cat = (id: unknown) => r.cats.find((c) => c.id === id)?.name ?? '';
    const grp = (id: unknown) => r.groups.find((g) => g.id === id)?.name ?? '';
    const ven = (id: unknown) => r.vendors.find((v) => v.id === id)?.name ?? '';
    const rows = r.items.map((i) => {
      const at = new Set(((i.item_locations as { location_id: number }[]) ?? []).map((l) => l.location_id));
      return [i.name as string, cat(i.category_id), grp(i.group_id), i.unit as string, (i.purchase_unit as string) ?? '', (i.purchase_factor as number) ?? '', (i.pack_name as string) ?? '', (i.pack_size as number) ?? '', (i.pieces_per_pack as number) ?? '', (i.slices_per_pack as number) ?? '', (i.weight_per_pack_g as number) ?? '', (i.wastage_pct as number) ?? '', i.count_frequency === 'daily' ? 'Daily' : 'Weekly', (i.tolerance_pct as number) ?? '', (i.last_cost as number) ?? '', ven(i.default_vendor_id), ((i.quick_amounts as number[]) ?? []).join(', '), ...counters.map((c) => (at.has(c.id) ? 'x' : ''))];
    });
    const unitList = r.units.map((u) => u.code);
    const items: SheetDef = {
      name: 'Items', help: 'One row per item. Fields with * are needed. Put an x under every counter that uses the item. Leave anything unknown blank, you can fill it later and upload again.',
      cols: [
        { label: heads[0], required: true, width: 30 }, { label: heads[1], required: true, list: r.cats.map((c) => c.name), width: 24 }, { label: heads[2], list: r.groups.map((g) => g.name), width: 24 },
        { label: heads[3], required: true, list: unitList, width: 12, note: 'The unit people count and order in, for example kg, L, pkt, pcs' }, { label: heads[4], list: unitList, width: 12, note: 'Only if you buy in a different unit' },
        { label: heads[5], width: 16, note: 'For example 10 if one bought pack holds 10 of the counted unit' }, { label: heads[6], width: 14 }, { label: heads[7], width: 12 }, { label: heads[8], width: 12 }, { label: heads[9], width: 12 }, { label: heads[10], width: 14 }, { label: heads[11], width: 11 },
        { label: heads[12], list: ['Daily', 'Weekly'], width: 12, note: 'Daily for key items counted every night' }, { label: heads[13], width: 11 }, { label: heads[14], width: 14 }, { label: heads[15], list: r.vendors.map((v) => v.name), width: 28 }, { label: heads[16], width: 20, note: 'One tap buttons for staff, for example 0.25, 0.5, 1' },
        ...counters.map((c) => ({ label: `Used at: ${c.name}`, width: 11 }))
      ], rows
    };
    const open: SheetDef = { name: 'Opening stock', help: 'Only needed once, at the start. One row per item and place, with the quantity you counted in the Counted in unit.', cols: [{ label: 'Item name', required: true, list: r.items.map((i) => i.name as string), width: 34 }, { label: 'Place', required: true, list: places.map((p) => p.name), width: 22 }, { label: 'Quantity', required: true, width: 14 }] };
    await downloadWorkbook('Compass_Items_Template.xlsx', 'Compass items template', [
      'Fill the Items sheet. One row per item. Dropdowns help you pick the category, unit, picture group, vendor and closing count.',
      'Put an x under each counter that uses the item.',
      'Optional: on the Opening stock sheet, enter what is on the shelf today for the Store and each counter.',
      'Save the file and upload it on the Bulk upload page. Compass checks it first and tells you what to fix.',
      'To change items later, download the template again. It comes filled with your current items. Edit and upload.'
    ], [items, open]);
  }

  async function onFile(f: File): Promise<Preview> {
    const r = await loadRefs();
    const sh = await readSheet(f, 'Items', 'Item name');
    if (!sh) throw new Error('This file has no sheet called Items. Please use the downloaded template.');
    const problems: string[] = []; const good: Record<string, unknown>[] = []; const seen = new Set<string>();
    const existing = new Set(r.items.map((i) => String(i.name).toLowerCase()));
    let nNew = 0; let nUpd = 0;
    sh.rows.forEach((row, idx) => {
      const ln = `Row ${sh.line[idx]}`; const name = (row['Item name'] ?? '').trim();
      if (!name) { problems.push(`${ln}: item name is empty`); return; }
      if (seen.has(name.toLowerCase())) { problems.push(`${ln} ${name}: appears twice in the file`); return; }
      seen.add(name.toLowerCase());
      const cat = r.cats.find((c) => eq(c.name, row['Category'] ?? ''));
      const isNew = !existing.has(name.toLowerCase());
      if (!cat && (isNew || row['Category'])) { problems.push(`${ln} ${name}: category "${row['Category'] ?? ''}" is not in the list`); return; }
      const unit = r.units.find((u) => eq(u.code, row['Counted in'] ?? '') || eq(u.name, row['Counted in'] ?? ''));
      if (!unit && (isNew || row['Counted in'])) { problems.push(`${ln} ${name}: "Counted in" ${row['Counted in'] ? `"${row['Counted in']}" is not a known unit` : 'is empty'}`); return; }
      const grp = row['Picture group'] ? r.groups.find((g) => eq(g.name, row['Picture group'])) : undefined;
      if (row['Picture group'] && !grp) { problems.push(`${ln} ${name}: picture group "${row['Picture group']}" is not in the list`); return; }
      const ven = row['Usual vendor'] ? r.vendors.find((v) => eq(v.name, row['Usual vendor'])) : undefined;
      if (row['Usual vendor'] && !ven) { problems.push(`${ln} ${name}: vendor "${row['Usual vendor']}" is not in your vendor list`); return; }
      const pu = row['Bought in'] ? r.units.find((u) => eq(u.code, row['Bought in']) || eq(u.name, row['Bought in'])) : undefined;
      if (row['Bought in'] && !pu) { problems.push(`${ln} ${name}: "Bought in" unit "${row['Bought in']}" is not known`); return; }
      const nums: Record<string, number | null> = {}; let bad = '';
      for (const [k, key] of [['Counted units in one bought pack', 'pf'], ['Pack size', 'ps'], ['Pieces in a pack', 'pc'], ['Slices in a pack', 'sl'], ['Weight of a pack (g)', 'pg'], ['Wastage %', 'w'], ['Allowed gap %', 'tol'], ['Cost per counted unit', 'cost']] as const) {
        const v = num(row[k]); if (Number.isNaN(v)) bad = k; nums[key] = v;
      }
      if (bad) { problems.push(`${ln} ${name}: "${bad}" is not a number`); return; }
      if (pu && !(nums.pf && nums.pf > 0)) { problems.push(`${ln} ${name}: say how many ${unit?.code ?? ''} are in one ${pu.code}`); return; }
      const fr = (row['Closing count'] ?? '').toLowerCase();
      if (fr && fr !== 'daily' && fr !== 'weekly') { problems.push(`${ln} ${name}: closing count must be Daily or Weekly`); return; }
      const qa = (row['Quick amounts'] ?? '').split(/[ ,;]+/).filter(Boolean).map(Number);
      if (qa.some((n) => !(n > 0))) { problems.push(`${ln} ${name}: quick amounts must be numbers like 0.5, 1, 2`); return; }
      const locs = counters.filter((c) => yes(row[`Used at: ${c.name}`] ?? '')).map((c) => c.id);
      good.push({ name, category_id: cat?.id ?? '', unit: unit?.code ?? '', purchase_unit: pu?.code ?? '', purchase_factor: nums.pf, group_id: grp?.id ?? '', vendor_id: ven?.id ?? '', pack_name: row['Pack name'] ?? '', pack_size: nums.ps, pieces: nums.pc, slices: nums.sl, pack_g: nums.pg, waste: nums.w, freq: fr, tol: nums.tol, cost: nums.cost, quick: qa.length ? qa : isNew && unit ? (DEFAULT_QUICK[unit.code] ?? [1]) : [], locs });
      if (isNew) nNew++; else nUpd++;
    });
    const op = await readSheet(f, 'Opening stock', 'Item name');
    const places = locations.filter((l) => l.active); const opening: { name: string; location_id: number; qty: number }[] = [];
    if (op) op.rows.forEach((row, idx) => {
      const nm = (row['Item name'] ?? '').trim(); const pl = places.find((p) => eq(p.name, row['Place'] ?? '')); const q = num(row['Quantity']);
      if (!nm && !row['Place'] && !row['Quantity']) return;
      if (!nm || !pl || q == null || Number.isNaN(q) || q <= 0) { problems.push(`Opening stock row ${op.line[idx]}: ${!nm ? 'item name is empty' : !pl ? `place "${row['Place'] ?? ''}" is not in the list` : 'quantity must be a number above zero'}`); return; }
      if (!seen.has(nm.toLowerCase()) && !existing.has(nm.toLowerCase())) { problems.push(`Opening stock row ${op.line[idx]}: "${nm}" is not on the Items sheet`); return; }
      opening.push({ name: nm, location_id: pl.id, qty: q });
    });
    return {
      good: good.length + opening.length,
      summary: `${nNew} new items, ${nUpd} existing items to update${opening.length ? `, ${opening.length} opening stock rows` : ''}.`,
      problems,
      apply: async () => {
        let a = 0; let u = 0;
        for (const c of chunk(good, 150)) { const { data, error } = await supabase.rpc('import_items', { p: c }); if (error) throw error; a += (data as { added: number }).added; u += (data as { updated: number }).updated; }
        let msg = `Saved. ${a} items added, ${u} updated.`;
        if (opening.length) { let s = 0; let k = 0; for (const c of chunk(opening, 200)) { const { data, error } = await supabase.rpc('import_opening', { p: c }); if (error) throw error; s += (data as { saved: number }).saved; k += (data as { skipped: number }).skipped; } msg += ` Opening stock: ${s} saved${k ? `, ${k} already had opening stock and were left alone` : ''}.`; }
        return msg;
      }
    };
  }
  return <Card title="Items and opening stock" desc="The master list: names, units, pack sizes, which counters use each item, usual vendor, cost. The same file can carry opening stock on its second sheet." onDownload={download} onFile={onFile} />;
}

function MenuUpload() {
  const { locations } = useSession();
  const counters = locations.filter((l) => l.kind === 'department' && l.active);
  async function download() {
    const { data } = await supabase.from('menu_items').select('*').order('name').limit(3000);
    const rows = ((data ?? []) as Record<string, unknown>[]).map((m) => [m.name as string, (m.pos_name as string) ?? '', (m.price as number) ?? '', (m.menu_page as string) ?? '', (m.menu_group as string) ?? '', counters.find((c) => c.id === m.location_id)?.name ?? '', m.status as string]);
    await downloadWorkbook('Compass_Menu_Template.xlsx', 'Compass menu template', ['Fill one row per dish.', 'Menu name is how it appears in Compass. POS name is exactly how Pet Pooja spells it, so sales match.', 'Pick the counter that makes it.', 'Upload on the Bulk upload page, Menu tab. Existing dishes are updated by name.'],
      [{ name: 'Menu', cols: [{ label: 'Menu name', required: true, width: 34 }, { label: 'POS name', width: 34 }, { label: 'Price', width: 10 }, { label: 'Menu page', width: 22 }, { label: 'Group', width: 18 }, { label: 'Counter', list: counters.map((c) => c.name), width: 20 }, { label: 'Status', list: ['active', 'inactive'], width: 10 }], rows }]);
  }
  async function onFile(f: File): Promise<Preview> {
    const sh = await readSheet(f, 'Menu', 'Menu name'); if (!sh) throw new Error('This file has no sheet called Menu. Please use the downloaded template.');
    const problems: string[] = []; const good: Record<string, unknown>[] = []; const seen = new Set<string>();
    sh.rows.forEach((r, i) => {
      const ln = `Row ${sh.line[i]}`; const name = (r['Menu name'] ?? '').trim();
      if (!name) { problems.push(`${ln}: menu name is empty`); return; }
      if (seen.has(name.toLowerCase())) { problems.push(`${ln} ${name}: appears twice`); return; }
      seen.add(name.toLowerCase());
      const price = num(r['Price']); if (Number.isNaN(price)) { problems.push(`${ln} ${name}: price is not a number`); return; }
      const c = r['Counter'] ? counters.find((x) => eq(x.name, r['Counter'])) : undefined; if (r['Counter'] && !c) { problems.push(`${ln} ${name}: counter "${r['Counter']}" is not in the list`); return; }
      const st = (r['Status'] ?? '').toLowerCase(); if (st && st !== 'active' && st !== 'inactive') { problems.push(`${ln} ${name}: status must be active or inactive`); return; }
      good.push({ name, pos_name: r['POS name'] ?? '', price, menu_page: r['Menu page'] ?? '', menu_group: r['Group'] ?? '', location_id: c?.id ?? '', status: st });
    });
    return { good: good.length, problems, summary: `${good.length} dishes ready to save.`, apply: async () => { let a = 0; let u = 0; for (const c of chunk(good, 200)) { const { data, error } = await supabase.rpc('import_menu_rows', { p: c }); if (error) throw error; a += (data as { added: number }).added; u += (data as { updated: number }).updated; } return `Saved. ${a} dishes added, ${u} updated.`; } };
  }
  return <Card title="Menu" desc="Every dish with its price, POS name and counter. Download it filled with your current menu, change what you need, and upload." onDownload={download} onFile={onFile} />;
}

export async function recipeTemplate(dish?: string) {
  const [m, it, rc] = await Promise.all([supabase.from('menu_items').select('id, name').order('name').limit(3000), supabase.from('items').select('id, name, unit').eq('active', true).order('name'), supabase.from('recipes').select('menu_item_id, portion_size, portions, recipe_lines(item_id, qty, wastage_pct, note, sort)')]);
  const menu = (m.data ?? []) as { id: number; name: string }[]; const items = (it.data ?? []) as { id: number; name: string; unit: string }[];
  const rec = (rc.data ?? []) as { menu_item_id: number; portion_size: string; portions: number; recipe_lines: { item_id: number; qty: number; wastage_pct: number | null; note: string; sort: number }[] }[];
  const rows: (string | number)[][] = [];
  for (const r of rec) { const d = menu.find((x) => x.id === r.menu_item_id); if (!d || (dish && d.name !== dish)) continue; for (const l of [...r.recipe_lines].sort((a, b) => a.sort - b.sort)) { const i = items.find((x) => x.id === l.item_id); rows.push([d.name, i?.name ?? '', l.qty, i?.unit ?? '', l.wastage_pct ?? '', r.portion_size, r.portions, l.note]); } }
  if (dish && rows.length === 0) rows.push([dish, '', '', '', '', '', 1, '']);
  await downloadWorkbook(dish ? `Recipe_${dish.replace(/[^A-Za-z0-9]+/g, '_')}.xlsx` : 'Compass_Recipes_Template.xlsx', 'Compass recipe template',
    ['One row per ingredient. Repeat the dish name on each row of that dish.', 'Pick the dish and the ingredient from the dropdowns. Ingredients come from your Items list, so add any missing item there first.', 'Quantity per portion is in the item\'s own counted unit shown in the Unit column. Use 0.05 for 50 g when the unit is kg.', 'Portion size is the serving, for example 250 ml or 1 plate. Portions this makes is for batch recipes, for example 20 if the whole recipe makes 20 portions. Leave 1 if the quantities are already per portion.', 'Upload on the Bulk upload page, Recipes tab, or from a dish on the Recipes page.'],
    [{ name: 'Recipes', help: 'One row per ingredient of a dish.', cols: [{ label: 'Dish', required: true, list: menu.map((x) => x.name), width: 32 }, { label: 'Ingredient', required: true, list: items.map((x) => x.name), width: 32 }, { label: 'Quantity per portion', required: true, width: 14 }, { label: 'Unit (shown for reference)', width: 12 }, { label: 'Wastage %', width: 10 }, { label: 'Portion size', width: 16 }, { label: 'Portions this makes', width: 12 }, { label: 'Note', width: 24 }], rows }]);
}
export async function recipePreview(f: File, dishFallback?: string): Promise<Preview> {
  const sh = await readSheet(f, 'Recipes', 'Dish'); if (!sh) throw new Error('This file has no sheet called Recipes. Please use the downloaded template.');
  const [m, it] = await Promise.all([supabase.from('menu_items').select('name, pos_name').limit(3000), supabase.from('items').select('name, unit')]);
  const menu = (m.data ?? []) as { name: string; pos_name: string | null }[]; const items = (it.data ?? []) as { name: string }[];
  const problems: string[] = []; const good: Record<string, unknown>[] = []; const dishes = new Set<string>();
  sh.rows.forEach((r, i) => {
    const ln = `Row ${sh.line[i]}`; const dish = (r['Dish'] || dishFallback || '').trim(); const ing = (r['Ingredient'] ?? '').trim();
    if (!dish && !ing) return;
    if (!dish) { problems.push(`${ln}: dish is empty`); return; }
    const d = menu.find((x) => eq(x.name, dish) || (x.pos_name && eq(x.pos_name, dish))); if (!d) { problems.push(`${ln}: dish "${dish}" is not on the menu. Add it in the Menu tab first`); return; }
    const itm = items.find((x) => eq(x.name, ing)); if (!itm) { problems.push(`${ln} ${dish}: ingredient "${ing}" is not in your items list`); return; }
    const q = num(r['Quantity per portion']); if (q == null || Number.isNaN(q) || q <= 0) { problems.push(`${ln} ${dish}: quantity for ${ing} must be a number above zero`); return; }
    const w = num(r['Wastage %']); if (Number.isNaN(w)) { problems.push(`${ln} ${dish}: wastage is not a number`); return; }
    const p = num(r['Portions this makes']); if (Number.isNaN(p)) { problems.push(`${ln} ${dish}: portions is not a number`); return; }
    dishes.add(d.name);
    good.push({ dish: d.name, item: itm.name, qty: q, waste: w, portion_size: r['Portion size'] ?? '', portions: p, note: r['Note'] ?? '' });
  });
  return { good: good.length, problems, summary: `${dishes.size} dishes with ${good.length} ingredient lines. Each dish in the file replaces its saved recipe.`, apply: async () => { const { data, error } = await supabase.rpc('import_recipes', { p: good }); if (error) throw error; const d = data as { dishes: number; problems: string[] }; return `Saved recipes for ${d.dishes} dishes.${d.problems.length ? ' Not saved: ' + d.problems.slice(0, 5).join('; ') : ''}`; } };
}
function RecipeUpload() {
  return <Card title="Recipes" desc="Ingredient lines for each dish with quantity per portion and portion size. One file can hold one dish or all of them. To upload or edit one dish at a time, use the Recipes page." onDownload={() => recipeTemplate()} onFile={(f) => recipePreview(f)} />;
}

function DurableUpload() {
  const cats = ['Glasses', 'Plates', 'Bowls', 'Cutlery', 'Serving ware', 'Cups', 'Other'];
  async function download() {
    const { data } = await supabase.from('durable_items').select('*').order('category').order('name');
    const rows = ((data ?? []) as Record<string, unknown>[]).map((d) => [d.name as string, d.category as string, d.qty as number, (d.replace_cost as number) ?? '', (d.kept_at as string) ?? '']);
    await downloadWorkbook('Compass_Inventory_Template.xlsx', 'Compass plates, glasses and cutlery template', ['One row per type, for example Juice glass, Tea glass, Dinner plate, Service spoon, Ladle.', 'Quantity now is how many you own today. Replacement cost helps show what breakage costs.', 'Upload on the Bulk upload page. Existing types are updated by name; quantities of existing types change only through a weekly count.'],
      [{ name: 'Inventory', cols: [{ label: 'Name', required: true, width: 30 }, { label: 'Category', list: cats, width: 16 }, { label: 'Quantity now', width: 14 }, { label: 'Replacement cost', width: 16 }, { label: 'Kept at', width: 20 }], rows }]);
  }
  async function onFile(f: File): Promise<Preview> {
    const sh = await readSheet(f, 'Inventory', 'Name'); if (!sh) throw new Error('This file has no sheet called Inventory. Please use the downloaded template.');
    const problems: string[] = []; const good: Record<string, unknown>[] = []; const seen = new Set<string>();
    sh.rows.forEach((r, i) => {
      const ln = `Row ${sh.line[i]}`; const name = (r['Name'] ?? '').trim(); if (!name) { problems.push(`${ln}: name is empty`); return; }
      if (seen.has(name.toLowerCase())) { problems.push(`${ln} ${name}: appears twice`); return; } seen.add(name.toLowerCase());
      const q = num(r['Quantity now']); const c = num(r['Replacement cost']); if (Number.isNaN(q) || Number.isNaN(c) || (q != null && q < 0)) { problems.push(`${ln} ${name}: quantity and cost must be numbers`); return; }
      good.push({ name, category: r['Category'] ?? '', qty: q, cost: c, kept: r['Kept at'] ?? '' });
    });
    return { good: good.length, problems, summary: `${good.length} types ready to save.`, apply: async () => { const { data, error } = await supabase.rpc('import_durables', { p: good }); if (error) throw error; const d = data as { added: number; updated: number }; return `Saved. ${d.added} added, ${d.updated} updated.`; } };
  }
  return <Card title="Plates, glasses and cutlery" desc="Every type you own with the quantity today. After this, the weekly count on the Inventory page keeps it current." onDownload={download} onFile={onFile} />;
}
