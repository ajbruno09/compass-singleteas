import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText, money } from '../lib/format';
import type { MenuCombo, MenuItem } from '../lib/types';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import seed from '../data/menu-seed.json';

type Filter = 'all' | 'active' | 'inactive' | 'check';

export function MenuItems() {
  const { profile, locations } = useSession();
  const toast = useToast();
  const isOwner = profile?.role === 'owner';
  const canAdd = isOwner || profile?.role === 'manager';
  const [items, setItems] = useState<MenuItem[]>([]);
  const [combos, setCombos] = useState<MenuCombo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<'items' | 'combos'>('items');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [loc, setLoc] = useState('all');
  const [editing, setEditing] = useState<MenuItem | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.from('menu_items').select('*').order('name').limit(2000),
      supabase.from('menu_combos').select('*').order('grp').order('name').limit(200)
    ]);
    setItems((a.data as MenuItem[]) ?? []); setCombos((b.data as MenuCombo[]) ?? []); setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const counters = locations.filter((l) => l.kind === 'department');
  const locName = (id: number | null) => counters.find((l) => l.id === id)?.name ?? '—';
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter((i) => (
      (filter === 'all' || (filter === 'check' ? i.needs_check : i.status === filter)) &&
      (loc === 'all' || String(i.location_id) === loc) &&
      (!t || i.name.toLowerCase().includes(t) || (i.pos_name ?? '').toLowerCase().includes(t) || (i.menu_group ?? '').toLowerCase().includes(t))
    ));
  }, [items, q, filter, loc]);
  const nActive = items.filter((i) => i.status === 'active').length;
  const nCheck = items.filter((i) => i.needs_check).length;

  async function toggle(i: MenuItem) {
    const next = i.status === 'active' ? 'inactive' : 'active';
    setItems((r) => r.map((x) => (x.id === i.id ? { ...x, status: next } : x)));
    const { error } = await supabase.from('menu_items').update({ status: next, updated_at: new Date().toISOString() }).eq('id', i.id);
    if (error) { toast(errText(error)); void load(); }
  }
  async function bulk(status: 'active' | 'inactive') {
    if (!shown.length || !window.confirm) return;
    setBusy(true);
    const { error } = await supabase.from('menu_items').update({ status, updated_at: new Date().toISOString() }).in('id', shown.map((s) => s.id));
    setBusy(false);
    if (error) toast(errText(error)); else toast(`${shown.length} items switched ${status === 'active' ? 'on' : 'off'}`);
    void load();
  }
  const [confirmBulk, setConfirmBulk] = useState<'active' | 'inactive' | null>(null);
  async function importMenu() {
    setBusy(true);
    const { data, error } = await supabase.rpc('import_menu', { p: seed });
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    const r = data as { items: number; combos: number };
    toast(`Loaded ${r.items} items and ${r.combos} combos`); void load();
  }

  if (!loaded) return <p className="muted">Loading…</p>;
  if (!items.length && !combos.length) {
    return (
      <>
        <div className="pagehead"><div><p className="label">What you sell</p><h1>Menu items</h1></div></div>
        <section className="card" style={{ display: 'grid', gap: 10, maxWidth: 560 }}>
          <h2>Load your menu list</h2>
          <p className="muted">This brings in the November menu ({(seed.items as { s: string }[]).filter((x) => x.s === 'active').length} items and {seed.combos.length} combos) and every older item from your Pet Pooja reports, switched off, so you never have to type them again.</p>
          {isOwner ? <button className="btn primary" disabled={busy} onClick={() => void importMenu()}>{busy ? 'Loading…' : 'Load menu list'}</button> : <p className="banner warn">Ask the owner to load the list.</p>}
        </section>
      </>
    );
  }

  return (
    <>
      <div className="pagehead">
        <div><p className="label">What you sell</p><h1>Menu items</h1></div>
        {canAdd && tab === 'items' && <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" />Add item</button>}
      </div>
      <p className="muted">{nActive} on the menu, {items.length - nActive} switched off{nCheck ? `, ${nCheck} to check` : ''}. Each item belongs to one counter. Switch an item off to keep it for later, or delete it for good.</p>
      <div className="seg" role="group" aria-label="View">
        <button aria-pressed={tab === 'items'} onClick={() => setTab('items')}>Items</button>
        <button aria-pressed={tab === 'combos'} onClick={() => setTab('combos')}>Combos ({combos.length})</button>
      </div>

      {tab === 'items' ? (
        <>
          <div className="row" style={{ gap: 10 }}>
            <div className="searchbox" style={{ flex: '1 1 220px' }}><Icon name="search" size={18} /><input id="menu-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or group" /></div>
            <select id="menu-loc" value={loc} onChange={(e) => setLoc(e.target.value)} aria-label="Counter"><option value="all">All counters</option>{counters.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            <div className="seg" role="group" aria-label="Show">
              {([['all', 'All'], ['active', 'On'], ['inactive', 'Off'], ['check', 'To check']] as [Filter, string][]).map(([f, l]) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{l}</button>)}
            </div>
          </div>
          {isOwner && (loc !== 'all' || filter !== 'all' || q) && shown.length > 0 && shown.length < items.length && (
            <div className="row" style={{ gap: 8 }}>
              <span className="small muted">{shown.length} shown:</span>
              {confirmBulk
                ? <><button className="btn primary" disabled={busy} onClick={() => { const s = confirmBulk; setConfirmBulk(null); void bulk(s); }}>Yes, switch {shown.length} items {confirmBulk === 'active' ? 'on' : 'off'}</button><button className="btn quiet" onClick={() => setConfirmBulk(null)}>Cancel</button></>
                : <><button className="btn secondary" onClick={() => setConfirmBulk('inactive')}>Switch all off</button><button className="btn secondary" onClick={() => setConfirmBulk('active')}>Switch all on</button></>}
            </div>
          )}
          <div className="tablewrap">
            <table>
              <thead><tr><th>Item</th><th>Counter</th><th>Group</th><th className="r">Price</th><th style={{ width: 90 }}>On menu</th></tr></thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} className="click" onClick={() => setEditing(i)} style={{ opacity: i.status === 'inactive' ? 0.6 : 1 }}>
                    <td><strong>{i.name}</strong>{i.needs_check && <span className="chip late" style={{ marginLeft: 8 }}>Check</span>}
                      {i.pos_name && i.pos_name !== i.name && <div className="small muted">Pet Pooja: {i.pos_name}</div>}
                      {!i.pos_name && <div className="small" style={{ color: 'var(--warn)' }}>Not in Pet Pooja yet</div>}</td>
                    <td className="small">{locName(i.location_id)}</td>
                    <td className="small">{i.menu_group ?? '—'}</td>
                    <td className="r num">{i.price != null ? money(i.price) : '—'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className={'chip ' + (i.status === 'active' ? 'done' : 'off')} style={{ border: 0, cursor: 'pointer', height: 28 }} aria-pressed={i.status === 'active'} onClick={() => void toggle(i)}>{i.status === 'active' ? 'On' : 'Off'}</button>
                    </td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={5} className="muted">Nothing matches.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Combo</th><th>What is in it</th><th className="r">Price</th></tr></thead>
            <tbody>{combos.map((c) => <tr key={c.id}><td><strong>{c.name}</strong><div className="small muted">{c.grp}</div></td><td className="small">{c.parts}</td><td className="r num">{money(c.price)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {editing && <ItemForm item={editing === 'new' ? null : editing} isOwner={isOwner} canEditAll={canAdd} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
    </>
  );
}

function ItemForm({ item, isOwner, canEditAll, onClose, onSaved }: { item: MenuItem | null; isOwner: boolean; canEditAll: boolean; onClose: () => void; onSaved: () => void }) {
  const { locations } = useSession();
  const toast = useToast();
  const counters = locations.filter((l) => l.kind === 'department');
  const [name, setName] = useState(item?.name ?? '');
  const [pos, setPos] = useState(item?.pos_name ?? '');
  const [price, setPrice] = useState(item?.price != null ? String(item.price) : '');
  const [group, setGroup] = useState(item?.menu_group ?? '');
  const [locId, setLocId] = useState(String(item?.location_id ?? ''));
  const [status, setStatus] = useState<'active' | 'inactive'>(item?.status ?? 'active');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);

  async function save() {
    setError('');
    if (!name.trim()) return setError('Enter the item name.');
    if (!locId) return setError('Choose the counter this item belongs to.');
    setBusy(true);
    const row = { name: name.trim(), pos_name: pos.trim() || null, price: price ? Number(price) : null, menu_group: group.trim() || null, location_id: Number(locId), status, needs_check: false, updated_at: new Date().toISOString() };
    const r = item ? await supabase.from('menu_items').update(canEditAll ? row : { location_id: row.location_id, status, needs_check: false }).eq('id', item.id)
      : await supabase.from('menu_items').insert({ ...row, menu_page: 'Added in SToMS', note: '' });
    setBusy(false);
    if (r.error) return setError(r.error.message.includes('menu_items_name_key') ? 'An item with this name already exists.' : errText(r.error));
    toast('Saved'); onSaved();
  }
  async function purge() {
    if (!item) return;
    setBusy(true);
    const { error } = await supabase.rpc('purge_menu_item', { p_id: item.id });
    setBusy(false);
    if (error) return setError(errText(error));
    toast(`${item.name} deleted`); onSaved();
  }

  return (
    <Sheet title={item ? item.name : 'Add item'} onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-grid">
        <label className="field"><span>Name</span><input id="mi-name" value={name} disabled={!!item && !canEditAll} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Name in Pet Pooja</span><input id="mi-pos" value={pos} disabled={!!item && !canEditAll} onChange={(e) => setPos(e.target.value)} placeholder="Exactly as it appears in the report" /></label>
        <label className="field"><span>Counter</span><select id="mi-loc" value={locId} onChange={(e) => setLocId(e.target.value)}><option value="">Choose…</option>{counters.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label className="field"><span>Group</span><input id="mi-group" value={group} disabled={!!item && !canEditAll} onChange={(e) => setGroup(e.target.value)} /></label>
        <label className="field"><span>Price (₹, with GST)</span><input id="mi-price" className="num" inputMode="decimal" disabled={!!item && !canEditAll} value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
        <label className="field"><span>On the menu?</span><select id="mi-status" value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}><option value="active">On the menu</option><option value="inactive">Switched off (kept for later)</option></select></label>
      </div>
      {item?.note && <p className="small muted">{item.note}</p>}
      {error && <p className="banner bad" role="alert">{error}</p>}
      {item && isOwner && (
        <div className="card" style={{ display: 'grid', gap: 8 }}>
          <b>Delete for good</b>
          <p className="small muted">Removes this item from SToMS. Use it only if you will never bring it back. Switching it off is safer.</p>
          {sure ? <div className="row" style={{ gap: 8 }}><button className="btn primary" style={{ background: 'var(--bad)' }} disabled={busy} onClick={() => void purge()}>Yes, delete {item.name}</button><button className="btn quiet" onClick={() => setSure(false)}>Keep it</button></div>
            : <button className="btn secondary" style={{ justifySelf: 'start' }} onClick={() => setSure(true)}><Icon name="trash" /> Delete</button>}
        </div>
      )}
    </Sheet>
  );
}
