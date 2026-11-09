import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { useLang } from '../lib/i18n';
import { errText, packFactor, round3 } from '../lib/format';
import { timeOf } from '../lib/ist';
import { AvatarButton } from '../components/AvatarButton';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

interface Pending { id: string; issue_number: string; issued_at: string }
interface Line { item_id: number; name: string; local_names: Record<string, string> | null; unit: string; quick_amounts: number[] | null; qty_issued: number; show_as?: string | null; purchase_factor?: number | null }

export function ReceivedPage() {
  const [sp] = useSearchParams();
  const loc = Number(sp.get('loc'));
  const { allLocations: locations, profile } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const { t, hi } = useLang();
  const [list, setList] = useState<Pending[]>([]);
  const [cur, setCur] = useState<Pending | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [vals, setVals] = useState<Record<number, string>>({});
  const facRef = useRef<Record<number, number>>({});
  const [ans, setAns] = useState<Record<number, 'yes' | 'no'>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const office = profile?.role === 'owner' || profile?.role === 'store' || profile?.role === 'manager';
  const place = locations.find((l) => l.id === loc)?.name ?? '';

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('pending_issues', { p_location_id: loc });
    setList((data as Pending[]) ?? []);
  }, [loc]);
  useEffect(() => { void load(); }, [load]);

  async function open(p: Pending) {
    const { data } = await supabase.rpc('issue_items_to_confirm', { p_issue_id: p.id });
    const raw = (data as Line[]) ?? [];
    const fac: Record<number, number> = {}; for (const l of raw) { const f = packFactor(l); if (f) fac[l.item_id] = f; }
    facRef.current = fac;
    const ls = raw.map((l) => (fac[l.item_id] ? { ...l, unit: l.show_as as string, qty_issued: round3(Number(l.qty_issued) / fac[l.item_id]), quick_amounts: [1] } : l)); setLines(ls); setVals(Object.fromEntries(ls.map((l) => [l.item_id, String(Number(l.qty_issued))]))); setCur(p); setAns({}); setErr('');
  }
  const step = (l: Line) => { const a = (l.quick_amounts ?? []).filter((n) => n > 0); return a.length ? Math.min(...a) : 1; };
  const nameOf = (l: Line) => (hi && l.local_names?.hi) || l.name;

  async function confirm() {
    setErr('');
    if (lines.some((l) => !ans[l.item_id])) { setErr(t('Please answer for every item.')); return; }
    const big = lines.filter((l) => { const sent = Number(l.qty_issued); const got = Number(vals[l.item_id] || 0); return sent > 0 && (got === 0 || got >= sent * 5 || got <= sent / 5); });
    if (big.length && !window.confirm('Please check these, the number is very different from what the store sent:\n\n' + big.map((l) => `${nameOf(l)}: sent ${Number(l.qty_issued)} ${l.unit}, you entered ${Number(vals[l.item_id] || 0)}`).join('\n') + '\n\nIs this correct?')) return;
    setBusy(true);
    const { error } = await supabase.rpc('confirm_issue', { p_issue_id: cur!.id, p_lines: lines.map((l) => ({ item_id: l.item_id, qty: round3((ans[l.item_id] === 'yes' ? Number(l.qty_issued) : Number(vals[l.item_id] || 0)) * (facRef.current[l.item_id] ?? 1)) })) });
    setBusy(false);
    if (error) return setErr(errText(error));
    toast(t('Thank you. Confirmed.')); setCur(null); void load(); window.dispatchEvent(new Event('compass:gate'));
  }

  if (!loc) return <div className="phone"><p>Choose a counter first.</p></div>;
  return (
    <div className="phone">
      <div className="phone-head"><button className="btn quiet" onClick={() => (cur ? setCur(null) : nav(office ? '/issue' : '/'))}><Icon name="back" /> {t('Back')}</button><b>{t('Items from the store')} · {place}</b><AvatarButton /></div>
      {!cur ? (list.length === 0 ? <p className="card muted">{t('Nothing is waiting to be confirmed.')}</p> : (
        <div className="stack">{list.map((p) => <button key={p.id} className="countercard" onClick={() => open(p)}>
          <Icon name="box" size={30} stroke={1.6} /><span style={{ flex: 1, textAlign: 'left' }}><span className="name" style={{ display: 'block' }}>{t('Delivery')} {p.issue_number}</span><span className="small muted">{t('Sent {time}', { time: timeOf(p.issued_at) })}</span></span><span className="chip due">{t('Open')}</span></button>)}</div>
      )) : (<>
        <p className="muted small">{t('Tap Yes if you got exactly what the store sent. Tap Different only if the amount is not right.')}</p>
        <button className="btn secondary" style={{ width: '100%' }} onClick={() => setAns(Object.fromEntries(lines.map((l) => [l.item_id, 'yes' as const])))}>{t('Everything is correct')}</button>
        <div className="stack">{lines.map((l) => { const a = ans[l.item_id]; return (
          <div key={l.item_id} className="card" style={a === 'yes' ? { background: '#E6F0EB', borderColor: '#B9D6C7' } : a === 'no' ? { background: '#FFF1E8', borderColor: '#F3B48E' } : undefined}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}><b>{nameOf(l)}</b><div className="small muted">{t('Store sent')} {Number(l.qty_issued)} {l.unit}</div></div>
              <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                <button className={'btn ' + (a === 'yes' ? 'primary' : 'secondary')} style={{ minWidth: 64 }} aria-pressed={a === 'yes'} onClick={() => { setAns((p) => ({ ...p, [l.item_id]: 'yes' })); }}>{t('Yes')}</button>
                <button className={'btn ' + (a === 'no' ? 'primary' : 'secondary')} style={{ minWidth: 64, ...(a === 'no' ? { background: '#B3261E', borderColor: '#B3261E' } : {}) }} aria-pressed={a === 'no'} onClick={() => { setAns((p) => ({ ...p, [l.item_id]: 'no' })); setVals((p) => ({ ...p, [l.item_id]: p[l.item_id] ?? String(Number(l.qty_issued)) })); }}>{t('Different')}</button>
              </div>
            </div>
            {a === 'no' && (
              <div style={{ marginTop: 8, borderTop: '1px dashed #F3B48E', paddingTop: 8 }}>
                <div className="small muted">{t('How much did you actually get?')}</div>
                <div className="row" style={{ gap: 4, flexWrap: 'nowrap', marginTop: 6 }}>
                  <button className="qchip" aria-label="Less" onClick={() => setVals((p) => ({ ...p, [l.item_id]: String(Math.max(0, Math.round((Number(p[l.item_id] || 0) - step(l)) * 1000) / 1000)) }))}>−</button>
                  <input inputMode="decimal" className="num" style={{ width: 90, textAlign: 'center' }} aria-label={nameOf(l)} value={vals[l.item_id] ?? ''} onChange={(e) => setVals((p) => ({ ...p, [l.item_id]: e.target.value }))} />
                  <button className="qchip" aria-label="More" onClick={() => setVals((p) => ({ ...p, [l.item_id]: String(Math.round((Number(p[l.item_id] || 0) + step(l)) * 1000) / 1000) }))}>+</button>
                  <button className="qchip" style={{ marginLeft: 'auto' }} onClick={() => setVals((p) => ({ ...p, [l.item_id]: '0' }))}>{t('Nothing came (0)')}</button>
                </div>
              </div>)}
          </div>); })}</div>
        {err && <p className="banner bad" role="alert">{err}</p>}
        <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg)', paddingBottom: 8 }}><button className="btn primary" style={{ width: '100%', minHeight: 52 }} disabled={busy || lines.some((l) => !ans[l.item_id])} onClick={confirm}>{busy ? t('Sending…') : lines.some((l) => !ans[l.item_id]) ? `${lines.filter((l) => !ans[l.item_id]).length} ${t('still to answer')}` : lines.some((l) => ans[l.item_id] === 'no') ? `${t('Confirm')}, ${lines.filter((l) => ans[l.item_id] === 'no').length} ${t('different')}` : t('Confirm, all received')}</button></div>
      </>)}
    </div>
  );
}
