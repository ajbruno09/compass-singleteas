import { useEffect, useRef, useState } from 'react';
import { parseOrder, type VoiceResult } from '../lib/voice';
import { useLang } from '../lib/i18n';
import { qty as fmtQty } from '../lib/format';
import type { DeptItem } from '../lib/types';
import { Icon } from './Icon';

// Tap the microphone to start, tap again to stop. Nothing is added until the person confirms.
type Rec = { start: () => void; stop: () => void; abort: () => void; lang: string; continuous: boolean; interimResults: boolean; onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null };
const Ctor = (): (new () => Rec) | null => { const w = window as any; return w.SpeechRecognition || w.webkitSpeechRecognition || null; };
export const voiceSupported = () => typeof window !== 'undefined' && !!Ctor();

export function VoiceOrder({ items, label, onAdd, onClose }: { items: DeptItem[]; label: (i: DeptItem) => string; onAdd: (lines: { item: DeptItem; qty: number }[]) => void; onClose: () => void }) {
  const { t, hi, unit } = useLang();
  const [stage, setStage] = useState<'listen' | 'heard' | 'error'>('listen');
  const [heard, setHeard] = useState('');
  const [res, setRes] = useState<VoiceResult | null>(null);
  const [drop, setDrop] = useState<number[]>([]);
  const [err, setErr] = useState('');
  const rec = useRef<Rec | null>(null);
  const text = useRef('');
  const stopped = useRef(false);
  const guard = useRef<number | undefined>(undefined);

  function finish() {
    window.clearTimeout(guard.current);
    const said = text.current.trim();
    setHeard(said);
    if (!said) { setErr(t('Nothing understood. Try again, a little slower.')); setStage('error'); return; }
    setRes(parseOrder(said, items, hi ? 'hi' : 'en')); setDrop([]); setStage('heard');
  }
  function start() {
    const C = Ctor();
    if (!C) { setErr(t('Voice is not available on this phone. Use the search box and the keyboard microphone.')); setStage('error'); return; }
    text.current = ''; stopped.current = false; setHeard(''); setStage('listen');
    const r = new C();
    r.lang = hi ? 'hi-IN' : 'en-IN'; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => { let s = ''; for (let k = 0; k < e.results.length; k++) s += e.results[k][0].transcript + ' '; text.current = s; setHeard(s); };
    r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stopped.current = true; setErr(t('Could not use the microphone. Please allow it in the browser.')); setStage('error'); } };
    r.onend = () => { if (!stopped.current) { stopped.current = true; finish(); } };
    rec.current = r;
    try { r.start(); } catch { /* already started */ }
    // Safety stop so it can never listen forever in a noisy kitchen.
    guard.current = window.setTimeout(() => stop(), 20000);
  }
  function stop() { stopped.current = true; try { rec.current?.stop(); } catch { /* ignore */ } window.setTimeout(finish, 350); }

  useEffect(() => { start(); return () => { stopped.current = true; window.clearTimeout(guard.current); try { rec.current?.abort(); } catch { /* ignore */ } }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const keep = res?.lines.filter((_, k) => !drop.includes(k)) ?? [];
  return (
    <div className="voicewrap">
      {stage === 'listen' && (
        <div className="voicebox">
          <b style={{ fontSize: 20 }}>{t("I'm listening")}</b>
          <p className="muted">{t('Say the item and quantity, for example: "onion 5 kg, tomato 10 kg"')}</p>
          <button className="bigmic live" onClick={stop} aria-label="Stop"><Icon name="mic" size={40} /></button>
          <b style={{ color: 'var(--bad)' }}>{t('Tap the red button when you finish')}</b>
          {heard && <p className="small muted">{heard}</p>}
          <button className="btn quiet" onClick={onClose}>{t('Cancel')}</button>
        </div>
      )}
      {stage === 'heard' && res && (
        <div className="voicebox" style={{ textAlign: 'left' }}>
          <div><b style={{ fontSize: 20 }}>{t('Did I hear this right?')}</b><p className="small muted">{t('Nothing is added until you tap Add')}</p></div>
          <p className="small muted">{t('Heard: {text}', { text: heard })}</p>
          {res.lines.map((l, k) => (
            <div key={l.item.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', opacity: drop.includes(k) ? 0.35 : 1, borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
              <b>{label(l.item)}</b>
              <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                <b className="num">{fmtQty(l.qty, l.item.unit).replace(l.item.unit, unit(l.item.unit))}</b>
                <button className="btn quiet" aria-label="Remove" onClick={() => setDrop((d) => d.includes(k) ? d.filter((x) => x !== k) : [...d, k])}><Icon name="close" size={18} /></button>
              </span>
            </div>
          ))}
          {res.missed.length > 0 && <div className="banner warn"><b>{t('I could not match these. Please add them by hand:')}</b><br />{res.missed.join(' · ')}</div>}
          {res.lines.length === 0 && <p className="banner warn">{t('Nothing understood. Try again, a little slower.')}</p>}
          <button className="btn primary floor" disabled={keep.length === 0} onClick={() => { onAdd(keep); onClose(); }}>{t('Add to my indent')}</button>
          <button className="btn secondary floor" onClick={start}>{t('Speak again')}</button>
          <button className="btn quiet" onClick={onClose}>{t('Cancel')}</button>
        </div>
      )}
      {stage === 'error' && (
        <div className="voicebox">
          <p className="banner warn">{err}</p>
          <button className="btn secondary floor" onClick={start}>{t('Speak again')}</button>
          <button className="btn quiet" onClick={onClose}>{t('Cancel')}</button>
        </div>
      )}
    </div>
  );
}
