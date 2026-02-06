import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ isOpen, position, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    // Use requestAnimationFrame to avoid catching the same click that opened the menu
    const frameId = requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('contextmenu', handleClickOutside);
    });
    document.addEventListener('keydown', handleEscape);

    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('contextmenu', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = position.x;
    let adjustedY = position.y;

    if (position.x + rect.width > viewportWidth) {
      adjustedX = viewportWidth - rect.width - 8;
    }

    if (position.y + rect.height > viewportHeight) {
      adjustedY = viewportHeight - rect.height - 8;
    }

    if (adjustedX !== position.x || adjustedY !== position.y) {
      menu.style.left = `${adjustedX}px`;
      menu.style.top = `${adjustedY}px`;
    }
  }, [isOpen, position]);

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] rounded-md border border-surface-3 bg-surface-2 py-1 shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, index) => {
        if (item.separator) {
          return (
            <div
              key={`separator-${index}`}
              className="my-1 h-px bg-surface-3"
            />
          );
        }

        return (
          <button
            key={item.label}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            disabled={item.disabled}
            className={`w-full px-3 py-1.5 text-left text-sm ${
              item.disabled
                ? 'cursor-not-allowed text-tertiary'
                : 'text-primary hover:bg-surface-3/50'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
