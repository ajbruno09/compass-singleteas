import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText, qty as fmtQty } from '../lib/format';
import { clock12, dayLabel, timeOf, windowState, type Reminders } from '../lib/ist';
import { REASONS, type DeptItem, type Group, type IndentRec, type Usual } from '../lib/types';
import { useToast } from '../components/Toast';
import { AvatarButton } from '../components/AvatarButton';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { SosButton } from '../components/Sos';
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

const CAT_PHOTO: Record<number, string> = { 1: 'veg', 2: 'dairy', 3: 'chicken', 4: 'atta', 5: 'spices', 6: 'sauces', 7: 'frozen', 17: 'kitchen', 9: 'bread', 10: 'drinks', 11: 'icecream', 12: 'packaging', 13: 'cleaning', 14: 'gas', 15: 'stationery', 16: 'dryfruits' };

export function IndentPage() {
  const { myLocations } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const locId = Number(sp.get('loc')) || myLocations[0]?.id || null;
  const where = myLocations.find((l) => l.id === locId)?.name ?? '';

  const [items, setItems] = useState<DeptItem[]>([]);
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
  const { t, hi, local, extra: lang, toggle, canSwitch, unit: u, group: gname } = useLang();
  const [voice, setVoice] = useState(false);
  const timers = useRef<Record<number, number>>({});
  // Opening a category adds a history step, so the phone's own back button returns to the category grid first.
  const openView = (v: View) => { try { window.history.pushState({ ...(window.history.state || {}), cv: 1 }, ''); } catch { /* ignore */ } setView(v); };
  const toGroups = () => { setQ(''); let pushed = false; try { pushed = !!window.history.state?.cv; } catch { /* ignore */ } if (pushed) window.history.back(); else setView({ kind: 'groups' }); };
  useEffect(() => { const pop = () => { setView({ kind: 'groups' }); setQ(''); }; window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);

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
    setItems((it.data as DeptItem[]) ?? []);
    setGroups((gr.data as Group[]) ?? []);
    setUsual(Object.fromEntries(((us.data as Usual[]) ?? []).map((u) => [u.item_id, { ...u, usual: Number(u.usual), last_qty: Number(u.last_qty) }])));
    setRem((win.data as Reminders) ?? {});
    const rec = ind.data as IndentRec;
    setIndent(rec);
    const ln = await supabase.from('indent_lines').select('item_id, qty, reason').eq('indent_id', rec.id);
    setLines(Object.fromEntries(((ln.data as { item_id: number; qty: number; reason: string | null }[]) ?? []).map((l) => [l.item_id, { qty: Number(l.qty), reason: l.reason ?? '' }])));
    setLoading(false);
  }, [locId, toast]);
  useEffect(() => { setView({ kind: 'groups' }); setQ(''); void load(); }, [load]);

  const editable = indent?.status === 'draft';
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
        p_indent_id: indent.id, p_item_id: i.id, p_qty: next?.qty ?? 0, p_reason: next?.reason ?? null, p_method: 'tap'
      });
      if (error) { toast(errText(error)); void load(); }
    }, 450);
  }
  const setQty = (i: DeptItem, n: number, keepReason = true) => {
    const v = round(Math.max(0, n));
    save(i, v > 0 ? { qty: v, reason: keepReason ? (lines[i.id]?.reason ?? '') : '' } : null);
  };

  const chosen = Object.keys(lines).length;
  const missingReason = items.filter((i) => flagged(i, lines[i.id]) && !lines[i.id].reason);

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
    : <span className="chip late">{t('Past {time}, send as soon as you can', { time: clock12(rem.indent_due ?? '17:00') })}</span>;

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

      <div className={`notice ${win === 'open' ? 'ok' : win === 'early' ? 'info' : 'warn'}`}>{winChip}</div>
      {myLocations.length > 1 && (
        <div className="cpills" role="group" aria-label="Counter">
          {myLocations.map((l) => <button key={l.id} aria-pressed={l.id === locId} onClick={() => setSp({ loc: String(l.id) })}>{l.name}</button>)}
        </div>
      )}

      {loading ? <p className="muted">{t('Loading…')}</p> : !indent ? null : !editable ? (
        <Sent indent={indent} lines={lines} itemById={itemById} label={label} onReopen={reopen} busy={busy} />
      ) : (
        <>
          <div className="searchrow"><label className="field"><span className="small muted" style={{ fontWeight: 400 }}>{t('Find an item')}</span>
            <div className="searchbox"><Icon name="search" size={18} />
              <input value={q} placeholder={t('Type a few letters')} onChange={(e) => { setQ(e.target.value); setView(e.target.value ? { kind: 'search' } : { kind: 'groups' }); }} />
            </div>
          </label>
          {voiceSupported() && editable && <button className="micbtn" aria-label={t('Speak your order')} onClick={() => setVoice(true)}><Icon name="mic" size={22} /></button>}
          </div>

          {view.kind === 'groups' && (
            <>
              <button className="usualbar" onClick={() => openView({ kind: 'usual' })} disabled={Object.keys(usual).length === 0}>
                <span style={{ fontSize: 26 }}>⭐</span>
                <span><b>{t('My usual')}</b><br /><span className="small muted">{Object.keys(usual).length ? t('{n} items you ask for often', { n: Object.keys(usual).length }) : t('Fills in after your first few indents')}</span></span>
              </button>
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
                    <ItemRow key={i.id} item={i} name={label(i)} line={lines[i.id]} usual={usual[i.id]} flag={flagged(i, lines[i.id])}
                      onQty={(n) => setQty(i, n)} onReason={(r) => lines[i.id] && save(i, { qty: lines[i.id].qty, reason: r })} />
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
          {missingReason.length > 0 && <p className="banner warn">{missingReason.length === 1 ? t('One item is well above your usual. Tell the store why.') : t('{n} items are well above your usual. Tell the store why.', { n: missingReason.length })}</p>}
          {items.filter((i) => lines[i.id]).map((i) => (
            <div key={i.id} className="card" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <b>{label(i)}</b>
                <span className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                  <b className="num">{fmtQty(lines[i.id].qty, i.unit).replace(i.unit, u(i.unit))}</b>
                  <button className="btn quiet" onClick={() => setQty(i, 0)} aria-label={`${t('Remove')} ${i.name}`}><Icon name="trash" size={18} /></button>
                </span>
              </div>
              {flagged(i, lines[i.id]) && <Reasons value={lines[i.id].reason} onPick={(r) => save(i, { qty: lines[i.id].qty, reason: r })} />}
            </div>
          ))}
        </Sheet>
      )}

      {voice && <VoiceOrder items={items} label={label} onClose={() => setVoice(false)}
        onAdd={(ls) => { ls.forEach((l) => setQty(l.item, l.qty)); toast(t('Added {n} items by voice', { n: ls.length })); }} />}

      <SosButton locations={myLocations} defaultId={locId} />
    </div>
  );
}

function ItemRow({ item, name, line, usual, flag, onQty, onReason }: {
  item: DeptItem; name: string; line?: Line; usual?: Usual; flag: boolean; onQty: (n: number) => void; onReason: (r: string) => void;
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
      </div>
      {flag && <Reasons value={line?.reason ?? ''} onPick={onReason} />}
    </div>
  );
}

function Reasons({ value, onPick }: { value: string; onPick: (r: string) => void }) {
  const { t } = useLang();
  return (
    <div className="reasons" role="group" aria-label={t('Why more than usual')}>
      <span className="small" style={{ fontWeight: 700 }}>{t('More than your usual. Why?')}</span>
      <div className="seg">{REASONS.map((r) => <button key={r} aria-pressed={value === r} onClick={() => onPick(r)}>{t(r)}</button>)}</div>
    </div>
  );
}

function Sent({ indent, lines, itemById, label, onReopen, busy }: {
  indent: IndentRec; lines: Record<number, Line>; itemById: Map<number, DeptItem>; label: (i: DeptItem) => string; onReopen: () => void; busy: boolean;
}) {
  const { t, unit: u } = useLang();
  const ids = Object.keys(lines).map(Number);
  return (
    <div className="stack">
      <p className="banner ok">
        {indent.status === 'locked' ? t('The store is working on this indent.') : indent.nothing_needed ? t('You told the store you need nothing. Sent {time}.', { time: timeOf(indent.submitted_at) }) : t('Sent to the store at {time}.', { time: timeOf(indent.submitted_at) })}
      </p>
      {ids.length > 0 && (
        <div className="card stack">
          {ids.map((id) => { const i = itemById.get(id); return i ? (
            <div key={id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <span>{label(i)}</span><b className="num">{fmtQty(lines[id].qty, i.unit).replace(i.unit, u(i.unit))}</b>
            </div>) : null; })}
        </div>
      )}
      {indent.status === 'submitted' && <button className="btn secondary floor" disabled={busy} onClick={onReopen}>{t('Change something')}</button>}
    </div>
  );
}
