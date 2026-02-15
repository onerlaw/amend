import { describe, it, expect, beforeEach } from 'vitest';
import { useFileStore } from '@/stores/fileStore';
import type { OpenFile } from '@/stores/fileStore';

// Helper to create test files
function makeFile(path: string, name?: string): OpenFile {
  return {
    path,
    name: name ?? path.split('/').pop() ?? path,
    content: `content of ${path}`,
    isDirty: false,
    language: 'typescript',
  };
}

describe('fileStore', () => {
  beforeEach(() => {
    // Reset the store between tests
    useFileStore.setState({
      contextPath: null,
      savedBrowseState: {},
      browseOpenFiles: [],
      browseActiveFilePath: null,
      pendingScrollToLine: null,
      pendingScrollToFile: null,
      referencesSymbol: null,
    });
  });

  describe('openBrowseFile', () => {
    it('adds a new file and sets it active', () => {
      const file = makeFile('/project/src/main.ts');
      useFileStore.getState().openBrowseFile(file);

      const state = useFileStore.getState();
      expect(state.browseOpenFiles).toHaveLength(1);
      expect(state.browseOpenFiles[0].path).toBe('/project/src/main.ts');
      expect(state.browseActiveFilePath).toBe('/project/src/main.ts');
    });

    it('does not duplicate an already-open file', () => {
      const file = makeFile('/project/src/main.ts');
      useFileStore.getState().openBrowseFile(file);
      useFileStore.getState().openBrowseFile(file);

      expect(useFileStore.getState().browseOpenFiles).toHaveLength(1);
    });

    it('activates an already-open file without duplicating', () => {
      const file1 = makeFile('/project/a.ts');
      const file2 = makeFile('/project/b.ts');

      useFileStore.getState().openBrowseFile(file1);
      useFileStore.getState().openBrowseFile(file2);
      expect(useFileStore.getState().browseActiveFilePath).toBe('/project/b.ts');

      useFileStore.getState().openBrowseFile(file1);
      expect(useFileStore.getState().browseActiveFilePath).toBe('/project/a.ts');
      expect(useFileStore.getState().browseOpenFiles).toHaveLength(2);
    });
  });

  describe('closeBrowseFile', () => {
    it('removes the file from open files', () => {
      const file = makeFile('/project/a.ts');
      useFileStore.getState().openBrowseFile(file);
      useFileStore.getState().closeBrowseFile('/project/a.ts');

      expect(useFileStore.getState().browseOpenFiles).toHaveLength(0);
    });

    it('sets active to last remaining file when closing the active file', () => {
      const file1 = makeFile('/project/a.ts');
      const file2 = makeFile('/project/b.ts');
      const file3 = makeFile('/project/c.ts');

      useFileStore.getState().openBrowseFile(file1);
      useFileStore.getState().openBrowseFile(file2);
      useFileStore.getState().openBrowseFile(file3);

      // Active is c.ts, close it
      useFileStore.getState().closeBrowseFile('/project/c.ts');
      expect(useFileStore.getState().browseActiveFilePath).toBe('/project/b.ts');
    });

    it('sets active to null when closing the last file', () => {
      const file = makeFile('/project/a.ts');
      useFileStore.getState().openBrowseFile(file);
      useFileStore.getState().closeBrowseFile('/project/a.ts');

      expect(useFileStore.getState().browseActiveFilePath).toBeNull();
    });

    it('preserves active file when closing a non-active file', () => {
      const file1 = makeFile('/project/a.ts');
      const file2 = makeFile('/project/b.ts');

      useFileStore.getState().openBrowseFile(file1);
      useFileStore.getState().openBrowseFile(file2);
      // Active is b.ts
      useFileStore.getState().closeBrowseFile('/project/a.ts');

      expect(useFileStore.getState().browseActiveFilePath).toBe('/project/b.ts');
      expect(useFileStore.getState().browseOpenFiles).toHaveLength(1);
    });
  });

  describe('updateBrowseFileContent', () => {
    it('updates content and marks file dirty', () => {
      const file = makeFile('/project/a.ts');
      useFileStore.getState().openBrowseFile(file);
      useFileStore.getState().updateBrowseFileContent('/project/a.ts', 'new content');

      const updated = useFileStore.getState().browseOpenFiles[0];
      expect(updated.content).toBe('new content');
      expect(updated.isDirty).toBe(true);
    });
  });

  describe('markBrowseFileSaved', () => {
    it('clears dirty flag', () => {
      const file = makeFile('/project/a.ts');
      useFileStore.getState().openBrowseFile(file);
      useFileStore.getState().updateBrowseFileContent('/project/a.ts', 'modified');
      expect(useFileStore.getState().browseOpenFiles[0].isDirty).toBe(true);

      useFileStore.getState().markBrowseFileSaved('/project/a.ts');
      expect(useFileStore.getState().browseOpenFiles[0].isDirty).toBe(false);
    });
  });

  describe('syncTabContext', () => {
    it('saves and restores browse state when switching contexts', () => {
      // Set up context A with an open file
      useFileStore.setState({ contextPath: '/project-a' });
      const fileA = makeFile('/project-a/src/main.ts');
      useFileStore.getState().openBrowseFile(fileA);

      // Switch to context B
      useFileStore.getState().syncTabContext('/project-b');
      expect(useFileStore.getState().contextPath).toBe('/project-b');
      expect(useFileStore.getState().browseOpenFiles).toHaveLength(0);

      // Open a file in context B
      const fileB = makeFile('/project-b/src/app.ts');
      useFileStore.getState().openBrowseFile(fileB);

      // Switch back to context A - should restore context A's files
      useFileStore.getState().syncTabContext('/project-a');
      expect(useFileStore.getState().contextPath).toBe('/project-a');
      expect(useFileStore.getState().browseOpenFiles).toHaveLength(1);
      expect(useFileStore.getState().browseOpenFiles[0].path).toBe('/project-a/src/main.ts');
    });

    it('does nothing when context has not changed', () => {
      useFileStore.setState({ contextPath: '/project' });
      const file = makeFile('/project/main.ts');
      useFileStore.getState().openBrowseFile(file);

      useFileStore.getState().syncTabContext('/project');
      // Files should remain unchanged
      expect(useFileStore.getState().browseOpenFiles).toHaveLength(1);
    });
  });

  describe('reorderBrowseFiles', () => {
    it('reorders open files', () => {
      useFileStore.getState().openBrowseFile(makeFile('/a.ts'));
      useFileStore.getState().openBrowseFile(makeFile('/b.ts'));
      useFileStore.getState().openBrowseFile(makeFile('/c.ts'));

      useFileStore.getState().reorderBrowseFiles(0, 2);

      const paths = useFileStore.getState().browseOpenFiles.map((f) => f.path);
      expect(paths).toEqual(['/b.ts', '/c.ts', '/a.ts']);
    });
  });

  describe('openBrowseFileAtLine', () => {
    it('sets pending scroll line and file', () => {
      const file = makeFile('/project/main.ts');
      useFileStore.getState().openBrowseFileAtLine(file, 42);

      const state = useFileStore.getState();
      expect(state.pendingScrollToLine).toBe(42);
      expect(state.pendingScrollToFile).toBe('/project/main.ts');
      expect(state.browseActiveFilePath).toBe('/project/main.ts');
    });
  });
});
