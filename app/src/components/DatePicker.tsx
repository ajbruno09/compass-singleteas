import { useEffect, useRef, useState } from 'react';
import '../nt.css';

// Date and time pickers used everywhere in Compass (taken from the approved Notices mock).
// Dates are ISO strings (YYYY-MM-DD) and weeks start on Monday. Times are 24 hour "HH:MM".
const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const niceDate = (s: string) => { const d = parse(s); return `${DN[d.getDay()]} ${d.getDate()} ${MN[d.getMonth()].slice(0, 3)}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`; };
export const niceTime = (v: string) => { const [h, m] = v.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };

const CalIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 3v3M16 3v3" /></svg>;
const ClockIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2" /></svg>;

function useAway(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open, close]);
  return ref;
}

export function DatePicker({ value, onChange, tomorrow, label = 'Date', min, tomorrowLabel = 'Tomorrow', placeholder = 'Choose date', width, disabled }: { disabled?: boolean; value: string; onChange: (v: string) => void; tomorrow?: string; label?: string; min?: string; tomorrowLabel?: string; placeholder?: string; width?: number | string }) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const [view, setView] = useState(() => { const d = value ? parse(value) : new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const ref = useAway(open, () => setOpen(false));
  const today = iso(new Date());
  const tmr = iso(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1));
  useEffect(() => { if (value) { const d = parse(value); setView(new Date(d.getFullYear(), d.getMonth(), 1)); } }, [value]);
  const y = view.getFullYear(), m = view.getMonth();
  const off = (new Date(y, m, 1).getDay() + 6) % 7, dim = new Date(y, m + 1, 0).getDate();
  const pick = (v: string) => { onChange(v); setOpen(false); };
  const bad = (k: string) => !!min && k < min;
  const cells: JSX.Element[] = [];
  for (let i = 0; i < off; i++) cells.push(<button key={'o' + i} type="button" className="nt-o" disabled>{new Date(y, m, -off + i + 1).getDate()}</button>);
  for (let d = 1; d <= dim; d++) {
    const k = iso(new Date(y, m, d));
    cells.push(<button key={k} type="button" disabled={bad(k)} className={[k === today ? 'nt-t' : '', k === value ? 'nt-s' : ''].join(' ').trim()} aria-label={niceDate(k)} onClick={() => pick(k)}>{d}</button>);
  }
  return (
    <div className="nt nt-pick" ref={ref} style={{ display: 'inline-block', ...(width ? { width } : {}) }}>
      <div className="nt-pickbtn" role="button" tabIndex={0} aria-haspopup="dialog" aria-expanded={open} aria-label={label} onClick={(e) => { if (disabled) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setFlip(r.left + 320 > window.innerWidth); setOpen((o) => !o); }} style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); } }}>
        <span>{value ? niceDate(value) : placeholder}</span><span className="nt-ico"><CalIcon /></span>
      </div>
      {open && (
        <div className={`nt-pop nt-cal${flip ? ' nt-flip' : ''}`} role="dialog" aria-label="Choose a date">
          <div className="nt-calh">
            <button type="button" aria-label="Previous month" onClick={() => setView(new Date(y, m - 1, 1))}>‹</button>
            <span>{MN[m]} {y}</span>
            <button type="button" aria-label="Next month" onClick={() => setView(new Date(y, m + 1, 1))}>›</button>
          </div>
          <div className="nt-cg">
            {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((h) => <div key={h} className="nt-h">{h}</div>)}
            {cells}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" className="nt-chp" disabled={bad(today)} onClick={() => pick(today)}>Today</button>
            <button type="button" className="nt-chp" disabled={bad(tmr)} onClick={() => pick(tmr)}>Tomorrow</button>
            {tomorrow && tomorrow !== tmr && tomorrow !== today && <button type="button" className="nt-chp nt-on" onClick={() => pick(tomorrow)}>{tomorrowLabel}</button>}
          </div>
        </div>
      )}
    </div>
  );
}

export function TimePicker({ value, onChange, label = 'Time', placeholder = 'Time', width, disabled }: { disabled?: boolean; value: string; onChange: (v: string) => void; label?: string; placeholder?: string; width?: number | string }) {
  const [open, setOpen] = useState(false);
  const ref = useAway(open, () => setOpen(false));
  const has = /^\d{1,2}:\d{2}/.test(value || '');
  const [hh, mm] = has ? value.split(':').map(Number) : [null, null];
  const [part, setPart] = useState<{ h: number | null; m: string | null; p: 'am' | 'pm' }>({ h: has ? (hh as number) % 12 || 12 : null, m: has ? String(mm).padStart(2, '0') : null, p: has && (hh as number) < 12 ? 'am' : 'pm' });
  useEffect(() => { if (has) setPart({ h: (hh as number) % 12 || 12, m: String(mm).padStart(2, '0'), p: (hh as number) < 12 ? 'am' : 'pm' }); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  function set(p: { h: number | null; m: string | null; p: 'am' | 'pm' }) {
    setPart(p);
    if (p.h) { const h24 = (p.h % 12) + (p.p === 'pm' ? 12 : 0); onChange(`${String(h24).padStart(2, '0')}:${p.m ?? '00'}`); }
  }
  return (
    <div className="nt nt-pick" ref={ref} style={{ display: 'inline-block', ...(width ? { width } : {}) }}>
      <div className="nt-pickbtn" role="button" tabIndex={0} aria-haspopup="dialog" aria-expanded={open} aria-label={label} style={{ minWidth: 120, ...(disabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }} onClick={() => { if (!disabled) setOpen((o) => !o); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); } }}>
        <span>{has ? niceTime(value) : placeholder}</span><span className="nt-ico"><ClockIcon /></span>
      </div>
      {open && (
        <div className="nt-pop" role="dialog" aria-label="Choose a time">
          <div className="nt-tp">
            <div><div className="nt-tph">Hour</div><div className="nt-col">{Array.from({ length: 12 }, (_, i) => i + 1).map((h) => <button key={h} type="button" className={part.h === h ? 'nt-s' : ''} onClick={() => set({ ...part, h, m: part.m ?? '00' })}>{h}</button>)}</div></div>
            <div><div className="nt-tph">Minute</div><div className="nt-col">{['00', '15', '30', '45'].map((m) => <button key={m} type="button" className={part.m === m ? 'nt-s' : ''} onClick={() => set({ ...part, m, h: part.h ?? 12 })}>{m}</button>)}</div></div>
            <div><div className="nt-tph">&nbsp;</div><div className="nt-col">{(['am', 'pm'] as const).map((p) => <button key={p} type="button" className={part.p === p ? 'nt-s' : ''} onClick={() => set({ ...part, p })}>{p}</button>)}</div></div>
          </div>
        </div>
      )}
    </div>
  );
}
