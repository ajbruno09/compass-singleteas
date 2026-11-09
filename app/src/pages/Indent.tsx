import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText, qty as fmtQty, packFactor, round3 } from '../lib/format';
import { clock12, dayLabel, isSealed, sealTime, timeOf, windowState, type Reminders } from '../lib/ist';
import { REASONS, type DeptItem, type Group, type IndentReason, type IndentRec, type Usual } from '../lib/types';
import { useToast } from '../components/Toast';
import { AvatarButton } from '../components/AvatarButton';
import { Icon } from '../components/Icon';
import { useReceiveGate } from '../lib/gate';
import { Sheet } from '../components/Sheet';
import { useLang } from '../lib/i18n';
import { VoiceOrder, voiceSupported } from '../components/VoiceOrder';

interface Line { qty: number; reason: string }
type View = { kind: 'groups' } | { kind: 'group'; id: number } | { kind: 'usual' } | { kind: 'search' };

const round = (n: number) => Math.round(n * 1000) / 1000;
const stepOf = (i: DeptItem) => { const q = (i.quick_amounts ?? []).filter((n) => n > 0); return q.length ? Math.min(...q) : 1; };
const addLabel = (n: number, unit: string) => {
  if (unit === 'kg' && n < 1) return `+${Math.round(n * 1000)} g`;
  if (unit === 'L' && n < 1) return `+${Math.round(n * 1000)} ml`;
  return `+${n}`;
};

const CAT_PHOTO: Record<number, string> = { 1: 'veg', 2: 'dairy', 3: 'chicken', 4: 'atta', 5: 'spices', 6: 'sauces', 7: 'frozen', 17: 'kitchen', 18: 'oilsalt', 9: 'bread', 10: 'drinks', 11: 'icecream', 12: 'packaging', 13: 'cleaning', 14: 'gas', 15: 'stationery', 16: 'dryfruits' };

export function IndentPage() {
  const { myLocations, party } = useSession();
  const pickLocs = party?.open ? [...myLocations, party.loc] : myLocations;
  const toast = useToast();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const locId = Number(sp.get('loc')) || myLocations[0]?.id || null;
  const where = pickLocs.find((l) => l.id === locId)?.name ?? '';
  const isParty = !!party?.open && locId === party.loc.id;
  const gate = useReceiveGate(locId ? [locId] : []);
  const blocked = !!(locId && gate.gates[locId]?.blocked);

  const [items, setItems] = useState<DeptItem[]>([]);
  const facRef = useRef<Record<number, number>>({});
  const [groups, setGroups] = useState<Group[]>([]);
  const [usual, setUsual] = useState<Record<number, Usual>>({});
  const [indent, setIndent] = useState<IndentRec | null>(null);
  const [lines, setLines] = useState<Record<number, Line>>({});
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>({ kind: 'groups' });
  const [q, setQ] = useState('');
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rem, setRem] = useState<Reminders>({});
  const [reasons, setReasons] = useState<IndentReason[]>([]);
  const [req, setReq] = useState<{ status: string; reason: string; decision_note: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [accepted, setAccepted] = useState<Record<number, boolean>>({});
  const [ask, setAsk] = useState(false);
  const [lastNight, setLastNight] = useState<Record<number, { qty: number; issued: number }> | null>(null);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const { t, hi, local, extra: lang, toggle, canSwitch, unit: u, group: gname } = useLang();
  const [voice, setVoice] = useState(false);
  const timers = useRef<Record<number, number>>({});
  // Opening a category adds a history step, so the phone's own back button returns to the category grid first.
  const openView = (v: View) => { try { window.history.pushState({ ...(window.history.state || {}), cv: 1 }, ''); } catch { /* ignore */ } setView(v); };
  const toGroups = () => { setQ(''); let pushed = false; try { pushed = !!window.history.state?.cv; } catch { /* ignore */ } if (pushed) window.history.back(); else setView({ kind: 'groups' }); };
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 20000); return () => window.clearInterval(id); }, []);
  useEffect(() => { const pop = () => { setView({ kind: 'groups' }); setQ(''); }; window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);

  const [lpg, setLpg] = useState<{ gas_left_kg: number | null; in_use: number; issued_today: boolean } | null>(null);
  useEffect(() => { if (locId == null) return; supabase.rpc('lpg_status', { p_location: locId }).then(({ data }) => setLpg((data as typeof lpg) ?? null)); }, [locId]);
  const lpgNote = lpg?.gas_left_kg != null ? t('About {n} kg of gas left in your cylinder.', { n: String(lpg.gas_left_kg) }) : lpg?.issued_today ? t('A cylinder was already issued to you today.') : undefined;
  const label = useCallback((i: DeptItem) => (local && lang && i.local_names?.[lang]) || i.name, [local, lang]);
  void hi;

  const load = useCallback(async () => {
    if (locId == null) return;
    setLoading(true);
    const [it, gr, us, win, ind] = await Promise.all([
      supabase.rpc('department_items', { p_location_id: locId }),
      supabase.from('item_groups').select('*').order('sort'),
      supabase.rpc('my_usual', { p_location_id: locId }),
      supabase.rpc('indent_window'),
      supabase.rpc('open_indent', { p_location_id: locId })
    ]);
    if (ind.error) { toast(errText(ind.error)); setLoading(false); return; }
    const raw = (it.data as DeptItem[]) ?? [];
    const fac: Record<number, number> = {};
    for (const i of raw) { const f = packFactor(i); if (f) fac[i.id] = f; }
    facRef.current = fac;
    const dv = (id: number, n: number) => (fac[id] ? round3(n / fac[id]) : n);
    setItems(raw.map((i) => (fac[i.id] ? { ...i, unit: i.show_as as string, quick_amounts: [1, 2, 3, 4, 5] } : i)));
    setGroups((gr.data as Group[]) ?? []);
    setUsual(Object.fromEntries(((us.data as Usual[]) ?? []).map((u) => [u.item_id, { ...u, usual: dv(u.item_id, Number(u.usual)), last_qty: dv(u.item_id, Number(u.last_qty)) }])));
    setRem((win.data as Reminders) ?? {});
    const rec = ind.data as IndentRec;
    setIndent(rec);
    const lc = await supabase.rpc('last_closing', { p_location_id: locId });
    const lrows = (lc.data as { item_id: number; qty: number; counted_at: string; issued_since: number }[] | null) ?? [];
    setLastNight(Object.fromEntries(lrows.map((r) => [r.item_id, { qty: dv(r.item_id, Number(r.qty)), issued: dv(r.item_id, Number(r.issued_since)) }])));
    setClosedAt(lrows[0]?.counted_at ?? null);
    const [rs, rq] = await Promise.all([
      supabase.from('indent_reasons').select('*').eq('active', true).order('sort'),
      supabase.from('indent_reopen_requests').select('status, reason, decision_note').eq('indent_id', rec.id).order('created_at', { ascending: false }).limit(1)
    ]);
    setReasons((rs.data as IndentReason[]) ?? []);
    setReq(((rq.data as { status: string; reason: string; decision_note: string }[]) ?? [])[0] ?? null);
    const ln = await supabase.from('indent_lines').select('item_id, qty, reason').eq('indent_id', rec.id);
    setLines(Object.fromEntries(((ln.data as { item_id: number; qty: number; reason: string | null }[]) ?? []).map((l) => [l.item_id, { qty: dv(l.item_id, Number(l.qty)), reason: l.reason ?? '' }])));
    setLoading(false);
  }, [locId, toast]);
  useEffect(() => { setView({ kind: 'groups' }); setQ(''); void load(); }, [load]);

  const sealed = indent && !isParty ? isSealed(indent, rem, now) : false;
  const editable = indent?.status === 'draft' && !sealed;
  const moreReasons = reasons.filter((r) => r.kind === 'more').map((r) => r.label);
  const missedReasons = reasons.filter((r) => r.kind === 'missed').map((r) => r.label);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  function flagged(i: DeptItem, l: Line | undefined) {
    const u = usual[i.id];
    return Boolean(l && u && u.runs >= 2 && l.qty > u.usual * 1.5 && l.qty - u.usual >= stepOf(i));
  }

  function save(i: DeptItem, next: Line | null) {
    if (!indent) return;
    setLines((cur) => { const c = { ...cur }; if (!next || next.qty <= 0) delete c[i.id]; else c[i.id] = next; return c; });
    window.clearTimeout(timers.current[i.id]);
    timers.current[i.id] = window.setTimeout(async () => {
      const { error } = await supabase.rpc('set_indent_line', {
        p_indent_id: indent.id, p_item_id: i.id, p_qty: round3((next?.qty ?? 0) * (facRef.current[i.id] ?? 1)), p_reason: next?.reason ?? null, p_method: 'tap'
      });
      if (error) { toast(errText(error)); void load(); }
    }, 450);
  }
  const setQty = (i: DeptItem, n: number, keepReason = true) => {
    const v = facRef.current[i.id] ? Math.round(Math.max(0, n)) : round(Math.max(0, n));
    save(i, v > 0 ? { qty: v, reason: keepReason ? (lines[i.id]?.reason ?? '') : '' } : null);
  };

  const chosen = Object.keys(lines).length;
  const missingReason = items.filter((i) => flagged(i, lines[i.id]) && (!lines[i.id].reason || !accepted[i.id]));

  async function send(nothing = false) {
    if (!indent) return;
    setBusy(true);
    // Make sure every pending change has reached the server first.
    await new Promise((r) => window.setTimeout(r, 700));
    const { data, error } = await supabase.rpc('submit_indent', { p_indent_id: indent.id, p_nothing: nothing });
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    setIndent(data as IndentRec); setReview(false);
    toast(t('Sent to the store'));
  }
  async function reopen() {
    if (!indent) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('reopen_indent', { p_indent_id: indent.id });
    setBusy(false);
    if (error) { toast(errText(error)); void load(); return; }
    setIndent(data as IndentRec);
  }

  const win = windowState(rem);
  const winChip = win === 'open' ? <span className="chip done">{t('Open until {time}', { time: clock12(rem.indent_due ?? '17:00') })}</span>
    : win === 'early' ? <span className="chip due">{t('Opens {time}, you can start now', { time: clock12(rem.indent_open ?? '15:30') })}</span>
    : indent && sealed ? <span className="chip late">{t('Closed')}</span>
    : <span className="chip late">{indent ? t('Late. Closes at {time}', { time: timeOf(new Date(sealTime(indent.for_date, rem)).toISOString()) }) : t('Past {time}, send as soon as you can', { time: clock12(rem.indent_due ?? '17:00') })}</span>;

  const visible = useMemo(() => {
    if (view.kind === 'search') {
      const t = q.trim().toLowerCase();
      return t ? items.filter((i) => i.name.toLowerCase().includes(t) || (i.local_names && Object.values(i.local_names).some((v) => v?.toLowerCase().includes(t)))) : [];
    }
    if (view.kind === 'group') return items.filter((i) => i.group_id === view.id);
    if (view.kind === 'usual') return items.filter((i) => usual[i.id]).sort((a, b) => usual[b.id].runs - usual[a.id].runs || a.name.localeCompare(b.name));
    return [];
  }, [view, items, q, usual]);

  const groupInfo = useMemo(() => groups.map((g) => {
    const inG = items.filter((i) => i.group_id === g.id);
    return { g, count: inG.length, picked: inG.filter((i) => lines[i.id]).length };
  }).filter((x) => x.count > 0), [groups, items, lines]);

  if (locId == null) return <div className="phone"><p className="empty card">{t('No counter is set up for you yet.')}</p></div>;

  if (blocked) {
    return (
      <div className="phone">
        <div className="phone-head"><button className="btn quiet" onClick={() => nav('/')} aria-label="Back"><Icon name="back" /></button><b>{t('{where} indent', { where })}</b><AvatarButton /></div>
        <div className="banner bad" style={{ display: 'grid', gap: 8 }}>
          <b>{t('Yesterday\'s items are not received yet')}</b>
          <span className="small">{t('The store issued items that you have not confirmed. Please receive them first. It takes a minute.')}</span>
          <button className="btn primary" style={{ minHeight: 48 }} onClick={() => nav(`/received?loc=${locId}`)}>{t('Go to Receive')}</button>
        </div>
        <p className="small muted">{t('Admin can release this if there is a real reason.')}</p>
      </div>
    );
  }
  return (
    <div className="phone">
      <div className="phone-head">
        <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          {view.kind === 'groups'
            ? <button className="btn quiet" onClick={() => nav('/')} aria-label="Back"><Icon name="back" /></button>
            : <button className="btn backcat" onClick={toGroups} aria-label={t('Back to categories')}><Icon name="back" />{t('Categories')}</button>}
          <div>
            <p style={{ font: '800 20px/22px var(--font-display)' }}>{view.kind === 'group' ? (() => { const g = groups.find((x) => x.id === view.id); return g ? gname(g.id, g.name) : where; })() : view.kind === 'usual' ? t('My usual') : view.kind === 'search' ? t('Search') : t('{where} indent', { where })}</p>
            <p className="small muted">{t('For {day}', { day: indent ? dayLabel(indent.for_date) : t('tomorrow') })}</p>
          </div>
        </div>
        {canSwitch && <div className="langsw" role="group" aria-label="Language"><button aria-pressed={local} onClick={() => { if (!local) toggle(); }}>हिंदी</button><button aria-pressed={!local} onClick={() => { if (local) toggle(); }}>English</button></div>}
        <AvatarButton />
      </div>

      <div className={`notice ${isParty || win === 'open' ? 'ok' : win === 'early' ? 'info' : 'warn'}`}>{isParty ? <span className="chip done">{t('Party order')}: {party!.label}{party!.until ? ` · ${t('until')} ${new Date(party!.until).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}` : ''}</span> : winChip}</div>
      {pickLocs.length > 1 && (
        <div className="cpills" role="group" aria-label="Counter">
          {pickLocs.map((l) => <button key={l.id} aria-pressed={l.id === locId} onClick={() => setSp({ loc: String(l.id) })}>{party && l.id === party.loc.id ? `${t('Party')}: ${party.label}` : l.name}</button>)}
        </div>
      )}

      {loading ? <p className="muted">{t('Loading…')}</p> : !indent ? null : !editable ? (
        <Sent indent={indent} lines={lines} itemById={itemById} label={label} onReopen={reopen} busy={busy} sealed={sealed} req={req} onAsk={() => setAsk(true)} />
      ) : (
        <>
          <div className="searchrow"><label className="field"><span className="small muted" style={{ fontWeight: 400 }}>{t('Find an item')}</span>
            <div className="searchbox"><Icon name="search" size={18} />
              <input value={q} placeholder={t('Type a few letters')} onChange={(e) => { setQ(e.target.value); setView(e.target.value ? { kind: 'search' } : { kind: 'groups' }); }} />
            </div>
          </label>
          {voiceSupported() && editable && <button className="micbtn" aria-label={t('Speak your order')} onClick={() => setVoice(true)}><Icon name="mic" size={22} /></button>}
          </div>

          {editable && lastNight && !isParty && (
            <p className={'banner ' + (closedAt ? 'warn' : 'bad')} style={{ fontSize: 13, fontWeight: 400, margin: 0, padding: '8px 12px' }}>
              {closedAt ? t('Check your stock before ordering. Last count: {time}.', { time: timeOf(closedAt) }) : t('Check your stock before ordering. No count was sent last night.')}
            </p>
          )}

          {view.kind === 'groups' && (
            <>
              {!isParty && <button className="usualbar" onClick={() => openView({ kind: 'usual' })} disabled={Object.keys(usual).length === 0}>
                <span className="ustar">★</span>
                <span className="utext"><b>{t('My usual')}</b><span className="small muted">{Object.keys(usual).length ? t('{n} items you ask for often', { n: Object.keys(usual).length }) : t('Fills in after your first few indents')}</span></span>
                <span className="uarrow" aria-hidden="true">›</span>
              </button>}
              <div className="groupgrid">
                {groupInfo.map(({ g, count, picked }) => (
                  <button key={g.id} className="grouptile" onClick={() => openView({ kind: 'group', id: g.id })}>
                    {picked > 0 && <span className="badge">{picked}</span>}
                    <span className="gphoto">{CAT_PHOTO[g.id] ? <img src={`/cats/${CAT_PHOTO[g.id]}.jpg`} alt="" loading="lazy" /> : <span className="emoji">{g.icon || '🧾'}</span>}</span>
                    <span className="gtext"><span className="gname">{gname(g.id, g.name)}</span>
                    <span className="small muted">{count} {count === 1 ? t('item') : t('items')}</span></span>
                  </button>
                ))}
              </div>
            </>
          )}

          {view.kind !== 'groups' && (
            <>
              {visible.length === 0 ? <p className="empty card">{view.kind === 'search' ? t('No item with that name on your counter.') : t('Nothing here yet.')}</p> : (
                <div className="stack">
                  {visible.map((i) => (
                    <ItemRow key={i.id} item={i} name={label(i)} line={lines[i.id]} usual={usual[i.id]} flag={flagged(i, lines[i.id])} night={lastNight?.[i.id]}
                      extra={i.id === 658 ? lpgNote : undefined} onQty={(n) => setQty(i, n)} onReason={(r) => lines[i.id] && save(i, { qty: lines[i.id].qty, reason: r })} reasonList={moreReasons} />
                  ))}
                </div>
              )}
            </>
          )}

          <div className="cartbar">
            <div><b className="num">{chosen}</b> <span className="muted">{chosen === 1 ? t('item chosen') : t('items chosen')}</span></div>
            {chosen > 0
              ? <button className="btn primary" onClick={() => setReview(true)}>{t('Review and send')}</button>
              : <button className="btn secondary" disabled={busy} onClick={() => { if (window.confirm(t('Tell the store you need nothing for tomorrow?'))) void send(true); }}>{t('Nothing needed')}</button>}
          </div>
        </>
      )}

      {review && indent && (
        <Sheet title={t('Check your indent')} onClose={() => setReview(false)}
          footer={<button className="btn primary floor" disabled={busy || missingReason.length > 0} onClick={() => void send(false)}>{busy ? t('Sending…') : t('Send to store')}</button>}>
          {missingReason.length > 0 && <p className="banner warn">{missingReason.length === 1 ? t('One item is well above your usual. Tick that you are sure, and tell the store why.') : t('{n} items are well above your usual. Tick that you are sure, and tell the store why.', { n: missingReason.length })}</p>}
          <div className="card" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="muted">{t('Cart value')}</span>
            <span className="chip off">{t('Coming soon')}</span>
          </div>
          {items.filter((i) => lines[i.id]).map((i) => (
            <div key={i.id} className="card" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <b>{label(i)}</b>
                <span className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                  <b className="num">{fmtQty(lines[i.id].qty, i.unit).replace(i.unit, u(i.unit))}</b>
                  <button className="btn quiet" onClick={() => setQty(i, 0)} aria-label={`${t('Remove')} ${i.name}`}><Icon name="trash" size={18} /></button>
                </span>
              </div>
              {flagged(i, lines[i.id]) && (<>
                <Reasons value={lines[i.id].reason} onPick={(r) => save(i, { qty: lines[i.id].qty, reason: r })} list={moreReasons} />
                <label className="row" style={{ gap: 8, marginTop: 8, fontWeight: 600 }}>
                  <input type="checkbox" checked={!!accepted[i.id]} onChange={(e) => setAccepted((a) => ({ ...a, [i.id]: e.target.checked }))} />
                  {t('Yes, I really need {q}. My usual is {u}.', { q: fmtQty(lines[i.id].qty, i.unit).replace(i.unit, u(i.unit)), u: fmtQty(usual[i.id]?.usual ?? 0, i.unit).replace(i.unit, u(i.unit)) })}
                </label></>)}
            </div>
          ))}
        </Sheet>
      )}

      {ask && indent && <AskOpen indentId={indent.id} reasons={missedReasons} onClose={() => setAsk(false)} onDone={() => { setAsk(false); void load(); }} />}

      {voice && <VoiceOrder items={items} label={label} onClose={() => setVoice(false)}
        onAdd={(ls) => { ls.forEach((l) => setQty(l.item, l.qty)); toast(t('Added {n} items by voice', { n: ls.length })); }} />}

    </div>
  );
}

function ItemRow({ item, name, line, usual, flag, night, extra, onQty, onReason, reasonList }: {
  extra?: string; item: DeptItem; name: string; line?: Line; usual?: Usual; flag: boolean; night?: { qty: number; issued: number }; onQty: (n: number) => void; onReason: (r: string) => void; reasonList: string[];
}) {
  const { t, unit: u } = useLang();
  const step = stepOf(item);
  const [typing, setTyping] = useState(false);
  const [txt, setTxt] = useState('');
  const quicks = (item.quick_amounts ?? []).filter((n) => n > 0);
  const cur = line?.qty ?? 0;
  return (
    <div className={'irow' + (line ? ' has' : '') + (flag && !line?.reason ? ' flag' : '')}>
      <div className="irow-top">
        <div className="pic">{name.slice(0, 1)}</div>
        <div className="irow-name"><b>{name}</b>{item.pack_note ? <span className="small muted"> · {item.pack_note}</span> : null}
          <div className="small muted">{t('in {unit}', { unit: u(item.unit) })}</div></div>
        <div className="stepper">
          <button onClick={() => onQty(cur - step)} disabled={cur <= 0} aria-label={`${t('Less')} ${name}`}>−</button>
          {typing ? (
            <input autoFocus inputMode="decimal" value={txt} className="num qin" onChange={(e) => setTxt(e.target.value)}
              onBlur={() => { const n = parseFloat(txt.replace(',', '.')); if (!Number.isNaN(n)) onQty(n); setTyping(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          ) : (
            <button className="qval num" onClick={() => { setTxt(cur ? String(cur) : ''); setTyping(true); }} aria-label={`${t('Type amount')} ${name}`}>{cur ? fmtQty(cur, item.unit).replace(item.unit, u(item.unit)) : '0'}</button>
          )}
          <button onClick={() => onQty(cur + step)} aria-label={`${t('More')} ${name}`}>+</button>
        </div>
      </div>
      <div className="chips">
        {quicks.map((n) => <button key={n} className="qchip" onClick={() => onQty(cur + n)}>{addLabel(n, item.unit)}</button>)}
        {usual && <button className="qchip usualchip" onClick={() => onQty(usual.runs >= 2 ? usual.usual : usual.last_qty)}>
          {usual.runs >= 2 ? t('Usual {q}', { q: fmtQty(usual.usual, item.unit).replace(item.unit, u(item.unit)) }) : t('Last {q}', { q: fmtQty(usual.last_qty, item.unit).replace(item.unit, u(item.unit)) })}</button>}
        {cur > 0 && <button className="qchip" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, color: '#B3261E' }} onClick={() => { setTyping(false); onQty(0); }} aria-label={`${t('Clear')} ${name}`}><Icon name="trash" size={14} />{t('Clear')}</button>}
      </div>
      {extra && <p className="small muted" style={{ margin: '6px 0 0' }}>{extra}</p>}
      {night && <p className="small" style={{ margin: '6px 0 0', color: 'var(--muted, #5C6B63)' }}>{t('Last night you counted')} <b>{fmtQty(night.qty, item.unit).replace(item.unit, u(item.unit))}</b>{night.issued > 0 ? ` · ${t('store issued')} ${fmtQty(night.issued, item.unit).replace(item.unit, u(item.unit))}` : ''}.{night.qty > 0 && (line?.qty ?? 0) > 0 && usual && usual.usual > 0 && night.qty + night.issued >= usual.usual ? <b style={{ color: '#B3541E' }}> {t('That may already be enough. Check before you order.')}</b> : null}</p>}
      {flag && <Reasons value={line?.reason ?? ''} onPick={onReason} list={reasonList} />}
    </div>
  );
}

function Reasons({ value, onPick, list }: { value: string; onPick: (r: string) => void; list: string[] }) {
  const { t } = useLang();
  return (
    <div className="reasons" role="group" aria-label={t('Why more than usual')}>
      <span className="small" style={{ fontWeight: 600 }}>{t('More than your usual. Why?')}</span>
      <div className="seg">{(list.length ? list : REASONS).map((r) => <button key={r} aria-pressed={value === r} onClick={() => onPick(r)}>{t(r)}</button>)}</div>
    </div>
  );
}

function Sent({ indent, lines, itemById, label, onReopen, busy, sealed, req, onAsk }: {
  indent: IndentRec; lines: Record<number, Line>; itemById: Map<number, DeptItem>; label: (i: DeptItem) => string; onReopen: () => void; busy: boolean; sealed: boolean; req: { status: string; reason: string; decision_note: string } | null; onAsk: () => void;
}) {
  const { t, unit: u } = useLang();
  const ids = Object.keys(lines).map(Number);
  return (
    <div className="stack">
      {sealed && <p className="banner warn">{indent.outcome === 'missed' ? t('This indent was not sent in time and is now closed.') : t('This indent is closed. The store is working on it.')}</p>}
      {sealed && req?.status === 'pending' && <p className="banner">{t('You asked Admin to open it. Please wait for the answer.')}</p>}
      {sealed && req?.status === 'declined' && <p className="banner warn">{t('Admin did not open it.')} {req.decision_note}</p>}
      {sealed && (!req || req.status !== 'pending') && <button className="btn primary floor" onClick={onAsk}>{t('Ask Admin to open it')}</button>}
      {!sealed && <p className="banner ok">
        {indent.status === 'locked' ? t('The store is working on this indent.') : indent.nothing_needed ? t('You told the store you need nothing. Sent {time}.', { time: timeOf(indent.submitted_at) }) : t('Sent to the store at {time}.', { time: timeOf(indent.submitted_at) })}
      </p>}
      {ids.length > 0 && (
        <div className="card stack">
          {ids.map((id) => { const i = itemById.get(id); return i ? (
            <div key={id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <span>{label(i)}</span><b className="num">{fmtQty(lines[id].qty, i.unit).replace(i.unit, u(i.unit))}</b>
            </div>) : null; })}
        </div>
      )}
      {!sealed && indent.status === 'submitted' && <button className="btn secondary floor" disabled={busy} onClick={onReopen}>{t('Change something')}</button>}
    </div>
  );
}

function AskOpen({ indentId, reasons, onClose, onDone }: { indentId: string; reasons: string[]; onClose: () => void; onDone: () => void }) {
  const { t } = useLang();
  const toast = useToast();
  const [why, setWhy] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const { error } = await supabase.rpc('request_indent_reopen', { p_indent_id: indentId, p_reason: why, p_note: note });
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    toast(t('Sent to Admin')); onDone();
  }
  return (
    <Sheet title={t('Ask Admin to open the indent')} onClose={onClose}
      footer={<button className="btn primary floor" disabled={busy || !why} onClick={() => void go()}>{busy ? t('Sending…') : t('Send to Admin')}</button>}>
      <p className="muted">{t('Why was the indent not sent in time?')}</p>
      <div className="stack">{reasons.map((r) => <button key={r} className="btn secondary floor" aria-pressed={why === r} onClick={() => setWhy(r)}>{t(r)}</button>)}</div>
      <label className="field"><span>{t('Anything to add (optional)')}</span><input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></label>
    </Sheet>
  );
}
