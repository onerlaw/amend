import { ReactNode } from 'react';
import { ModalOverlay } from './ModalOverlay';

interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  confirmClassName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmClassName,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onConfirm();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <ModalOverlay onClose={onCancel}>
      <div
        className="w-80 rounded-lg border border-surface-3 bg-surface-2 p-4 shadow-xl"
        onKeyDown={handleKeyDown}
      >
        <div className="mb-2 text-sm font-medium text-primary">{title}</div>
        <p className="mb-4 text-sm text-secondary">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1 text-xs text-secondary hover:bg-surface-3"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-md px-3 py-1 text-xs text-white ${confirmClassName}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
