import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { useToast } from '../components/Toast';

interface Recipe { item_id: number; base_qty: number; min_qty: number; step_qty: number; max_qty: number; items: { name: string } | null }
interface Plan { id: number; item_id: number; weekday: number; qty: number; active: boolean }
interface Level { item_id: number; trigger_level: number | null; urgent_level: number | null; urgent_batch: number }
interface Order { id: number; item_id: number; qty: number; for_date: string; status: string; urgent: boolean; source: string; reason: string | null; requested_at: string; qty_made: number | null; items: { name: string } | null }
interface Ing { ingredient_id: number; name: string; unit: string; qty: number; unit_ok: boolean }

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STEPS: Record<string, string> = { requested: 'Requested', cooking: 'Cooking', on_the_way: 'On its way', received: 'Received', cancelled: 'Cancelled' };
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

function Stepper({ r, v, set }: { r: Recipe; v: number; set: (n: number) => void }) {
  return (
    <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      <button className="btn secondary" onClick={() => set(Math.max(r.min_qty, v - r.step_qty))} aria-label="Less">−</button>
      <b style={{ minWidth: 56, textAlign: 'center' }}>{v}</b>
      <button className="btn secondary" onClick={() => set(Math.min(r.max_qty, v + r.step_qty))} aria-label="More">+</button>
    </span>
  );
}

export function Production() {
  const { profile, myLocations } = useSession();
  const toast = useToast();
  const admin = profile?.role === 'owner';
  const staffView = profile?.role === 'department' || profile?.role === 'closing';
  const canCook = admin || profile?.role === 'manager' || profile?.role === 'department';
  const canReceive = admin || profile?.role === 'manager' || profile?.role === 'store';
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [plan, setPlan] = useState<Plan[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [today, setToday] = useState({ date: '', dow: 1 });
  const [qty, setQty] = useState<Record<number, number>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [ings, setIngs] = useState<Ing[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'today' | 'recipes' | 'plan' | 'levels'>('today');
  const [extra, setExtra] = useState({ item: 0, qty: 100, reason: '', urgent: false });
  const [rc, setRc] = useState({ item: 0, qty: 100 });
  const [rIngs, setRIngs] = useState<Ing[]>([]);
  const [made, setMade] = useState<Record<number, string>>({});
  const [add, setAdd] = useState<Record<number, { item: number; qty: number }>>({});

  const load = useCallback(async () => {
    const bd = String((await supabase.rpc('business_date', { p_at: new Date().toISOString() })).data);
    const dow = ((new Date(bd + 'T12:00:00').getDay() + 6) % 7) + 1;
    setToday({ date: bd, dow });
    const [r, p, l, o] = await Promise.all([
      supabase.from('prod_recipes').select('item_id, base_qty, min_qty, step_qty, max_qty, items(name)').eq('active', true),
      supabase.from('prod_plan').select('*').eq('active', true),
      supabase.from('prod_levels').select('*'),
      supabase.from('prod_orders').select('id, item_id, qty, for_date, status, urgent, source, reason, requested_at, qty_made, items(name)').order('requested_at', { ascending: false }).limit(40)
    ]);
    const rs = ((r.data as unknown as Recipe[]) ?? []).sort((a, b) => (a.items?.name ?? '').localeCompare(b.items?.name ?? ''));
    setRecipes(rs);
    setPlan((p.data as Plan[]) ?? []);
    setLevels((l.data as Level[]) ?? []);
    setOrders((o.data as unknown as Order[]) ?? []);
    setExtra((e) => (e.item ? e : { ...e, item: rs[0]?.item_id ?? 0 }));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rec = useMemo(() => new Map(recipes.map((r) => [r.item_id, r])), [recipes]);
  const nameOf = (id: number) => rec.get(id)?.items?.name ?? '';
  const todays = plan.filter((p) => p.weekday === today.dow);
  const ordered = (item: number) => orders.find((o) => o.item_id === item && o.for_date === today.date && o.status !== 'cancelled');
  const live = orders.filter((o) => ['requested', 'cooking', 'on_the_way'].includes(o.status));
  const recent = orders.filter((o) => ['received', 'cancelled'].includes(o.status)).slice(0, 8);

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) { toast(error.message); return; }
    toast(ok);
    void load();
  };
  const order = (item: number, q: number, urgent = false, reason: string | null = null) =>
    run(() => supabase.rpc('prod_order', { p_item: item, p_qty: q, p_urgent: urgent, p_reason: reason }), 'Batch ordered');
  const step = (id: number, status: string) => run(() => supabase.rpc('prod_set_status', { p_id: id, p_status: status }), STEPS[status] ?? 'Done');
  const showIngs = async (o: Order) => {
    if (open === o.id) { setOpen(null); return; }
    const { data } = await supabase.rpc('prod_ingredients', { p_item: o.item_id, p_qty: o.qty });
    setIngs((data as Ing[]) ?? []);
    setOpen(o.id);
  };

  useEffect(() => {
    const id = rc.item || recipes[0]?.item_id;
    if (tab !== 'recipes' || !id) return;
    void (async () => { const { data } = await supabase.rpc('prod_ingredients', { p_item: id, p_qty: rc.qty }); setRIngs((data as Ing[]) ?? []); })();
  }, [tab, rc.item, rc.qty, recipes]);
  const planFor = (day: number) => plan.filter((p) => p.weekday === day);
  const addPlan = (day: number) => {
    const a = add[day] ?? { item: recipes[0]?.item_id ?? 0, qty: 100 };
    if (!a.item) return;
    void run(() => supabase.from('prod_plan').upsert({ item_id: a.item, weekday: day, qty: a.qty, active: true }, { onConflict: 'item_id,weekday' }), 'Plan saved');
  };
  const dropPlan = (id: number) => run(() => supabase.from('prod_plan').delete().eq('id', id), 'Removed from plan');
  const saveLevel = (item: number, patch: Partial<Level>) => {
    const cur = levels.find((l) => l.item_id === item);
    void run(() => supabase.from('prod_levels').upsert({ item_id: item, trigger_level: cur?.trigger_level ?? null, urgent_level: cur?.urgent_level ?? null, urgent_batch: cur?.urgent_batch ?? 100, ...patch }, { onConflict: 'item_id' }), 'Saved');
  };

  void myLocations;

  return (
    <div className={staffView ? 'phone' : ''} style={staffView ? undefined : { display: 'grid', gap: 14, maxWidth: 760 }}>
      <div className="phone-head"><b style={{ font: '800 20px/24px var(--font-display)' }}>Snacks production</b></div>
      {!staffView && (
        <div className="countersw" role="tablist">
          <button className={tab === 'today' ? 'on' : ''} onClick={() => setTab('today')}>Today</button>
          <button className={tab === 'recipes' ? 'on' : ''} onClick={() => setTab('recipes')}>Recipes</button>
          {admin && <><button className={tab === 'plan' ? 'on' : ''} onClick={() => setTab('plan')}>Weekly plan</button>
          <button className={tab === 'levels' ? 'on' : ''} onClick={() => setTab('levels')}>Stock levels</button></>}
        </div>
      )}

      {tab === 'today' && (
        <>
          <div className="hsec">Planned for today · {DAYS[today.dow - 1]}</div>
          {todays.length === 0 && <div className="card small muted">Nothing is planned for today. You can still order a batch below.</div>}
          {todays.map((p) => {
            const r = rec.get(p.item_id); if (!r) return null;
            const o = ordered(p.item_id);
            const v = qty[p.item_id] ?? p.qty;
            return (
              <div className="card" key={p.id} style={{ display: 'grid', gap: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}><b>{nameOf(p.item_id)}</b>{o ? <span className="chip done">{STEPS[o.status]} · {o.qty}</span> : <span className="chip due">Plan {p.qty}</span>}</div>
                {!o && canCook && (
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <Stepper r={r} v={v} set={(n) => setQty({ ...qty, [p.item_id]: n })} />
                    <button className="btn" disabled={busy} onClick={() => order(p.item_id, v)}>Order batch</button>
                  </div>
                )}
              </div>
            );
          })}

          <div className="hsec">On the line</div>
          {live.length === 0 && <div className="card small muted">No batches in progress.</div>}
          {live.map((o) => (
            <div className="card" key={o.id} style={{ display: 'grid', gap: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>{o.items?.name} · {o.qty}</b>
                <span className={'chip ' + (o.urgent ? 'flag' : 'due')}>{o.urgent ? 'URGENT · ' : ''}{STEPS[o.status]}</span>
              </div>
              <div className="small muted">For {o.for_date}{o.reason ? ` · ${o.reason}` : ''}</div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn secondary" onClick={() => showIngs(o)}>{open === o.id ? 'Hide' : 'Ingredients'}</button>
                {canCook && o.status === 'requested' && <button className="btn" disabled={busy} onClick={() => step(o.id, 'cooking')}>Start cooking</button>}
                {canCook && ['requested', 'cooking'].includes(o.status) && <button className="btn" disabled={busy} onClick={() => step(o.id, 'on_the_way')}>Sent to store</button>}
                {canReceive && o.status === 'on_the_way' && <button className="btn" disabled={busy} onClick={() => step(o.id, 'received')}>Received</button>}
                {admin && o.status === 'requested' && <button className="btn quiet" disabled={busy} onClick={() => step(o.id, 'cancelled')}>Cancel</button>}
              </div>
              {admin && o.status !== 'received' && (
                <div className="row" style={{ gap: 8 }}>
                  <input inputMode="numeric" placeholder="Pieces actually made" value={made[o.id] ?? (o.qty_made ?? '')} onChange={(e) => setMade({ ...made, [o.id]: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
                  <button className="btn secondary" disabled={busy || !made[o.id]} onClick={() => run(() => supabase.rpc('prod_set_yield', { p_id: o.id, p_made: Number(made[o.id]) }), 'Yield saved')}>Save yield</button>
                </div>
              )}
              {open === o.id && (
                <div style={{ display: 'grid', gap: 4 }}>
                  {ings.map((i) => (
                    <div key={i.ingredient_id} className="row" style={{ justifyContent: 'space-between' }}>
                      <span>{i.name}</span><span><b>{fmt(i.qty)}</b> <span className="muted small">{i.unit}</span>{!i.unit_ok && <span className="chip late" style={{ marginLeft: 6 }}>unit?</span>}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {canCook && recipes.length > 0 && (
            <>
              <div className="hsec">Something else, or running out</div>
              <div className="card" style={{ display: 'grid', gap: 10 }}>
                <select value={extra.item} onChange={(e) => setExtra({ ...extra, item: Number(e.target.value) })}>{recipes.map((r) => <option key={r.item_id} value={r.item_id}>{r.items?.name}</option>)}</select>
                {rec.get(extra.item) && <Stepper r={rec.get(extra.item)!} v={extra.qty} set={(n) => setExtra({ ...extra, qty: n })} />}
                <input placeholder="Reason (needed if not planned today)" value={extra.reason} onChange={(e) => setExtra({ ...extra, reason: e.target.value })} />
                <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={extra.urgent} onChange={(e) => setExtra({ ...extra, urgent: e.target.checked })} /> Urgent, we are running out</label>
                <button className="btn" disabled={busy || !extra.item} onClick={() => order(extra.item, extra.qty, extra.urgent, extra.reason || null)}>Order batch</button>
              </div>
            </>
          )}

          {recent.length > 0 && (
            <>
              <div className="hsec">Recent</div>
              {recent.map((o) => (
                <div key={o.id} className="row small" style={{ justifyContent: 'space-between' }}>
                  <span>{o.items?.name} · {o.qty_made ?? o.qty}</span><span className="muted">{o.for_date} · {STEPS[o.status]}</span>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {tab === 'recipes' && (
        <>
          <p className="muted small">Ingredients for the snacks we make. Quantities are for the pieces you choose. 100 is the standard batch.</p>
          <div className="card" style={{ display: 'grid', gap: 10 }}>
            <select value={rc.item || recipes[0]?.item_id || 0} onChange={(e) => setRc({ ...rc, item: Number(e.target.value) })}>{recipes.map((r) => <option key={r.item_id} value={r.item_id}>{r.items?.name}</option>)}</select>
            {recipes[0] && <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted small">Pieces</span><Stepper r={rec.get(rc.item || recipes[0].item_id)!} v={rc.qty} set={(n) => setRc({ ...rc, qty: n })} /></div>}
            {rIngs.map((i) => (
              <div key={i.ingredient_id} className="row" style={{ justifyContent: 'space-between' }}>
                <span>{i.name}</span><span><b>{fmt(i.qty)}</b> <span className="muted small">{i.unit}</span>{!i.unit_ok && <span className="chip late" style={{ marginLeft: 6 }}>unit?</span>}</span>
              </div>
            ))}
            {rIngs.some((i) => !i.unit_ok) && <div className="small muted">"unit?" means the recipe is in kg or L but the item is counted in packets, bunches or bottles. To be confirmed.</div>}
          </div>
        </>
      )}

      {tab === 'plan' && admin && (
        <>
          <p className="muted small">Choose which snacks are made on which day. The chef gets a reminder in the morning and orders that day's batch.</p>
          {DAYS.map((d, i) => {
            const day = i + 1; const a = add[day] ?? { item: recipes[0]?.item_id ?? 0, qty: 100 }; const r = rec.get(a.item);
            return (
              <div className="card" key={d} style={{ display: 'grid', gap: 8 }}>
                <b>{d}</b>
                {planFor(day).map((p) => (
                  <div key={p.id} className="row" style={{ justifyContent: 'space-between' }}><span>{nameOf(p.item_id)} · <b>{p.qty}</b></span><button className="btn quiet" disabled={busy} onClick={() => dropPlan(p.id)}>Remove</button></div>
                ))}
                {planFor(day).length === 0 && <span className="small muted">Nothing planned</span>}
                <div className="row" style={{ gap: 8 }}>
                  <select value={a.item} onChange={(e) => setAdd({ ...add, [day]: { ...a, item: Number(e.target.value) } })} style={{ flex: 1, minWidth: 0 }}>{recipes.map((x) => <option key={x.item_id} value={x.item_id}>{x.items?.name}</option>)}</select>
                  {r && <Stepper r={r} v={a.qty} set={(n) => setAdd({ ...add, [day]: { ...a, qty: n } })} />}
                  <button className="btn" disabled={busy} onClick={() => addPlan(day)}>Add</button>
                </div>
              </div>
            );
          })}
        </>
      )}

      {tab === 'levels' && admin && (
        <>
          <p className="muted small">When the ready stock of a snack on the Snacks Frozen shelf falls to the urgent level, an urgent batch is ordered automatically. Leave blank to switch it off for that snack.</p>
          {recipes.map((r) => {
            const l = levels.find((x) => x.item_id === r.item_id);
            return (
              <div className="card" key={r.item_id} style={{ display: 'grid', gap: 8 }}>
                <b>{r.items?.name}</b>
                <div className="row" style={{ gap: 8 }}>
                  <label className="small muted" style={{ flex: 1 }}>Urgent at (pcs)<input inputMode="numeric" defaultValue={l?.urgent_level ?? ''} onBlur={(e) => saveLevel(r.item_id, { urgent_level: e.target.value === '' ? null : Number(e.target.value) })} /></label>
                  <label className="small muted" style={{ flex: 1 }}>Urgent batch<input inputMode="numeric" defaultValue={l?.urgent_batch ?? 100} onBlur={(e) => saveLevel(r.item_id, { urgent_batch: Number(e.target.value) || 100 })} /></label>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
