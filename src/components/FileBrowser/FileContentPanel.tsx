import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { OpenFile } from '@/stores/fileStore';
import { createBaseExtensions } from '@/lib/codemirror';

interface FileContentPanelProps {
  file: OpenFile;
  onContentChange: (content: string) => void;
}

export function FileContentPanel({ file, onContentChange }: FileContentPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onContentChangeRef = useRef(onContentChange);

  // Keep callback ref updated
  useEffect(() => {
    onContentChangeRef.current = onContentChange;
  }, [onContentChange]);

  useEffect(() => {
    if (!containerRef.current) return;

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
      extensions: [
        ...createBaseExtensions(file.language),
        updateListener,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
  }, [file.path]); // Only recreate when file path changes

  // Update content when file content changes externally (not from typing)
  useEffect(() => {
    if (!viewRef.current) return;

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
  }, [file.content, file.isDirty]);

  return (
    <div ref={containerRef} className="h-full" />
  );
}
