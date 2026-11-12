import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { errText } from '../lib/format';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import '../price-check.css';

const APPS = ['Blinkit', 'Zepto', 'Instamart', 'BigBasket'] as const;
const DOMAIN: Record<string, string> = { Blinkit: 'blinkit', Zepto: 'zepto', Instamart: 'instamart', BigBasket: 'bigbasket' };
interface Cell { price: number | null; status: 'ok' | 'oos' | 'nf' | 'fail'; note: string | null; at: string; tried?: string }
interface PItem { id: number | null; key: string; item_id: number; name: string; brand: string; pack: string; links: Record<string, string>; prices: Record<string, Cell>; stopped?: boolean; changed?: boolean; checking_since?: string | null; checking_apps?: string[] | null }
interface Data { items: Omit<PItem, 'key'>[]; brands: string[]; packs: string[]; settings: { daily: boolean; hour: number; last_full: string | null; connected: boolean } }
interface CatItem { id: number; name: string; group_id: number | null }

function ago(iso: string | null): string {
  if (!iso) return 'Not checked yet';
  const m = (Date.now() - new Date(iso).getTime()) / 60000;
  if (m < 2) return 'Just now';
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 24) {
    const d = new Date(iso); const same = d.toDateString() === new Date().toDateString();
    return `${same ? 'Today' : 'Yesterday'} ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}`;
  }
  return `${Math.round(h / 24)} days ago`;
}
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const words = (sec: number) => (sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min${sec % 60 ? ` ${sec % 60} s` : ''}`);
// Remember how long the last few checks took, so people know what to expect.
function usual(kind: 'all' | 'one'): number | null {
  try { const a = JSON.parse(localStorage.getItem(`pc_t_${kind}`) ?? '[]') as number[]; if (!a.length) return null; return Math.round(a.reduce((x, y) => x + y, 0) / a.length); } catch { return null; }
}
function remember(kind: 'all' | 'one', sec: number) {
  try { const a = JSON.parse(localStorage.getItem(`pc_t_${kind}`) ?? '[]') as number[]; a.push(sec); localStorage.setItem(`pc_t_${kind}`, JSON.stringify(a.slice(-5))); } catch { /* storage may be unavailable */ }
}
const lastAt = (it: PItem): string | null => Object.values(it.prices).filter((c) => c.status !== 'fail' || c.price != null).map((c) => c.at).sort().pop() ?? null;
const hoursOld = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 3600000 : null);
const prices = (it: PItem) => APPS.map((a) => { const c = it.prices[a]; return c && c.status === 'ok' && c.price != null ? c.price : null; });

// A small type-or-pick box. Brands and sizes you add are remembered for next time.
function Combo({ value, list, placeholder, kind, onChange }: { value: string; list: string[]; placeholder: string; kind: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const match = list.filter((b) => !q || b.toLowerCase().includes(q));
  const exact = list.some((b) => b.toLowerCase() === q);
  return (
    <div className="pc-cb">
      <input value={value} placeholder={placeholder} onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)} />
      {open && (match.length > 0 || (q && !exact)) && (
        <div className="pc-dd">
          {match.length > 0 && <div className="hint">Saved {kind}s</div>}
          {match.map((b) => <div key={b} onMouseDown={(e) => { e.preventDefault(); onChange(b); setOpen(false); }}>{b}</div>)}
          {q && !exact && <div className="add" onMouseDown={(e) => { e.preventDefault(); onChange(value.trim()); setOpen(false); }}>+ Use “{value.trim()}” as a new {kind}. It is saved for next time.</div>}
        </div>)}
    </div>
  );
}

export function PriceCheck() {
  const toast = useToast();
  const { profile } = useSession();
  const isOwner = profile?.role === 'owner';
  const canEdit = isOwner || profile?.role === 'store';
  const [data, setData] = useState<Data | null>(null);
    const [manual, setManual] = useState(false);
    const [edit, setEdit] = useState<PItem | null>(null);
  const [picker, setPicker] = useState(false);
  const [settings, setSettings] = useState(false);
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  const [now, setNow] = useState(Date.now());
  const sinceOf = (it: { checking_since?: string | null; checking_apps?: string[] | null }) => (it.checking_since ? new Date(it.checking_since).getTime() : 0);
  const checkingItems = (data?.items ?? []).filter((i) => sinceOf(i) > 0);
  const running = checkingItems.length > 0;
  const all = running && checkingItems.length > 1;
  const allStart = running ? Math.min(...checkingItems.map(sinceOf)) : 0;
  const wasRunning = useRef<{ on: boolean; start: number; all: boolean }>({ on: false, start: 0, all: false });
  useEffect(() => { if (!running) return; setNow(Date.now()); const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, [running]);
  const secsFrom = (t: number) => (t ? Math.max(0, Math.round((now - t) / 1000)) : 0);

  const load = useCallback(async () => {
    const { data: d, error } = await supabase.rpc('pc_list');
    if (error) { setErr(errText(error)); return; }
    setErr(''); setData(d as Data);
  }, []);
  useEffect(() => { void load(); }, [load]);
  // the check runs on the server, so keep looking while it is going, and say so when it ends
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(t);
  }, [running, load]);
  useEffect(() => {
    const w = wasRunning.current;
    if (running) { w.on = true; w.start = allStart; w.all = all; return; }
    if (w.on) {
      w.on = false;
      const d = Math.max(1, Math.round((Date.now() - w.start) / 1000));
      remember(w.all ? 'all' : 'one', d);
      const failed = (data?.items ?? []).reduce((n, i) => n + Object.values(i.prices).filter((c) => c.status === 'fail' && c.tried && new Date(c.tried).getTime() >= w.start - 2000).length, 0);
      toast(failed ? `Done in ${words(d)}. ${failed} could not be fetched.` : `Prices refreshed in ${words(d)}`);
    }
  }, [running, allStart, all, data, toast]);

  const live: PItem[] = useMemo(() => (data?.items ?? []).map((i) => ({ ...i, key: `i${i.id}` })), [data]);
  const rows = live;

  function toggleManual() { setManual(!manual); }

  async function run(ids: number[] | null, apps?: string[]) {
    const { data: sess } = await supabase.auth.getSession();
    const token2 = sess.session?.access_token;
    const { error } = await supabase.functions.invoke('price-check', { body: ids ? (apps ? { ids, apps } : { ids }) : { all: true }, headers: token2 ? { Authorization: `Bearer ${token2}` } : undefined });
    if (error) throw error;
    await load();
  }
  async function checkOne(id: number, app?: string) { try { await run([id], app ? [app] : undefined); } catch (e) { toast(errText(e)); } }
  async function checkAll() { try { await run(null); } catch (e) { toast(errText(e)); } }

  // Every change is saved straight away, so nothing is lost if the page reloads.
  async function saveItem(n: PItem) {
    const { error } = await supabase.rpc('pc_save_item', { p_id: n.id, p_item_id: n.item_id, p_brand: n.brand, p_pack: n.pack, p_links: n.links });
    if (error) { toast(errText(error)); return false; }
    await load(); toast('Saved'); return true;
  }
  async function stopItem(n: PItem) {
    if (n.id == null) return;
    const { error } = await supabase.rpc('pc_stop', { p_id: n.id });
    if (error) { toast(errText(error)); return; }
    await load(); toast('Taken off the price check. It stays in your Items list.');
  }
  async function addItems(list: { item_id: number; name: string; brand: string; pack: string }[]) {
    for (const x of list) {
      const { error } = await supabase.rpc('pc_save_item', { p_id: null, p_item_id: x.item_id, p_brand: x.brand, p_pack: x.pack, p_links: {} });
      if (error) { toast(errText(error)); await load(); return; }
    }
    await load(); setPicker(false); toast(`${list.length} item${list.length > 1 ? 's' : ''} added and saved`);
  }

  const attention = useMemo(() => {
    const out: { key: string; it: PItem; text: string; act: 'retry' | 'check' | 'fix'; apps?: string[] }[] = [];
    for (const it of live) {
      const fails = APPS.filter((a) => it.prices[a]?.status === 'fail');
      if (fails.length) out.push({ key: `f${it.id}`, it, text: `${fails.join(', ')} did not answer`, act: 'retry', apps: fails });
      const h = hoursOld(lastAt(it));
      if (h != null && h >= 24) out.push({ key: `s${it.id}`, it, text: `Last checked ${ago(lastAt(it))}`, act: 'check' });
    }
    return out;
  }, [live]);

  async function saveSettings(daily: boolean, hour: number) {
    const { error } = await supabase.rpc('pc_save_settings', { p_daily: daily, p_hour: hour });
    if (error) toast(errText(error)); else await load();
  }
  async function saveToken() {
    const { error } = await supabase.rpc('pc_set_token', { p_token: token });
    if (error) { toast(errText(error)); return; }
    setToken(''); toast('Saved. Press Check all now to try it.'); await load();
  }

  if (err) return <div className="card"><p className="muted">{err}</p></div>;
  if (!data) return <div className="card"><p className="muted">Loading…</p></div>;
  const notChecked = live.filter((i) => !lastAt(i)).length;
  const s = data.settings;

  return (
    <div className="pc">
      <div className="pagehead">
        <div><p className="label">Buying and money</p><h1>Price check</h1>
          <p className="muted small" style={{ marginTop: 2 }}>Final selling price on each quick commerce app for the items you choose. Check before you place an order.</p></div>
        <div className="row" style={{ position: 'relative' }}>
          <span className="pc-pill"><span className="pc-dot" />Bilekahalli 560076</span>
          {isOwner && <button className="btn" onClick={() => setSettings(!settings)}>Settings</button>}
          {canEdit && <label className="row small" style={{ gap: 6, cursor: 'pointer' }}><span className="muted">Manual update</span><button type="button" role="switch" aria-checked={manual} className={`pc-switch${manual ? ' on' : ''}`} onClick={toggleManual} /></label>}
          {settings && (
            <div className="pc-pop">
              <div className="pc-l"><span>Check every morning<br /><span className="small muted">So prices are ready before you buy</span></span>
                <button type="button" role="switch" aria-checked={s.daily} className={`pc-switch${s.daily ? ' on' : ''}`} onClick={() => void saveSettings(!s.daily, s.hour)} /></div>
              {s.daily && <div className="pc-l"><span className="small muted">Time</span>
                <select value={s.hour} onChange={(e) => void saveSettings(true, Number(e.target.value))}><option value={6}>6:00 am</option><option value={7}>7:00 am</option><option value={8}>8:00 am</option></select></div>}
              <div className="pc-l"><span className="small muted">Apps</span><span className="small">Blinkit, Zepto, Instamart, BigBasket</span></div>
              <div className="pc-l" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
                <span>Data service {s.connected ? <span className="chip done">Connected</span> : <span className="chip late">Not connected</span>}</span>
                <div className="row" style={{ flexWrap: 'nowrap', width: '100%' }}><input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={s.connected ? 'Paste a new key to replace' : 'Paste your Apify key'} />
                  <button className="btn" disabled={!token.trim()} onClick={() => void saveToken()}>Save</button></div>
              </div>
              <p className="small muted">Each check uses a small amount of paid data credit. Turn the morning check off to check only when you press Check all now.</p>
            </div>)}
        </div>
      </div>

      {manual && <div className="pc-warn">Manual update is on. You can add items from your Items list, change brands and links, or stop checking an item. Each change is saved as you make it. Nothing is deleted from your Items list.</div>}

      <div className="pc-toolbar">
        <div className="row"><button className="btn primary" disabled={running || manual || !live.length} onClick={() => void checkAll()}>{running ? `Checking… ${clock(secsFrom(allStart))}` : 'Check all now'}</button>
          <span className="small muted">{running ? `${usual(all ? 'all' : 'one') ? `Usually about ${words(usual(all ? 'all' : 'one') as number)}. ` : ''}It keeps running if you leave this page. Prices appear here as each app answers.` : notChecked ? `${notChecked} item${notChecked > 1 ? 's' : ''} not checked yet` : s.last_full ? `Last full check: ${ago(s.last_full).toLowerCase()}` : ''}</span></div>
        {manual && <button className="btn" onClick={() => setPicker(true)}>+ Add items from Items list</button>}
      </div>

      <div className="pc-layout">
        <div>
          <div className="tablewrap"><table className="pc-table">
            <colgroup><col style={{ width: '25%' }} /><col style={{ width: '11%' }} /><col style={{ width: '11%' }} /><col style={{ width: '11%' }} /><col style={{ width: '11%' }} /><col style={{ width: '15%' }} /><col style={{ width: '16%' }} /></colgroup>
            <thead><tr><th>Item</th>{APPS.map((a) => <th key={a} className="r">{a}</th>)}<th>Cheapest</th><th className="r">{manual ? 'Edit' : 'Checked'}</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="muted" style={{ padding: 20 }}>No items yet. Turn on Manual update, then add items from your Items list.</td></tr>}
              {rows.map((it) => {
                const ps = prices(it); const nums = ps.filter((v): v is number => v != null);
                const mn = nums.length ? Math.min(...nums) : null; const saves = nums.length > 1 ? Math.max(...nums) - (mn as number) : 0;
                const at = lastAt(it); const h = hoursOld(at); const since = sinceOf(it); const isBusy = since > 0;
                return (
                  <tr key={it.key}>
                    <td className="pc-item"><span>{it.name}</span><span className="pc-sub"><span className="pc-tag">{it.brand}</span><span className="pc-tag">{it.pack}</span></span></td>
                    {APPS.map((a, i) => {
                      const c = it.prices[a];
                      let body;
                      if (isBusy && (!it.checking_apps || it.checking_apps.includes(a)) && !(c?.tried && new Date(c.tried).getTime() >= since - 1000)) body = <span className="pc-spin" />;
                      else if (c?.status === 'fail') body = <span className="pc-fail">Could not fetch<br /><a role="button" onClick={() => it.id != null && void checkOne(it.id, a)}>Try again</a></span>;
                      else if (c?.status === 'oos') body = <span className="pc-oos">Out of stock</span>;
                      else if (c?.status === 'nf') body = <span className="pc-oos" title="The data service did not see this product on this app. It may be out of stock, or the service may see a different store than your app. Check the app yourself before trusting this.">Not found</span>;
                      else if (!c || c.price == null) body = <span className="pc-dash">–</span>;
                      else body = <><span className={`pc-price${ps[i] === mn ? ' low' : ''}`}>₹{c.price}</span>{ps[i] === mn && <span className="pc-sub low">Lowest</span>}</>;
                      return <td key={a} className="pc-app r" data-l={a}>{body}</td>;
                    })}
                    <td className="pc-cheap">{mn == null ? <span className="pc-nm">Nothing to compare</span> : <><span>{APPS.filter((_, i) => ps[i] === mn).join(' and ')}</span><span className="pc-sub">₹{mn}{saves > 0 ? `, saves up to ₹${saves}` : ''}</span></>}</td>
                    <td className="r pc-chk"><span>{!at ? <span className="chip due">Not checked yet</span> : <span className={h != null && h >= 24 ? 'chip late' : 'muted small'}>{ago(at)}</span>}</span>
                      <span style={{ display: 'block', marginTop: 4 }}>{manual ? <button className="btn pc-sm" onClick={() => setEdit(it)}>Edit</button> : <button className="btn pc-sm" disabled={isBusy || it.id == null} onClick={() => it.id != null && void checkOne(it.id)}>{isBusy ? `Checking ${clock(secsFrom(since))}` : 'Check'}</button>}</span></td>
                  </tr>);
              })}
            </tbody>
          </table></div>
          <p className="pc-foot">Each price is the final selling price after discount, as shown on the product page. MRP, coupons, membership and bank offers are not counted. Green is the lowest. Prices change through the day, so look at the Checked time before you buy.</p>
        </div>

        <div className="card pc-attn">
          <div className="pc-hd"><b>Needs a look</b><span className={`pc-badge${attention.length ? '' : ' zero'}`}>{attention.length || '✓'}</span></div>
          {attention.length === 0 && <div className="pc-it"><span className="pc-dot" /><div className="pc-t">Everything checked is up to date.</div></div>}
          {attention.map((a) => (
            <div className="pc-it" key={a.key}><span className="pc-dot" style={{ background: a.act === 'fix' ? 'var(--info)' : '#C77B1E' }} />
              <div className="pc-t">{a.it.name} · {a.it.brand}<span className="pc-sub">{a.text}</span></div>
              <button className="btn pc-sm" onClick={() => (a.act === 'fix' ? (canEdit && setEdit(a.it)) : a.it.id != null && void (a.apps?.length === 1 ? checkOne(a.it.id, a.apps[0]) : a.apps ? run([a.it.id], a.apps).catch((e) => toast(errText(e))) : checkOne(a.it.id)))}>{a.act === 'retry' ? 'Retry' : a.act === 'check' ? 'Check' : 'Fix'}</button></div>))}
        </div>
      </div>


      {edit && <EditSheet item={edit} brands={data.brands} packs={data.packs} onClose={() => setEdit(null)}
        onDone={async (n) => { if (await saveItem(n)) setEdit(null); }}
        onStop={() => { void stopItem(edit); setEdit(null); }} />}
      {picker && <PickerSheet brands={data.brands} packs={data.packs} taken={live.map((d) => d.item_id)} onClose={() => setPicker(false)}
        onAdd={(list) => void addItems(list)} />}
    </div>
  );
}

function EditSheet({ item, brands, packs, onClose, onDone, onStop }: { item: PItem; brands: string[]; packs: string[]; onClose: () => void; onDone: (n: PItem) => void | Promise<void>; onStop: () => void }) {
  const [brand, setBrand] = useState(item.brand); const [pack, setPack] = useState(item.pack);
  const [links, setLinks] = useState<Record<string, string>>({ ...item.links });
  const [msg, setMsg] = useState('');
  function done() {
    if (!brand.trim() || !pack.trim()) { setMsg('Please give a brand and a pack size.'); return; }
    for (const a of APPS) { const v = (links[a] ?? '').trim(); if (v && !(/^https?:\/\//i.test(v) && v.toLowerCase().includes(DOMAIN[a]))) { setMsg(`The ${a} link does not look right. Copy it with Share in the ${a} app and paste it again.`); return; } }
    const clean: Record<string, string> = {}; APPS.forEach((a) => { const v = (links[a] ?? '').trim(); if (v) clean[a] = v; });
    if ((links._name ?? '').trim()) clean._name = links._name.trim();
    onDone({ ...item, brand: brand.trim(), pack: pack.trim(), links: clean });
  }
  return (
    <div className="sheet-back" onClick={onClose}><div className="sheet" onClick={(e) => e.stopPropagation()}>
      <div className="row" style={{ justifyContent: 'space-between' }}><b>Edit item</b><button className="btn quiet" onClick={onClose}>Close</button></div>
      <label className="field"><span>Item (from your Items list)</span><input value={item.name} disabled /></label>
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <label className="field" style={{ flex: 1 }}><span>Brand to check</span><Combo value={brand} list={brands} kind="brand" placeholder="Type or pick a brand" onChange={setBrand} /></label>
        <label className="field" style={{ width: 130 }}><span>Pack size</span><Combo value={pack} list={packs} kind="size" placeholder="e.g. 500 g" onChange={setPack} /></label>
      </div>
      <label className="field"><span>Product name on the apps (optional)</span><input value={links._name ?? ''} onChange={(e) => setLinks({ ...links, _name: e.target.value })} placeholder={`If the apps call it something else, e.g. Filter Coffee`} /></label>
      <p className="small muted">Links are optional. Compass finds the product by brand, item and pack size. If an app ever shows the wrong product, open the right one in that app, tap Share, copy the link and paste it here.</p>
      {APPS.map((a) => (
        <label key={a} className="field"><span>{a} {(links[a] ?? '').trim() ? <span className="chip done">Link added</span> : <span className="chip off">Finds it automatically</span>}</span>
          <input value={links[a] ?? ''} onChange={(e) => setLinks({ ...links, [a]: e.target.value })} placeholder={`Optional: ${a} product link`} /></label>))}
      {msg && <p className="pc-fail" style={{ textAlign: 'left' }}>{msg}</p>}
      <div className="row" style={{ marginTop: 'auto' }}>
        <button className="btn danger" style={{ marginRight: 'auto' }} onClick={onStop}>Stop checking</button>
        <button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={done}>Done</button></div>
    </div></div>
  );
}

function PickerSheet({ brands, packs, taken, onClose, onAdd }: { brands: string[]; packs: string[]; taken: number[]; onClose: () => void; onAdd: (l: { item_id: number; name: string; brand: string; pack: string }[]) => void }) {
  const [cat, setCat] = useState<CatItem[]>([]); const [groups, setGroups] = useState<{ id: number; name: string }[]>([]);
  const [q, setQ] = useState(''); const [shelf, setShelf] = useState('');
  const [pick, setPick] = useState<Record<number, { brand: string; pack: string }>>({});
  useEffect(() => { void (async () => {
    const [i, g] = await Promise.all([supabase.from('items').select('id, name, group_id').eq('active', true).order('name'), supabase.from('item_groups').select('id, name').eq('active', true).order('sort')]);
    setCat((i.data as CatItem[]) ?? []); setGroups((g.data as { id: number; name: string }[]) ?? []);
  })(); }, []);
  const gname = (id: number | null) => groups.find((g) => g.id === id)?.name ?? '';
  const list = cat.filter((m) => (!q || m.name.toLowerCase().includes(q.toLowerCase())) && (!shelf || String(m.group_id) === shelf)).slice(0, 120);
  const ids = Object.keys(pick).map(Number);
  const ok = ids.length > 0 && ids.every((i) => pick[i].brand.trim() && pick[i].pack.trim());
  return (
    <div className="sheet-back" onClick={onClose}><div className="sheet" onClick={(e) => e.stopPropagation()}>
      <div className="row" style={{ justifyContent: 'space-between' }}><b>Add items to the price check</b><button className="btn quiet" onClick={onClose}>Close</button></div>
      <p className="small muted">This is your Items list, nothing new to maintain. Tick the items you buy regularly, then give the brand and pack size to look for, for example Milky Mist, 200 g.</p>
      <div className="row" style={{ flexWrap: 'nowrap' }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items" /><select value={shelf} onChange={(e) => setShelf(e.target.value)}><option value="">All shelves</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
      <div className="pc-plist">
        {list.map((m) => { const dis = taken.includes(m.id); const on = pick[m.id] !== undefined; return (
          <div key={m.id} className={`pc-prow${dis ? ' dis' : ''}`}>
            <input type="checkbox" checked={on || dis} disabled={dis} onChange={(e) => setPick((p) => { const n = { ...p }; if (e.target.checked) n[m.id] = { brand: '', pack: '' }; else delete n[m.id]; return n; })} />
            <div><div>{m.name} <span className="pc-sub" style={{ display: 'inline' }}>{gname(m.group_id)}{dis ? ' · already in the price check' : ''}</span></div>
              {on && <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', marginTop: 6 }}>
                <div style={{ flex: 1 }}><Combo value={pick[m.id].brand} list={brands} kind="brand" placeholder="Brand" onChange={(v) => setPick((p) => ({ ...p, [m.id]: { ...p[m.id], brand: v } }))} /></div>
                <div style={{ width: 120 }}><Combo value={pick[m.id].pack} list={packs} kind="size" placeholder="Size" onChange={(v) => setPick((p) => ({ ...p, [m.id]: { ...p[m.id], pack: v } }))} /></div></div>}</div>
          </div>); })}
        {!list.length && <p className="muted small">No items match.</p>}
      </div>
      <div className="row" style={{ marginTop: 'auto' }}>
        <span className="small muted" style={{ marginRight: 'auto' }}>{ids.length && !ok ? 'Give a brand and a size for every ticked item' : ''}</span>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!ok} onClick={() => onAdd(ids.map((i) => ({ item_id: i, name: cat.find((c) => c.id === i)?.name ?? '', brand: pick[i].brand.trim(), pack: pick[i].pack.trim() })))}>{ids.length ? `Add ${ids.length} item${ids.length > 1 ? 's' : ''}` : 'Add'}</button></div>
    </div></div>
  );
}
