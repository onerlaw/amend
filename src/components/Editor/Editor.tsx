import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import { useFileStore, OpenFile } from '@/stores/fileStore';
import { writeFile } from '@/lib/tauri';
import { customHighlightStyle, darkTheme, getLanguageExtension } from '@/lib/codemirror';

interface EditorProps {
  file: OpenFile;
}

export function Editor({ file }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { updateFileContent, markFileSaved } = useFileStore();

  useEffect(() => {
    if (!containerRef.current) return;

    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          handleSave();
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const content = update.state.doc.toString();
        updateFileContent(file.path, content);
      }
    });

    const state = EditorState.create({
      doc: file.content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        saveKeymap,
        darkTheme,
        syntaxHighlighting(customHighlightStyle),
        getLanguageExtension(file.language),
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
  }, [file.path]); // Only recreate on file path change

  const handleSave = async () => {
    if (viewRef.current) {
      const content = viewRef.current.state.doc.toString();
      try {
        await writeFile(file.path, content);
        markFileSaved(file.path);
      } catch (error) {
        console.error('Failed to save file:', error);
      }
    }
  };

  return <div ref={containerRef} className="h-full w-full" />;
}
