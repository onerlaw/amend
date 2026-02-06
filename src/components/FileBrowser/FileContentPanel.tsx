import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { OpenFile } from '@/stores/fileStore';
import { createBaseExtensions } from '@/lib/codemirror';
import { buildImageDataUrl } from '@/lib/fileUtils';

interface FileContentPanelProps {
  file: OpenFile;
  onContentChange: (content: string) => void;
  onEditorView?: (view: EditorView | null) => void;
}

export function FileContentPanel({
  file,
  onContentChange,
  onEditorView,
}: FileContentPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onContentChangeRef = useRef(onContentChange);
  const onEditorViewRef = useRef(onEditorView);

  // Keep callback refs updated
  useEffect(() => {
    onContentChangeRef.current = onContentChange;
  }, [onContentChange]);

  useEffect(() => {
    onEditorViewRef.current = onEditorView;
  }, [onEditorView]);

  useEffect(() => {
    if (!containerRef.current || file.isImage) {
      onEditorViewRef.current?.(null);
      return;
    }

    // Clear any existing editor
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const newContent = update.state.doc.toString();
        onContentChangeRef.current(newContent);
      }
    });

    const state = EditorState.create({
      doc: file.content,
      extensions: [...createBaseExtensions(file.language), updateListener],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;
    onEditorViewRef.current?.(view);

    return () => {
      view.destroy();
      onEditorViewRef.current?.(null);
    };
  }, [file.path, file.isImage]); // Only recreate when file path changes

  // Update content when file content changes externally (not from typing)
  useEffect(() => {
    if (!viewRef.current || file.isImage) return;

    const currentContent = viewRef.current.state.doc.toString();
    // Only update if content differs and file is not dirty (external change)
    if (currentContent !== file.content && !file.isDirty) {
      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: file.content,
        },
      });
    }
  }, [file.content, file.isDirty, file.isImage]);

  if (file.isImage) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-0 p-8">
        <img
          src={buildImageDataUrl(file.content, file.path)}
          alt={file.name}
          className="max-w-full max-h-full object-contain rounded-md"
        />
      </div>
    );
  }

  return <div ref={containerRef} className="h-full" />;
}
