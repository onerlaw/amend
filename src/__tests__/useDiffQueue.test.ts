import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDiffQueue } from '@/hooks/useDiffQueue';
import type { GitDiff } from '@/lib/tauri';

function makeDiff(filePath: string): GitDiff {
  return {
    oldPath: filePath,
    newPath: filePath,
    oldContent: `old:${filePath}`,
    newContent: `new:${filePath}`,
    isBinary: false,
  };
}

describe('useDiffQueue', () => {
  it('processes enqueued files and populates diffs', async () => {
    const fetchDiff = vi.fn((filePath: string) => Promise.resolve(makeDiff(filePath)));

    const { result } = renderHook(() => useDiffQueue(fetchDiff, 5));

    await act(async () => {
      result.current.enqueue('a.ts');
    });

    expect(fetchDiff).toHaveBeenCalledWith('a.ts');
    expect(result.current.diffs.get('a.ts')?.isLoading).toBe(false);
    expect(result.current.diffs.get('a.ts')?.newContent).toBe('new:a.ts');
    expect(result.current.activeCountRef.current).toBe(0);
  });

  it('activeCount does not go negative when clear() is called with in-flight requests', async () => {
    let resolver: ((v: GitDiff) => void) | undefined;
    const fetchDiff = vi.fn(
      () =>
        new Promise<GitDiff>((resolve) => {
          resolver = resolve;
        })
    );

    const { result } = renderHook(() => useDiffQueue(fetchDiff, 5));

    // Enqueue one file to create an in-flight request
    act(() => {
      result.current.enqueue('a.ts');
    });

    expect(result.current.activeCountRef.current).toBe(1);
    expect(fetchDiff).toHaveBeenCalledTimes(1);

    // Clear while the request is in flight
    act(() => {
      result.current.clear();
    });

    // activeCount should NOT have been hard-reset to 0 —
    // it should still reflect the 1 in-flight request
    expect(result.current.activeCountRef.current).toBe(1);

    // Now resolve the stale in-flight request
    await act(async () => {
      resolver!(makeDiff('a.ts'));
    });

    // activeCount should drain to 0, never going negative
    expect(result.current.activeCountRef.current).toBe(0);

    // Diffs map should remain empty since results are from old generation
    expect(result.current.diffs.size).toBe(0);
  });

  it('new enqueues work correctly after clear() + stale completions', async () => {
    let resolver: ((v: GitDiff) => void) | undefined;
    const fetchDiff = vi.fn(
      (_filePath: string) =>
        new Promise<GitDiff>((resolve) => {
          resolver = resolve;
        })
    );

    const { result } = renderHook(() => useDiffQueue(fetchDiff, 5));

    // Enqueue one file
    act(() => {
      result.current.enqueue('a.ts');
    });

    expect(result.current.activeCountRef.current).toBe(1);

    // Clear and then resolve stale request
    act(() => {
      result.current.clear();
    });

    await act(async () => {
      resolver!(makeDiff('a.ts'));
    });

    expect(result.current.activeCountRef.current).toBe(0);

    // Now enqueue a new file — it should be fetched since count is back to 0
    await act(async () => {
      result.current.enqueue('x.ts');
    });

    expect(fetchDiff).toHaveBeenCalledWith('x.ts');
    expect(result.current.activeCountRef.current).toBe(1);

    // Resolve the new request
    await act(async () => {
      resolver!(makeDiff('x.ts'));
    });

    expect(result.current.activeCountRef.current).toBe(0);
    expect(result.current.diffs.get('x.ts')?.newContent).toBe('new:x.ts');
  });

  it('handles errors without underflow', async () => {
    const fetchDiff = vi.fn(() => Promise.reject(new Error('network error')));

    const { result } = renderHook(() => useDiffQueue(fetchDiff, 5));

    await act(async () => {
      result.current.enqueue('fail.ts');
    });

    expect(result.current.activeCountRef.current).toBe(0);
    expect(result.current.diffs.get('fail.ts')?.error).toBe('network error');
    expect(result.current.diffs.get('fail.ts')?.isLoading).toBe(false);
  });

  it('clear() bumps generation and discards stale error results', async () => {
    let rejecter: ((e: Error) => void) | undefined;
    const fetchDiff = vi.fn(
      () =>
        new Promise<GitDiff>((_resolve, reject) => {
          rejecter = reject;
        })
    );

    const { result } = renderHook(() => useDiffQueue(fetchDiff, 5));

    act(() => {
      result.current.enqueue('a.ts');
    });

    const genBefore = result.current.generationRef.current;

    act(() => {
      result.current.clear();
    });

    expect(result.current.generationRef.current).toBe(genBefore + 1);

    // Reject the stale request
    await act(async () => {
      rejecter!(new Error('stale error'));
    });

    // Stale error should not appear in diffs
    expect(result.current.diffs.size).toBe(0);
    expect(result.current.activeCountRef.current).toBe(0);
  });

  it('Math.max guard prevents underflow even in edge cases', async () => {
    const fetchDiff = vi.fn((filePath: string) => Promise.resolve(makeDiff(filePath)));

    const { result } = renderHook(() => useDiffQueue(fetchDiff, 5));

    // activeCount starts at 0; verify it can never go below 0
    expect(result.current.activeCountRef.current).toBe(0);

    await act(async () => {
      result.current.enqueue('a.ts');
    });

    // After successful completion, count should be exactly 0
    expect(result.current.activeCountRef.current).toBe(0);
  });

  it('processes queue items sequentially when concurrency is 1', async () => {
    const resolvers: Array<(v: GitDiff) => void> = [];
    const fetchDiff = vi.fn(
      (_filePath: string) =>
        new Promise<GitDiff>((resolve) => {
          resolvers.push(resolve);
        })
    );

    const { result } = renderHook(() => useDiffQueue(fetchDiff, 1));

    // Enqueue 3 files with concurrency=1
    act(() => {
      result.current.enqueueBatch(['a.ts', 'b.ts', 'c.ts']);
    });

    // Only 1 should be in-flight (processQueue awaits before looping)
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    expect(fetchDiff).toHaveBeenCalledWith('a.ts');
    expect(result.current.activeCountRef.current).toBe(1);

    // Resolve first — triggers processQueue recursion for next item
    await act(async () => {
      resolvers[0]!(makeDiff('a.ts'));
    });

    expect(fetchDiff).toHaveBeenCalledTimes(2);
    expect(fetchDiff).toHaveBeenCalledWith('b.ts');

    // Resolve second
    await act(async () => {
      resolvers[1]!(makeDiff('b.ts'));
    });

    expect(fetchDiff).toHaveBeenCalledTimes(3);
    expect(fetchDiff).toHaveBeenCalledWith('c.ts');
  });

  it('enqueueBatch deduplicates already-loaded files', async () => {
    const fetchDiff = vi.fn((filePath: string) => Promise.resolve(makeDiff(filePath)));

    const { result } = renderHook(() => useDiffQueue(fetchDiff, 5));

    await act(async () => {
      result.current.enqueue('a.ts');
    });

    expect(fetchDiff).toHaveBeenCalledTimes(1);

    // Batch enqueue including already-loaded 'a.ts'
    await act(async () => {
      result.current.enqueueBatch(['a.ts', 'b.ts']);
    });

    // 'a.ts' should not be fetched again
    expect(fetchDiff).toHaveBeenCalledTimes(2);
    expect(fetchDiff).toHaveBeenCalledWith('b.ts');
  });

  it('multiple sequential clears do not corrupt state', async () => {
    let resolver: ((v: GitDiff) => void) | undefined;
    const fetchDiff = vi.fn(
      () =>
        new Promise<GitDiff>((resolve) => {
          resolver = resolve;
        })
    );

    const { result } = renderHook(() => useDiffQueue(fetchDiff, 5));

    act(() => {
      result.current.enqueue('a.ts');
    });

    // Call clear multiple times rapidly
    act(() => {
      result.current.clear();
      result.current.clear();
      result.current.clear();
    });

    // Generation should have been bumped 3 times
    expect(result.current.generationRef.current).toBe(3);

    // Resolve the original stale request
    await act(async () => {
      resolver!(makeDiff('a.ts'));
    });

    // Count should still be 0, not negative
    expect(result.current.activeCountRef.current).toBe(0);
    expect(result.current.diffs.size).toBe(0);
  });
});
