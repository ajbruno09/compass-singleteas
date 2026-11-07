import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { useLang } from '../lib/i18n';
import { errText } from '../lib/format';
import { timeOf } from '../lib/ist';
import { AvatarButton } from '../components/AvatarButton';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

interface Pending { id: string; issue_number: string; issued_at: string }
interface Line { item_id: number; name: string; local_names: Record<string, string> | null; unit: string; quick_amounts: number[] | null; qty_issued: number }

export function ReceivedPage() {
  const [sp] = useSearchParams();
  const loc = Number(sp.get('loc'));
  const { locations, profile } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const { t, hi } = useLang();
  const [list, setList] = useState<Pending[]>([]);
  const [cur, setCur] = useState<Pending | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [vals, setVals] = useState<Record<number, string>>({});
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
    const ls = (data as Line[]) ?? []; setLines(ls); setVals(Object.fromEntries(ls.map((l) => [l.item_id, String(Number(l.qty_issued))]))); setCur(p); setErr('');
  }
  const step = (l: Line) => { const a = (l.quick_amounts ?? []).filter((n) => n > 0); return a.length ? Math.min(...a) : 1; };
  const nameOf = (l: Line) => (hi && l.local_names?.hi) || l.name;

  async function confirm() {
    setErr('');
    const missing = lines.filter((l) => (vals[l.item_id] ?? '').trim() === '');
    if (missing.length && !window.confirm(t('{n} items have no number. They will count as not received. Continue?', { n: missing.length }))) return;
    const big = lines.filter((l) => { const sent = Number(l.qty_issued); const got = Number(vals[l.item_id] || 0); return sent > 0 && (got === 0 || got >= sent * 5 || got <= sent / 5); });
    if (big.length && !window.confirm('Please check these, the number is very different from what the store sent:\n\n' + big.map((l) => `${nameOf(l)}: sent ${Number(l.qty_issued)} ${l.unit}, you entered ${Number(vals[l.item_id] || 0)}`).join('\n') + '\n\nIs this correct?')) return;
    setBusy(true);
    const { error } = await supabase.rpc('confirm_issue', { p_issue_id: cur!.id, p_lines: lines.map((l) => ({ item_id: l.item_id, qty: Number(vals[l.item_id] || 0) })) });
    setBusy(false);
    if (error) return setErr(errText(error));
    toast(t('Thank you. Confirmed.')); setCur(null); void load();
  }

  if (!loc) return <div className="phone"><p>Choose a counter first.</p></div>;
  return (
    <div className="phone">
      <div className="phone-head"><button className="btn quiet" onClick={() => (cur ? setCur(null) : nav(office ? '/issue' : '/'))}><Icon name="back" /> {t('Back')}</button><b>{t('Items from the store')} · {place}</b><AvatarButton /></div>
      {!cur ? (list.length === 0 ? <p className="card muted">{t('Nothing is waiting to be confirmed.')}</p> : (
        <div className="stack">{list.map((p) => <button key={p.id} className="countercard" onClick={() => open(p)}>
          <Icon name="box" size={30} stroke={1.6} /><span style={{ flex: 1, textAlign: 'left' }}><span className="name" style={{ display: 'block' }}>{t('Delivery')} {p.issue_number}</span><span className="small muted">{t('Sent {time}', { time: timeOf(p.issued_at) })}</span></span><span className="chip due">{t('Open')}</span></button>)}</div>
      )) : (<>
        <p className="muted small">Numbers are filled in as the store sent them. Check what reached your counter and change only what is different.</p>
        <div className="stack">{lines.map((l) => (
          <div key={l.item_id} className="card row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <div style={{ minWidth: 0, flex: 1 }}><b>{nameOf(l)}</b><div className="small muted">Store sent {Number(l.qty_issued)} {l.unit}{Number(vals[l.item_id] || 0) !== Number(l.qty_issued) && <b style={{ color: 'var(--bad)', marginLeft: 6 }}>changed</b>}</div></div>
            <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <button className="qchip" aria-label="Less" onClick={() => setVals((p) => ({ ...p, [l.item_id]: String(Math.max(0, Math.round((Number(p[l.item_id] || 0) - step(l)) * 1000) / 1000)) }))}>−</button>
              <input inputMode="decimal" className="num" style={{ width: 84, textAlign: 'center' }} aria-label={nameOf(l)} value={vals[l.item_id] ?? ''} onChange={(e) => setVals((p) => ({ ...p, [l.item_id]: e.target.value }))} />
              <button className="qchip" aria-label="More" onClick={() => setVals((p) => ({ ...p, [l.item_id]: String(Math.round((Number(p[l.item_id] || 0) + step(l)) * 1000) / 1000) }))}>+</button>
            </div>
          </div>))}</div>
        {err && <p className="banner bad" role="alert">{err}</p>}
        <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg)', paddingBottom: 8 }}><button className="btn primary" style={{ width: '100%', minHeight: 52 }} disabled={busy} onClick={confirm}>{busy ? t('Sending…') : t('Confirm received')}</button></div>
      </>)}
    </div>
  );
}
