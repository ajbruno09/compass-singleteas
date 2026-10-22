import { useEffect, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{title}</h2>
          <button className="btn quiet" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="stack" style={{ flex: 1 }}>{children}</div>
        {footer && <div className="row" style={{ justifyContent: 'flex-end', paddingTop: 8 }}>{footer}</div>}
      </div>
    </div>
  );
}
