/**
 * Modal — thin wrapper over the shared .modal-backdrop/.modal primitives,
 * rendered through a portal so editor modals can stack (expression builders
 * open on top of slot editors on top of block pickers).
 * Escape closes only the topmost open modal. Proper dialog manners (the
 * runner-sheet treatment): role=dialog + aria-modal, focus moves in on open
 * and back to the opener on close, and Tab wraps inside the dialog.
 */
import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const openStack: symbol[] = [];

const FOCUSABLE =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, onClose, children, footer }: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = Symbol('modal');
    openStack.push(token);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === token) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      const i = openStack.indexOf(token);
      if (i >= 0) openStack.splice(i, 1);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Focus the dialog on open; hand focus back to the opener on close (if it
  // survived — the row that opened a confirm may have been deleted by it).
  useEffect(() => {
    const opener = document.activeElement;
    modalRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // Tab cycles inside the dialog instead of walking the obscured page.
  // Stacked child modals portal to document.body, so their keydowns bubble
  // here through the REACT tree while their DOM sits outside ours — the
  // contains() guard keeps each modal trapping only its own subtree.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const modal = modalRef.current;
    if (!modal || !modal.contains(e.target as Node)) return;
    const focusables = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    // indexOf is -1 while focus sits on the dialog itself (tabIndex -1): both
    // directions wrap instead of escaping.
    const idx = focusables.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey) {
      if (idx <= 0) {
        e.preventDefault();
        focusables[focusables.length - 1].focus();
      }
    } else if (idx === -1 || idx === focusables.length - 1) {
      e.preventDefault();
      focusables[0].focus();
    }
  };

  // The portal lands in document.body, outside .forge-root — this wrapper
  // (display: contents) re-enters the scope so tokens and .modal styles apply.
  return createPortal(
    <div className="forge-root forge-portal">
      <div className="modal-backdrop" onClick={onClose} onKeyDown={onKeyDown}>
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          ref={modalRef}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <span className="ed-modal-title" id={titleId}>{title}</span>
            <span className="spacer" />
            <button type="button" className="btn btn-small btn-ghost ed-tool" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-footer">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Simple confirm dialog (used for destructive deletes). */
export function ConfirmModal({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel} footer={(
      <>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
      </>
    )}>
      {message}
    </Modal>
  );
}
