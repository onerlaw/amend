import { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalOverlayProps {
  onClose: () => void;
  children: ReactNode;
}

export function ModalOverlay({ onClose, children }: ModalOverlayProps) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body
  );
}
