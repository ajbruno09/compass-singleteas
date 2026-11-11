import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { useToast } from '../components/Toast';
import '../production.css';

type Kind = 'gravy' | 'snack' | 'continental';
interface Recipe { item_id: number; base_qty: number; min_qty: number; max_qty: number; multiple_of?: number; kind: Kind; chips: number[] | null; items: { name: string; unit: string } | null }
interface RLine { recipe_item_id: number; ingredient_id: number; qty_per_base: number; unit_ok: boolean; name: string; unit: string; ask_default?: boolean; per_unit?: number; pack?: boolean }
interface Cat { recipes: (Omit<Recipe, 'items'> & { name: string; unit: string })[]; lines: RLine[] }
interface IItem { id: number; name: string; unit: string }
interface Plan { id: number; item_id: number; weekday: number; qty: number; active: boolean }
interface Level { item_id: number; trigger_level: number | null; urgent_level: number | null; urgent_batch: number }
interface Order { id: number; item_id: number; qty: number; for_date: string; status: string; urgent: boolean; source: string; reason: string | null; requested_at: string; qty_made: number | null; ask_over?: Record<string, boolean> | null; items: { name: string; unit: string } | null }
interface Person { id: string; full_name: string }

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const STEPS: Record<string, string> = { requested: 'Requested', cooking: 'Cooking', on_the_way: 'On its way', received: 'Received', cancelled: 'Cancelled' };
const TILES: { kind: Kind; title: string; hint: (r: Recipe[]) => string }[] = [
  { kind: 'gravy', title: 'Gravies', hint: (r) => `${r.length} items · ${fmtChips(r[0])}` },
  { kind: 'snack', title: 'Frozen snacks', hint: (r) => `${r.length} items · ${fmtChips(r[0])}` },
  { kind: 'continental', title: 'Continental frozen', hint: (r) => `${r.length} items · 1, 2 or 3 batches` }
];
function fmtChips(r?: Recipe) { if (!r?.chips?.length) return ''; const u = r.items?.unit === 'kg' ? ' kg' : ' pcs'; return r.kind === 'snack' ? '100 to 300 pcs' : r.chips.join(', ') + u; }

const fq = (v: number, u: string) => {
  let x = v; let uu = u;
  if (u === 'g' && v >= 1000) { x = v / 1000; uu = 'kg'; }
  else if (u === 'kg' && v < 1 && v > 0) { x = Math.round(v * 1000); uu = 'g'; }
  else if (u === 'L' && v < 1 && v > 0) { x = Math.round(v * 1000); uu = 'ml'; }
  return `${Math.round(x * 100) / 100} ${uu}`;
};
const unitTxt = (u?: string) => (u === 'kg' ? ' kg' : ' pcs');
const dayLabel = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export function Production() {
  const { profile } = useSession();
  const toast = useToast();
  const admin = profile?.role === 'owner';
  const staffView = profile?.role === 'department' || profile?.role === 'closing';
  const canReceive = admin || profile?.role === 'manager' || profile?.role === 'store';
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [lines, setLines] = useState<RLine[]>([]);
  const [inames, setInames] = useState<Map<number, IItem>>(new Map());
  const [plan, setPlan] = useState<Plan[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [access, setAccess] = useState<Set<string>>(new Set());
  const [bd, setBd] = useState('');
  const [forDate, setForDate] = useState('');
  const [cut, setCut] = useState<{ due: string; seal: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'today' | 'recipes' | 'plan' | 'levels' | 'who'>('today');
  const [scr, setScr] = useState<'home' | Kind>('home');
  const [pick, setPick] = useState<Record<number, number>>({});
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [askSel, setAskSel] = useState<Record<string, boolean>>({});
  const [made, setMade] = useState<Record<number, string>>({});
  const [rg, setRg] = useState<Kind>('gravy');
  const [ri, setRi] = useState(0);
  const [rq, setRq] = useState(0);
  const [add, setAdd] = useState<Record<number, { item: number; qty: string }>>({});

  const load = useCallback(async () => {
    const [bdr, fdr, kr] = await Promise.all([
      supabase.rpc('business_date', { p_at: new Date().toISOString() }),
      supabase.rpc('indent_for_date'),
      supabase.rpc('my_prod_kinds')
    ]);
    const b = String(bdr.data); const f = String(fdr.data);
    setBd(b); setForDate(f); setKinds((kr.data as Kind[]) ?? []);
    const [cat, p, l, o, t] = await Promise.all([
      supabase.rpc('prod_catalog'),
      supabase.from('prod_plan').select('*').eq('active', true),
      supabase.from('prod_levels').select('*'),
      supabase.from('prod_orders').select('id, item_id, qty, for_date, status, urgent, source, reason, requested_at, qty_made, ask_over').order('requested_at', { ascending: false }).limit(80),
      supabase.rpc('indent_times', { p_for_date: f })
    ]);
    const FIRST = [661, 608, 662, 584, 560, 657, 660, 641, 574, 458, 443];
    const pos = (x: Recipe) => { const i = FIRST.indexOf(x.item_id); return i < 0 ? 1000 : i; };
    const cd = (cat.data as Cat | null) ?? { recipes: [], lines: [] };
    const rs: Recipe[] = cd.recipes.map((x) => ({ item_id: x.item_id, base_qty: x.base_qty, min_qty: x.min_qty, max_qty: x.max_qty, multiple_of: x.multiple_of ?? 1, kind: x.kind, chips: x.chips, items: { name: x.name, unit: x.unit } }))
      .sort((a2, c) => pos(a2) - pos(c) || (a2.items?.name ?? '').localeCompare(c.items?.name ?? ''));
    setRecipes(rs);
    setLines(cd.lines);
    setInames(new Map(cd.lines.map((x) => [x.ingredient_id, { id: x.ingredient_id, name: x.name, unit: x.unit }])));
    setPlan((p.data as Plan[]) ?? []);
    setLevels((l.data as Level[]) ?? []);
    const rmap = new Map(rs.map((x) => [x.item_id, x.items]));
    setOrders((((o.data as unknown as Order[]) ?? [])).map((x) => ({ ...x, items: rmap.get(x.item_id) ?? null })));
    const tt = ((t.data as { due_at: string; seal_at: string }[]) ?? [])[0];
    setCut(tt ? { due: tt.due_at, seal: tt.seal_at } : null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!admin) return;
    void (async () => {
      const [pp, aa] = await Promise.all([
        supabase.from('profiles').select('id, full_name').eq('active', true).eq('role', 'department').order('full_name'),
        supabase.from('prod_access').select('profile_id, kind')
      ]);
      setPeople((pp.data as Person[]) ?? []);
      setAccess(new Set(((aa.data as { profile_id: string; kind: string }[]) ?? []).map((x) => x.profile_id + '|' + x.kind)));
    })();
  }, [admin, tab]);

  const rec = useMemo(() => new Map(recipes.map((r) => [r.item_id, r])), [recipes]);
  const byKind = (k: Kind) => recipes.filter((r) => r.kind === k);
  const visible = (o: Order) => { const r = rec.get(o.item_id); return !!r && kinds.includes(r.kind); };
  const live = orders.filter((o) => ['requested', 'cooking', 'on_the_way'].includes(o.status) && visible(o));
  const recent = orders.filter((o) => ['received', 'cancelled'].includes(o.status) && visible(o)).slice(0, 6);
  const sealed = !!cut && Date.now() >= new Date(cut.seal).getTime();
  const dueTxt = cut ? new Date(cut.due).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', ' ') : '';
  const forTomorrow = forDate && bd && new Date(forDate).getTime() - new Date(bd).getTime() === 86400000;

  const need = (itemId: number, q: number) => {
    const r = rec.get(itemId); if (!r) return [];
    return lines.filter((x) => x.recipe_item_id === itemId).map((x) => {
      const it = inames.get(x.ingredient_id);
      return { id: x.ingredient_id, name: it?.name ?? '', unit: it?.unit ?? '', qty: (x.qty_per_base * q) / r.base_qty, ok: x.unit_ok, def: x.ask_default !== false, per: x.pack ? (x.per_unit ?? 1) : 0 };
    }).sort((a, b) => a.name.localeCompare(b.name));
  };

  const ingRow = (x: { id: number; name: string; unit: string; qty: number; ok: boolean; per: number }, on: boolean, flip: (() => void) | null) => (
    <div key={x.id} style={{ alignItems: 'center' }}>
      <span style={{ flex: 1 }}>{x.name}{!x.ok && <> <span className="pd-chip pd-att">unit?</span></>}
        <div className="pd-sm pd-mut">{fq(x.qty, x.unit)}{x.per > 0 && on ? ` · goes as ${Math.max(1, Math.ceil(x.qty / x.per - 1e-9))} pack${Math.ceil(x.qty / x.per - 1e-9) > 1 ? 's' : ''}` : ''}</div></span>
      <span className={'pd-sm' + (on ? '' : ' pd-mut')} style={{ marginRight: 8 }}>{on ? 'Ask Store' : 'Have it'}</span>
      <button className={'pd-sw' + (on ? ' pd-on' : '') + (flip ? '' : ' pd-lock')} onClick={flip ?? undefined} aria-label={on ? 'Ask Store, tap to switch off' : 'Have it, tap to ask Store'} />
    </div>
  );

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) { toast(error.message); return false; }
    if (ok) toast(ok);
    void load();
    return true;
  };
  const send = async () => {
    const entries = Object.entries(pick);
    setBusy(true);
    for (const [id, q] of entries) {
      const ov: Record<string, boolean> = {}; for (const [k, v] of Object.entries(askSel)) { const [it, ing] = k.split('|'); if (Number(it) === Number(id)) ov[ing] = v; }
      const { error } = await supabase.rpc('prod_order', { p_item: Number(id), p_qty: q, p_ask: ov });
      if (error) { setBusy(false); toast(error.message); return; }
    }
    setBusy(false); setPick({}); setAskSel({}); setScr('home');
    toast('Sent. Store indent and buying list are ready');
    void load();
  };
  const setQty = (o: Order, q: number) => { void run(() => supabase.rpc('prod_update_qty', { p_id: o.id, p_qty: q }), ''); };
  const stepBy = (o: Order, dir: 1 | -1) => {
    const r = rec.get(o.item_id); if (!r) return;
    const stp = Math.max(r.multiple_of ?? 1, r.chips && r.chips.length > 1 ? r.chips[1] - r.chips[0] : 1);
    setQty(o, Math.min(r.max_qty, Math.max(r.min_qty, o.qty + dir * stp)));
  };
  const step = (id: number, status: string) => run(() => supabase.rpc('prod_set_status', { p_id: id, p_status: status }), STEPS[status] ?? 'Done');
  const addPlan = (day: number) => {
    const a = add[day]; const item = a?.item || recipes.filter((r) => r.kind !== 'gravy')[0]?.item_id || recipes[0]?.item_id;
    const q = Number(a?.qty || rec.get(item)?.chips?.[0] || 0);
    if (!item || !q) return;
    void run(() => supabase.from('prod_plan').upsert({ item_id: item, weekday: day, qty: q, active: true }, { onConflict: 'item_id,weekday' }), 'Plan saved');
  };
  const dropPlan = (id: number) => run(() => supabase.from('prod_plan').delete().eq('id', id), 'Removed from plan');
  const saveLevel = (item: number, patch: Partial<Level>) => {
    const cur = levels.find((x) => x.item_id === item);
    void run(() => supabase.from('prod_levels').upsert({ item_id: item, trigger_level: cur?.trigger_level ?? null, urgent_level: cur?.urgent_level ?? null, urgent_batch: cur?.urgent_batch ?? 100, ...patch }, { onConflict: 'item_id' }), 'Saved');
  };
  const toggleAccess = (pid: string, k: Kind) => {
    const key = pid + '|' + k; const on = !access.has(key);
    const next = new Set(access); if (on) next.add(key); else next.delete(key); setAccess(next);
    void run(() => supabase.rpc('prod_set_access', { p_profile: pid, p_kind: k, p_on: on }), '');
  };

  const np = Object.keys(pick).length;
  const cnt = (k: Kind) => byKind(k).filter((r) => pick[r.item_id]).length;
  const adm = admin || profile?.role === 'manager' || profile?.role === 'store';
  const showAdminTabs = admin;

  const itemCard = (r: Recipe) => {
    const q = pick[r.item_id]; const chips = r.chips ?? [r.base_qty]; const u = unitTxt(r.items?.unit);
    const ing = need(r.item_id, q || chips[0]);
    return (
      <div key={r.item_id} className={'pd-card pd-it' + (q ? ' pd-sel' : '')}>
        <div className="pd-hd"><span className="pd-nm">{r.items?.name}</span><span className="pd-sub">{r.items?.unit === 'kg' ? 'kg' : 'pcs'}</span></div>
        <div className="pd-chips">
          {chips.map((s) => <button key={s} className={'pd-q' + (q === s ? ' pd-on' : '')} onClick={() => { const n = { ...pick }; if (n[r.item_id] === s) delete n[r.item_id]; else n[r.item_id] = s; setPick(n); }}>{s}{r.items?.unit === 'kg' ? ' kg' : ''}</button>)}
          <input className="pd-cq" type="number" min={r.min_qty} max={r.max_qty} step={r.multiple_of ?? 1} placeholder="Other" value={q && !chips.includes(q) ? q : ''} onChange={(e) => { const v = Number(e.target.value); const n = { ...pick }; if (v > 0) n[r.item_id] = Math.min(v, r.max_qty); else delete n[r.item_id]; setPick(n); }} onBlur={(e) => { const m = r.multiple_of ?? 1; const v = Number(e.target.value); if (m > 1 && v > 0 && v % m !== 0) { const n = { ...pick, [r.item_id]: Math.min(r.max_qty, Math.max(m, Math.round(v / m) * m)) }; setPick(n); toast(`${r.items?.name} is made in portions of ${m}, so I set it to ${n[r.item_id]}`); } }} />
        </div>
        <button className="pd-more" onClick={() => setOpen({ ...open, [r.item_id]: !open[r.item_id] })}>{open[r.item_id] ? 'Hide' : 'What this uses'}</button>
        <div className={'pd-use' + (open[r.item_id] ? ' pd-open' : '')}>
          <div className="pd-sm pd-mut" style={{ display: 'block', marginBottom: 4 }}>Switch on what the kitchen needs from the Store. Switch off what is already in the kitchen.</div>
          {ing.map((x) => { const k = r.item_id + '|' + x.id; const on = k in askSel ? askSel[k] : x.def; return ingRow(x, on, () => setAskSel({ ...askSel, [k]: !on })); })}
          {!q && <div className="pd-mut"><span>Shown for the smallest quantity</span></div>}
        </div>
        <span hidden>{u}</span>
      </div>
    );
  };

  const home = (
    <>
      {cut && (
        <div className="pd-banner">
          {sealed
            ? <span>The indent is closed. New orders go as <b style={{ fontWeight: 600 }}>urgent</b> and Admin is told.</span>
            : <span>Order before <b style={{ fontWeight: 600 }}>{dueTxt}</b> for {forTomorrow ? "tomorrow's" : dayLabel(forDate) + "'s"} indent. After that it goes as urgent and Admin is told.</span>}
        </div>
      )}
      <div className="pd-tiles">
        {TILES.filter((t) => kinds.includes(t.kind) && byKind(t.kind).length > 0).map((t) => {
          const n = cnt(t.kind);
          return (
            <button key={t.kind} className="pd-tile" onClick={() => setScr(t.kind)}>
              <span><b>{t.title}</b><span className="pd-sm pd-mut">{t.hint(byKind(t.kind))}</span></span>
              {n ? <span className="pd-chip pd-ok">{n} chosen</span> : <span className="pd-go">›</span>}
            </button>
          );
        })}
      </div>
      {kinds.length === 0 && <div className="pd-card pd-empty">Nothing is assigned to you yet. Please ask Admin.</div>}

      {live.length > 0 && (
        <div className="pd-card">
          <div className="pd-hd2"><h2>Batches</h2><span className="pd-sm pd-mut">Change the quantity before it starts cooking</span></div>
          {live.map((o) => {
            const r = rec.get(o.item_id); const u = unitTxt(o.items?.unit); const can = !!r && kinds.includes(r.kind);
            return (
              <div key={o.id} className="pd-ordl" style={{ flexWrap: 'wrap' }}>
                <span className="pd-t">{o.items?.name}<span className="pd-mut pd-sm"> · {dayLabel(o.for_date)}{o.urgent ? ' · urgent' : ''}</span></span>
                {o.status === 'requested' && can
                  ? <span className="pd-stp"><button disabled={busy} onClick={() => stepBy(o, -1)} aria-label="Less">−</button><span className="pd-num">{o.qty}{u}</span><button disabled={busy} onClick={() => stepBy(o, 1)} aria-label="More">+</button></span>
                  : <span className="pd-num">{o.qty}{u}</span>}
                <span className={'pd-chip ' + (o.status === 'requested' ? 'pd-wait' : 'pd-ok')}>{STEPS[o.status]}</span>
                <span className="pd-row">
                  <button className="pd-btn" onClick={() => setOpen({ ...open, [-o.id]: !open[-o.id] })}>{open[-o.id] ? 'Hide' : 'Ingredients'}</button>
                  {can && o.status === 'requested' && <button className="pd-btn" disabled={busy} onClick={() => step(o.id, 'cooking')}>Start cooking</button>}
                  {can && ['requested', 'cooking'].includes(o.status) && <button className="pd-btn" disabled={busy} onClick={() => step(o.id, 'on_the_way')}>Sent to store</button>}
                  {canReceive && o.status === 'on_the_way' && <button className="pd-btn" disabled={busy} onClick={() => step(o.id, 'received')}>Received</button>}
                  {can && o.status === 'requested' && <button className="pd-btn" disabled={busy} onClick={() => step(o.id, 'cancelled')}>Cancel</button>}
                </span>
                {admin && o.status !== 'received' && (
                  <span className="pd-row" style={{ width: '100%' }}>
                    <input className="pd-input" style={{ flex: 1, minWidth: 0 }} inputMode="numeric" placeholder={'Actually made' + u} value={made[o.id] ?? (o.qty_made ?? '')} onChange={(e) => setMade({ ...made, [o.id]: e.target.value })} />
                    <button className="pd-btn" disabled={busy || !made[o.id]} onClick={() => run(() => supabase.rpc('prod_set_yield', { p_id: o.id, p_made: Number(made[o.id]) }), 'Yield saved')}>Save yield</button>
                  </span>
                )}
                {open[-o.id] && (
                  <div className="pd-use pd-open" style={{ width: '100%' }}>
                    {need(o.item_id, o.qty).map((x) => { const on = o.ask_over && String(x.id) in o.ask_over ? !!o.ask_over[String(x.id)] : x.def; return ingRow(x, on, can && o.status === 'requested' ? () => { void run(() => supabase.rpc('prod_set_ask', { p_id: o.id, p_ing: x.id, p_on: !on }), ''); } : null); })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {recent.length > 0 && (
        <div className="pd-card">
          <h2>Recent</h2>
          {recent.map((o) => <div key={o.id} className="pd-ordl"><span className="pd-t">{o.items?.name}<span className="pd-mut pd-sm"> · {o.qty_made ?? o.qty}{unitTxt(o.items?.unit)}</span></span><span className="pd-mut pd-sm">{dayLabel(o.for_date)} · {STEPS[o.status]}</span></div>)}
        </div>
      )}
      <div className="pd-note">For now batches are ordered by hand here. Soon Compass will order them by itself from the day's plan, and this counter and the Store will only get a notice.</div>
    </>
  );

  const list = scr !== 'home' && (
    <>
      <div><button className="pd-back" onClick={() => setScr('home')}>‹ Production</button></div>
      <h1>{TILES.find((t) => t.kind === scr)?.title}</h1>
      <div className="pd-grid">{byKind(scr).map(itemCard)}</div>
    </>
  );

  const rItems = byKind(rg);
  const rItem = rItems.find((x) => x.item_id === ri) ?? rItems[0];
  const rQty = rItem && (rItem.chips ?? []).includes(rq) ? rq : (rItem?.chips?.[0] ?? 0);

  const body = (
    <div className="pd">
      <div className="pd-head">
        <span className="pd-lab">Counter</span>
        <h1>Production</h1>
        <div className="pd-sm pd-mut">{profile ? `Signed in as ${profile.full_name}` : ''}</div>
      </div>
      {showAdminTabs && (
        <div className="pd-tabs">
          {([['today', 'Today'], ['recipes', 'Recipes'], ['plan', 'Weekly plan'], ['levels', 'Stock levels'], ['who', 'Who orders what']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'pd-on' : ''} onClick={() => { setTab(k); setScr('home'); }}>{l}</button>)}
        </div>
      )}
      {!showAdminTabs && adm && (
        <div className="pd-tabs">
          {([['today', 'Today'], ['recipes', 'Recipes']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'pd-on' : ''} onClick={() => { setTab(k); setScr('home'); }}>{l}</button>)}
        </div>
      )}

      {tab === 'today' && (scr === 'home' ? home : list)}

      {tab === 'recipes' && (
        <>
          <p className="pd-sm pd-mut">Ingredients for what we make. Quantities are for the amount you choose.{rItem ? ` ${rItem.base_qty}${unitTxt(rItem.items?.unit)} is the standard batch.` : ''}</p>
          <div className="pd-seg">{TILES.map((t) => <button key={t.kind} className={rg === t.kind ? 'pd-on' : ''} onClick={() => { setRg(t.kind); setRi(0); setRq(0); }}>{t.title}</button>)}</div>
          {rItem && (
            <div className="pd-card" style={{ display: 'grid', gap: 10 }}>
              <div className="pd-chips">{rItems.map((x) => <button key={x.item_id} className={'pd-q' + (x.item_id === rItem.item_id ? ' pd-on' : '')} onClick={() => { setRi(x.item_id); setRq(0); }}>{x.items?.name}</button>)}</div>
              <div className="pd-sm pd-mut">{rItem.items?.unit === 'kg' ? 'Kilos' : 'Pieces'}</div>
              <div className="pd-chips">{(rItem.chips ?? []).map((x) => <button key={x} className={'pd-q' + (x === rQty ? ' pd-on' : '')} onClick={() => setRq(x)}>{x}{rItem.items?.unit === 'kg' ? ' kg' : ''}</button>)}</div>
              <div className="pd-use pd-open" style={{ borderTop: '1px solid var(--pd-line)', paddingTop: 8, fontSize: 13.5 }}>
                <div className="pd-sm pd-mut" style={{ display: 'block', marginBottom: 4 }}>The recipe is always the full list, for costing. The switch is only the default for what the counter asks the Store.</div>
                {need(rItem.item_id, rQty).map((x) => ingRow(x, x.def, admin ? () => { void run(() => supabase.rpc('prod_set_ask_default', { p_recipe: rItem.item_id, p_ing: x.id, p_on: !x.def }), ''); } : null))}
              </div>
              {need(rItem.item_id, rQty).some((x) => !x.ok) && <div className="pd-sm pd-mut">"unit?" means the recipe unit does not match how the item is counted. It is left off the indent until confirmed.</div>}
            </div>
          )}
        </>
      )}

      {tab === 'plan' && admin && (
        <>
          <p className="pd-sm pd-mut">Choose what is made on which day. For now the counter orders by hand. Later Compass orders these by itself and only sends a notice.</p>
          {DAYS.map((d, i) => {
            const day = i + 1; const a = add[day];
            const opts = recipes;
            return (
              <div key={d} className="pd-card" style={{ display: 'grid', gap: 6 }}>
                <h2>{d}</h2>
                {plan.filter((p) => p.weekday === day).map((p) => <div key={p.id} className="pd-ordl"><span className="pd-t">{rec.get(p.item_id)?.items?.name} {p.qty}</span><button className="pd-btn" disabled={busy} onClick={() => dropPlan(p.id)}>Remove</button></div>)}
                {plan.filter((p) => p.weekday === day).length === 0 && <span className="pd-sm pd-mut">Nothing planned</span>}
                <div className="pd-row">
                  <select className="pd-input" style={{ flex: 1, minWidth: 0 }} value={a?.item ?? opts[0]?.item_id ?? 0} onChange={(e) => setAdd({ ...add, [day]: { item: Number(e.target.value), qty: a?.qty ?? '' } })}>{opts.map((r) => <option key={r.item_id} value={r.item_id}>{r.items?.name}</option>)}</select>
                  <input className="pd-input" style={{ width: 90 }} inputMode="numeric" placeholder="Qty" value={a?.qty ?? ''} onChange={(e) => setAdd({ ...add, [day]: { item: a?.item ?? opts[0]?.item_id ?? 0, qty: e.target.value } })} />
                  <button className="pd-btn" disabled={busy} onClick={() => addPlan(day)}>Add a batch</button>
                </div>
              </div>
            );
          })}
        </>
      )}

      {tab === 'levels' && admin && (
        <>
          <p className="pd-sm pd-mut">When ready stock on the shelf falls to the urgent level, an urgent batch is ordered automatically. Leave blank to switch it off.</p>
          {recipes.filter((r) => r.kind !== 'gravy').map((r) => {
            const l = levels.find((x) => x.item_id === r.item_id);
            return (
              <div key={r.item_id} className="pd-card" style={{ display: 'grid', gap: 8 }}>
                <h2>{r.items?.name}</h2>
                <div className="pd-row">
                  <label className="pd-sm pd-mut" style={{ flex: 1 }}>Urgent at (pcs)<input className="pd-input" inputMode="numeric" defaultValue={l?.urgent_level ?? ''} onBlur={(e) => saveLevel(r.item_id, { urgent_level: e.target.value === '' ? null : Number(e.target.value) })} /></label>
                  <label className="pd-sm pd-mut" style={{ flex: 1 }}>Urgent batch<input className="pd-input" inputMode="numeric" defaultValue={l?.urgent_batch ?? r.base_qty} onBlur={(e) => saveLevel(r.item_id, { urgent_batch: Number(e.target.value) || r.base_qty })} /></label>
                </div>
              </div>
            );
          })}
        </>
      )}

      {tab === 'who' && admin && (
        <>
          {TILES.map((t) => (
            <div key={t.kind} className="pd-card">
              <h2>{t.title}</h2>
              <div className="pd-sm pd-mut">Pick one or two people. They see only the tiles assigned to them.</div>
              <div className="pd-add">{people.map((p) => <button key={p.id} className={'pd-q' + (access.has(p.id + '|' + t.kind) ? ' pd-on' : '')} onClick={() => toggleAccess(p.id, t.kind)}>{p.full_name}</button>)}</div>
            </div>
          ))}
          <div className="pd-hint">Admin and Store can always order everything. Anyone with no tile assigned does not see Production at all. Later, when ordering becomes automatic, this only decides who may order by hand.</div>
        </>
      )}

      {tab === 'today' && np > 0 && (
        <div className="pd-bar">
          <span className="pd-sm"><b style={{ fontWeight: 600 }}>{np}</b> chosen</span>
          <span className="pd-row"><button className="pd-btn" onClick={() => setPick({})}>Clear</button><button className="pd-btn pd-p" disabled={busy} onClick={() => void send()}>Send to Store</button></span>
        </div>
      )}
    </div>
  );

  return staffView ? <div className="phone">{body}</div> : <div>{body}</div>;
}
