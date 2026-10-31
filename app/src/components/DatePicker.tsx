import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

// Calendar date picker used by every Single Teas app. Values are ISO dates (YYYY-MM-DD), weeks start on Monday.
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });
const LABEL = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export function DatePicker({ value, onChange, tomorrow, label = 'Date' }: { value: string; onChange: (v: string) => void; tomorrow?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => { const d = value ? parse(value) : new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const ref = useRef<HTMLDivElement>(null);
  const today = iso(new Date());

  useEffect(() => { if (value) { const d = parse(value); setView(new Date(d.getFullYear(), d.getMonth(), 1)); } }, [value]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(view.getFullYear(), view.getMonth(), 1 - lead + i); return { d, key: iso(d), out: d.getMonth() !== view.getMonth() }; });
  const pick = (v: string) => { onChange(v); setOpen(false); };

  return (
    <div className="dp" ref={ref}>
      <button type="button" className="btn" aria-haspopup="dialog" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        <Icon name="cal" /><span className="num">{value ? LABEL.format(parse(value)) : 'Pick a date'}</span><Icon name="chev" />
      </button>
      {open && (
        <div className="dp-pop" role="dialog" aria-label="Choose a date">
          <div className="dp-head">
            <button type="button" className="btn quiet" aria-label="Previous month" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}><Icon name="back" /></button>
            <span>{MONTH.format(view)}</span>
            <button type="button" className="btn quiet" aria-label="Next month" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))} style={{ transform: 'scaleX(-1)' }}><Icon name="back" /></button>
          </div>
          <div className="dp-grid">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((h, i) => <div key={i} className="h">{h}</div>)}
            {cells.map((c) => (
              <button key={c.key} type="button" className={[c.out ? 'o' : '', c.key === today ? 't' : '', c.key === value ? 's' : ''].join(' ').trim()}
                aria-label={LABEL.format(c.d)} aria-pressed={c.key === value} onClick={() => pick(c.key)}>{c.d.getDate()}</button>
            ))}
          </div>
          <div className="dp-foot">
            <button type="button" className="btn" onClick={() => pick(today)}>Today</button>
            {tomorrow && <button type="button" className="btn primary" onClick={() => pick(tomorrow)}>Tomorrow's indent</button>}
          </div>
        </div>
      )}
    </div>
  );
}
