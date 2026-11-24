import { useEffect, type ReactNode } from 'react';
import type { HudLayout } from '../layout/solve';
import { IconClose } from './Icons';

interface ModalProps {
  layout: HudLayout;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Maximum width as a fraction of the standard dialog width. */
  size?: number;
  /** Shrink to the content instead of filling the safe zone. */
  compact?: boolean;
  closeLabel: string;
  testId?: string;
}

/**
 * Dialog that always stays inside the interactive safe zone of the active
 * display preset; long content scrolls inside the dialog.
 */
export function Modal({ layout, title, onClose, children, footer, size = 1, compact = false, closeLabel, testId }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const m = layout.modal;
  const width = Math.min(m.w, m.w * size);
  const style = compact
    ? { left: (layout.vw - width) / 2, width, top: m.y, maxHeight: m.h, transformOrigin: 'center' as const }
    : { left: (layout.vw - width) / 2, width, top: m.y, height: m.h };
  return (
    <>
      <div className="pp-backdrop" onPointerDown={onClose} />
      <div className="pp-modal" role="dialog" aria-modal="true" aria-label={title} style={style} data-testid={testId}>
        <header>
          <h1>{title}</h1>
          <button type="button" className="pp-btn round small soft" onClick={onClose} aria-label={closeLabel} data-testid="modal-close">
            <IconClose />
          </button>
        </header>
        <div className="body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </>
  );
}
