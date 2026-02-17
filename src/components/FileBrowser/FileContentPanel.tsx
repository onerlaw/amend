import { useEffect, useRef } from 'react';
import { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { OpenFile } from '@/stores/fileStore';
import { createBaseExtensions, loadLanguageExtension } from '@/lib/codemirror';
import { buildImageDataUrl } from '@/lib/fileUtils';

interface FileContentPanelProps {
  file: OpenFile;
  onContentChange: (content: string) => void;
  onEditorView?: (view: EditorView | null) => void;
  additionalExtensions?: Extension[];
}

export function FileContentPanel({
  file,
  onContentChange,
  onEditorView,
  additionalExtensions = [],
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
      extensions: [...createBaseExtensions(file.language), updateListener, ...additionalExtensions],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;
    onEditorViewRef.current?.(view);
    loadLanguageExtension(view, file.language);

    return () => {
      view.destroy();
      onEditorViewRef.current?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- file.content is handled by the sync effect below; file.language changes with file.path
  }, [file.path, file.isImage, additionalExtensions]);

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

  return <div ref={containerRef} className="h-full w-full" />;
}
