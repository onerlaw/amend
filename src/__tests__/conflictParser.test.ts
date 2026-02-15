import { describe, it, expect } from 'vitest';
import { parseConflicts, resolveConflict, hasConflictMarkers } from '@/lib/conflictParser';

describe('parseConflicts', () => {
  it('returns null for content without conflicts', () => {
    expect(parseConflicts('hello\nworld')).toBeNull();
    expect(parseConflicts('')).toBeNull();
  });

  it('parses a single conflict', () => {
    const content = [
      'before',
      '<<<<<<< HEAD',
      'our line',
      '=======',
      'their line',
      '>>>>>>> feature',
      'after',
    ].join('\n');

    const segments = parseConflicts(content);
    expect(segments).not.toBeNull();
    expect(segments).toHaveLength(3);

    expect(segments![0]).toEqual({ kind: 'normal', lines: ['before'] });
    expect(segments![1]).toEqual({
      kind: 'conflict',
      oursLabel: 'HEAD',
      theirsLabel: 'feature',
      oursLines: ['our line'],
      theirsLines: ['their line'],
    });
    expect(segments![2]).toEqual({ kind: 'normal', lines: ['after'] });
  });

  it('parses multiple conflicts', () => {
    const content = [
      '<<<<<<< HEAD',
      'a',
      '=======',
      'b',
      '>>>>>>> branch1',
      'middle',
      '<<<<<<< HEAD',
      'c',
      '=======',
      'd',
      '>>>>>>> branch2',
    ].join('\n');

    const segments = parseConflicts(content);
    expect(segments).not.toBeNull();
    expect(segments).toHaveLength(3);
    expect(segments![0].kind).toBe('conflict');
    expect(segments![1]).toEqual({ kind: 'normal', lines: ['middle'] });
    expect(segments![2].kind).toBe('conflict');
  });

  it('handles multi-line conflict sections', () => {
    const content = [
      '<<<<<<< HEAD',
      'line 1',
      'line 2',
      '=======',
      'line 3',
      'line 4',
      'line 5',
      '>>>>>>> feature',
    ].join('\n');

    const segments = parseConflicts(content);
    expect(segments).not.toBeNull();
    expect(segments).toHaveLength(1);
    const conflict = segments![0];
    expect(conflict.kind).toBe('conflict');
    if (conflict.kind === 'conflict') {
      expect(conflict.oursLines).toEqual(['line 1', 'line 2']);
      expect(conflict.theirsLines).toEqual(['line 3', 'line 4', 'line 5']);
    }
  });

  it('uses default labels when none provided', () => {
    const content = ['<<<<<<<', 'ours', '=======', 'theirs', '>>>>>>>'].join('\n');

    const segments = parseConflicts(content);
    expect(segments).not.toBeNull();
    const conflict = segments![0];
    if (conflict.kind === 'conflict') {
      expect(conflict.oursLabel).toBe('Current Change');
      expect(conflict.theirsLabel).toBe('Incoming Change');
    }
  });

  it('handles empty conflict sections', () => {
    const content = ['<<<<<<< HEAD', '=======', '>>>>>>> feature'].join('\n');

    const segments = parseConflicts(content);
    expect(segments).not.toBeNull();
    const conflict = segments![0];
    if (conflict.kind === 'conflict') {
      expect(conflict.oursLines).toEqual([]);
      expect(conflict.theirsLines).toEqual([]);
    }
  });
});

describe('resolveConflict', () => {
  const segments = parseConflicts(
    [
      'before',
      '<<<<<<< HEAD',
      'our change',
      '=======',
      'their change',
      '>>>>>>> feature',
      'after',
    ].join('\n')
  )!;

  it('resolves with ours', () => {
    const result = resolveConflict(segments, 0, 'ours');
    expect(result).toBe('before\nour change\nafter');
  });

  it('resolves with theirs', () => {
    const result = resolveConflict(segments, 0, 'theirs');
    expect(result).toBe('before\ntheir change\nafter');
  });

  it('resolves with both', () => {
    const result = resolveConflict(segments, 0, 'both');
    expect(result).toBe('before\nour change\ntheir change\nafter');
  });

  it('preserves other conflicts when resolving one', () => {
    const multiConflict = parseConflicts(
      [
        '<<<<<<< HEAD',
        'a',
        '=======',
        'b',
        '>>>>>>> branch',
        '<<<<<<< HEAD',
        'c',
        '=======',
        'd',
        '>>>>>>> branch',
      ].join('\n')
    )!;

    const result = resolveConflict(multiConflict, 0, 'ours');
    // First conflict resolved to 'a', second preserved with markers
    expect(result).toContain('a\n<<<<<<< HEAD');
    expect(result).toContain('>>>>>>> branch');
  });
});

describe('hasConflictMarkers', () => {
  it('returns true when markers are present', () => {
    expect(hasConflictMarkers('<<<<<<< HEAD\ncode\n=======\nother\n>>>>>>> branch')).toBe(true);
  });

  it('returns false when no markers', () => {
    expect(hasConflictMarkers('normal code\nno conflicts here')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasConflictMarkers('')).toBe(false);
  });

  it('requires at least 7 angle brackets', () => {
    expect(hasConflictMarkers('<<<<<< not enough')).toBe(false);
    expect(hasConflictMarkers('<<<<<<< enough')).toBe(true);
  });
});
