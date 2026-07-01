/**
 * Modal — thin wrapper over the shared .modal-backdrop/.modal primitives,
 * rendered through a portal so editor modals can stack (expression builders
 * open on top of slot editors on top of block pickers).
 * Escape closes only the topmost open modal.
 */
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const openStack: symbol[] = [];

export function Modal({ title, onClose, children, footer }: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
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

  // The portal lands in document.body, outside .forge-root — this wrapper
  // (display: contents) re-enters the scope so tokens and .modal styles apply.
  return createPortal(
    <div className="forge-root forge-portal">
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <span className="ed-modal-title">{title}</span>
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
