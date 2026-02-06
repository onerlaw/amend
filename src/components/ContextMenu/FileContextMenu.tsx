import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { useContextMenuStore, dispatchFileTreeRefresh } from '@/stores/contextMenuStore';
import { useFileStore } from '@/stores/fileStore';
import { ModalOverlay } from '@/components/ModalOverlay';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  renameEntry,
  deleteFile,
  deleteDirectory,
  revealInFileManager,
  moveEntry,
  copyEntry,
} from '@/lib/tauri';

function RenameDialog() {
  const { renameTarget, closeRenameDialog } = useContextMenuStore();
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renameTarget) {
      setName(renameTarget.name);
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          const dotIndex = renameTarget.isDirectory ? -1 : renameTarget.name.lastIndexOf('.');
          if (dotIndex > 0) {
            inputRef.current.setSelectionRange(0, dotIndex);
          } else {
            inputRef.current.select();
          }
        }
      });
    }
  }, [renameTarget]);

  if (!renameTarget) return null;

  const handleSubmit = async () => {
    if (!name || name === renameTarget.name) {
      closeRenameDialog();
      return;
    }

    const parentPath = renameTarget.path.substring(0, renameTarget.path.lastIndexOf('/'));
    const newPath = `${parentPath}/${name}`;

    try {
      await renameEntry(renameTarget.path, newPath);
      dispatchFileTreeRefresh();
    } catch (error) {
      console.error('Failed to rename:', error);
    }
    closeRenameDialog();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      closeRenameDialog();
    }
  };

  return (
    <ModalOverlay onClose={closeRenameDialog}>
      <div className="w-72 rounded-lg border border-surface-3 bg-surface-2 p-4 shadow-xl">
        <div className="mb-3 text-sm font-medium text-primary">Rename</div>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-1.5 text-sm text-primary outline-none focus:border-accent"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={closeRenameDialog}
            className="rounded-md px-3 py-1 text-xs text-secondary hover:bg-surface-3"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name || name === renameTarget.name}
            className="rounded-md bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Rename
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

function ConfirmDeleteDialog() {
  const { deleteTarget, closeDeleteDialog } = useContextMenuStore();

  if (!deleteTarget) return null;

  const handleConfirm = async () => {
    try {
      if (deleteTarget.isDirectory) {
        await deleteDirectory(deleteTarget.path);
      } else {
        await deleteFile(deleteTarget.path);
      }
      dispatchFileTreeRefresh();
    } catch (error) {
      console.error('Failed to delete:', error);
    }
    closeDeleteDialog();
  };

  return (
    <ConfirmDialog
      title="Delete"
      message={<>Are you sure you want to delete &ldquo;{deleteTarget.name}&rdquo;?</>}
      confirmLabel="Delete"
      confirmClassName="bg-red-600 hover:bg-red-700"
      onConfirm={handleConfirm}
      onCancel={closeDeleteDialog}
    />
  );
}

export function FileContextMenu() {
  const {
    isOpen,
    position,
    targetEntry,
    clipboard,
    closeMenu,
    setCutEntry,
    setCopyEntry,
    clearClipboard,
    openRenameDialog,
    openDeleteDialog,
  } = useContextMenuStore();
  const { currentDirectory } = useFileStore();

  const handleRename = useCallback(() => {
    if (!targetEntry) return;
    openRenameDialog(targetEntry);
  }, [targetEntry, openRenameDialog]);

  const handleDelete = useCallback(() => {
    if (!targetEntry) return;
    openDeleteDialog(targetEntry);
  }, [targetEntry, openDeleteDialog]);

  const handleCut = useCallback(() => {
    if (!targetEntry) return;
    setCutEntry(targetEntry);
  }, [targetEntry, setCutEntry]);

  const handleCopy = useCallback(() => {
    if (!targetEntry) return;
    setCopyEntry(targetEntry);
  }, [targetEntry, setCopyEntry]);

  const handlePaste = useCallback(async () => {
    if (!targetEntry || !clipboard.entry || !clipboard.operation) return;

    const destDir = targetEntry.isDirectory
      ? targetEntry.path
      : targetEntry.path.substring(0, targetEntry.path.lastIndexOf('/'));
    const destPath = `${destDir}/${clipboard.entry.name}`;

    try {
      if (clipboard.operation === 'cut') {
        await moveEntry(clipboard.entry.path, destPath);
      } else {
        await copyEntry(clipboard.entry.path, destPath);
      }
      clearClipboard();
      dispatchFileTreeRefresh();
    } catch (error) {
      console.error('Failed to paste:', error);
    }
  }, [targetEntry, clipboard, clearClipboard]);

  const handleCopyRelativePath = useCallback(async () => {
    if (!targetEntry || !currentDirectory) return;

    const relativePath = targetEntry.path.startsWith(currentDirectory)
      ? targetEntry.path.substring(currentDirectory.length + 1)
      : targetEntry.path;

    try {
      await navigator.clipboard.writeText(relativePath);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  }, [targetEntry, currentDirectory]);

  const handleCopyFullPath = useCallback(async () => {
    if (!targetEntry) return;

    try {
      await navigator.clipboard.writeText(targetEntry.path);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  }, [targetEntry]);

  const handleRevealInFinder = useCallback(async () => {
    if (!targetEntry) return;

    try {
      await revealInFileManager(targetEntry.path);
    } catch (error) {
      console.error('Failed to reveal in file manager:', error);
    }
  }, [targetEntry]);

  const items: ContextMenuItem[] = useMemo(() => {
    if (!targetEntry) return [];

    const menuItems: ContextMenuItem[] = [
      { label: 'Rename', onClick: handleRename },
      { label: 'Delete', onClick: handleDelete },
      { label: '', onClick: () => {}, separator: true },
      { label: 'Cut', onClick: handleCut },
      { label: 'Copy', onClick: handleCopy },
    ];

    if (clipboard.entry && clipboard.operation) {
      menuItems.push({ label: 'Paste', onClick: handlePaste });
    }

    menuItems.push(
      { label: '', onClick: () => {}, separator: true },
      { label: 'Copy Relative Path', onClick: handleCopyRelativePath },
      { label: 'Copy Full Path', onClick: handleCopyFullPath },
      { label: '', onClick: () => {}, separator: true },
      {
        label: navigator.platform.includes('Mac')
          ? 'Reveal in Finder'
          : navigator.platform.includes('Win')
            ? 'Reveal in File Explorer'
            : 'Open Containing Folder',
        onClick: handleRevealInFinder,
      },
    );

    return menuItems;
  }, [
    targetEntry,
    clipboard,
    handleRename,
    handleDelete,
    handleCut,
    handleCopy,
    handlePaste,
    handleCopyRelativePath,
    handleCopyFullPath,
    handleRevealInFinder,
  ]);

  return (
    <>
      <ContextMenu
        isOpen={isOpen}
        position={position}
        items={items}
        onClose={closeMenu}
      />
      <RenameDialog />
      <ConfirmDeleteDialog />
    </>
  );
}
