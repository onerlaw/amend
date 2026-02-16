import { describe, it, expect } from 'vitest';
import {
  isImageFile,
  getImageMimeType,
  buildImageDataUrl,
  getFileIconColor,
  getFileName,
  toggleSetItem,
  reorderArray,
  sortDirectoriesFirst,
} from '@/lib/fileUtils';

describe('isImageFile', () => {
  it('returns true for image extensions', () => {
    expect(isImageFile('photo.png')).toBe(true);
    expect(isImageFile('photo.jpg')).toBe(true);
    expect(isImageFile('photo.jpeg')).toBe(true);
    expect(isImageFile('photo.gif')).toBe(true);
    expect(isImageFile('icon.svg')).toBe(true);
    expect(isImageFile('photo.webp')).toBe(true);
    expect(isImageFile('photo.bmp')).toBe(true);
    expect(isImageFile('favicon.ico')).toBe(true);
  });

  it('returns false for non-image extensions', () => {
    expect(isImageFile('main.ts')).toBe(false);
    expect(isImageFile('styles.css')).toBe(false);
    expect(isImageFile('README.md')).toBe(false);
    expect(isImageFile('data.json')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isImageFile('PHOTO.PNG')).toBe(true);
    expect(isImageFile('photo.JPG')).toBe(true);
  });

  it('handles paths with directories', () => {
    expect(isImageFile('src/assets/logo.png')).toBe(true);
    expect(isImageFile('/home/user/file.ts')).toBe(false);
  });

  it('handles edge cases', () => {
    expect(isImageFile('')).toBe(false);
    expect(isImageFile('noextension')).toBe(false);
  });
});

describe('getImageMimeType', () => {
  it('returns correct mime types', () => {
    expect(getImageMimeType('photo.png')).toBe('image/png');
    expect(getImageMimeType('photo.jpg')).toBe('image/jpeg');
    expect(getImageMimeType('photo.jpeg')).toBe('image/jpeg');
    expect(getImageMimeType('photo.gif')).toBe('image/gif');
    expect(getImageMimeType('icon.svg')).toBe('image/svg+xml');
    expect(getImageMimeType('photo.webp')).toBe('image/webp');
    expect(getImageMimeType('photo.bmp')).toBe('image/bmp');
    expect(getImageMimeType('favicon.ico')).toBe('image/x-icon');
  });

  it('returns octet-stream for unknown extensions', () => {
    expect(getImageMimeType('file.xyz')).toBe('application/octet-stream');
    expect(getImageMimeType('file.ts')).toBe('application/octet-stream');
  });
});

describe('buildImageDataUrl', () => {
  it('builds correct data URL', () => {
    expect(buildImageDataUrl('abc123', 'photo.png')).toBe('data:image/png;base64,abc123');
    expect(buildImageDataUrl('xyz', 'icon.svg')).toBe('data:image/svg+xml;base64,xyz');
  });
});

describe('getFileIconColor', () => {
  it('returns correct colors for known extensions', () => {
    expect(getFileIconColor('main.ts')).toBe('text-blue-400');
    expect(getFileIconColor('App.tsx')).toBe('text-blue-400');
    expect(getFileIconColor('index.js')).toBe('text-yellow-400');
    expect(getFileIconColor('Component.jsx')).toBe('text-yellow-400');
    expect(getFileIconColor('lib.rs')).toBe('text-orange-400');
    expect(getFileIconColor('script.py')).toBe('text-green-400');
    expect(getFileIconColor('config.json')).toBe('text-yellow-300');
    expect(getFileIconColor('README.md')).toBe('text-blue-300');
    expect(getFileIconColor('styles.css')).toBe('text-pink-400');
    expect(getFileIconColor('styles.scss')).toBe('text-pink-400');
    expect(getFileIconColor('index.html')).toBe('text-orange-300');
  });

  it('returns default color for unknown extensions', () => {
    expect(getFileIconColor('Makefile')).toBe('text-tertiary');
    expect(getFileIconColor('unknown.xyz')).toBe('text-tertiary');
  });

  it('accepts a custom default color', () => {
    expect(getFileIconColor('unknown.xyz', 'text-gray-500')).toBe('text-gray-500');
  });
});

describe('getFileName', () => {
  it('extracts filename from path', () => {
    expect(getFileName('src/lib/fileUtils.ts')).toBe('fileUtils.ts');
    expect(getFileName('/home/user/project/main.rs')).toBe('main.rs');
  });

  it('returns the input for bare filenames', () => {
    expect(getFileName('file.txt')).toBe('file.txt');
  });

  it('handles trailing slash edge case', () => {
    expect(getFileName('src/')).toBe('src');
  });

  it('handles empty string', () => {
    expect(getFileName('')).toBe('');
  });
});

describe('toggleSetItem', () => {
  it('adds item not in set', () => {
    const set = new Set([1, 2, 3]);
    const result = toggleSetItem(set, 4);
    expect(result.has(4)).toBe(true);
    expect(result.size).toBe(4);
  });

  it('removes item already in set', () => {
    const set = new Set([1, 2, 3]);
    const result = toggleSetItem(set, 2);
    expect(result.has(2)).toBe(false);
    expect(result.size).toBe(2);
  });

  it('does not mutate original set', () => {
    const set = new Set([1, 2, 3]);
    toggleSetItem(set, 4);
    expect(set.size).toBe(3);
    expect(set.has(4)).toBe(false);
  });

  it('works with strings', () => {
    const set = new Set(['a', 'b']);
    expect(toggleSetItem(set, 'c').has('c')).toBe(true);
    expect(toggleSetItem(set, 'a').has('a')).toBe(false);
  });
});

describe('reorderArray', () => {
  it('moves item forward', () => {
    expect(reorderArray([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
  });

  it('moves item backward', () => {
    expect(reorderArray([1, 2, 3, 4], 3, 1)).toEqual([1, 4, 2, 3]);
  });

  it('returns same order if indices are equal', () => {
    expect(reorderArray([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
  });

  it('does not mutate the original array', () => {
    const arr = [1, 2, 3];
    reorderArray(arr, 0, 2);
    expect(arr).toEqual([1, 2, 3]);
  });
});

describe('sortDirectoriesFirst', () => {
  it('sorts directories before files', () => {
    const entries = [
      { name: 'file.ts', isDirectory: false },
      { name: 'src', isDirectory: true },
      { name: 'another.ts', isDirectory: false },
      { name: 'lib', isDirectory: true },
    ];
    const sorted = sortDirectoriesFirst(entries);
    expect(sorted.map((e) => e.name)).toEqual(['lib', 'src', 'another.ts', 'file.ts']);
  });

  it('sorts alphabetically within same type', () => {
    const entries = [
      { name: 'z.ts', isDirectory: false },
      { name: 'a.ts', isDirectory: false },
      { name: 'm.ts', isDirectory: false },
    ];
    const sorted = sortDirectoriesFirst(entries);
    expect(sorted.map((e) => e.name)).toEqual(['a.ts', 'm.ts', 'z.ts']);
  });

  it('does not mutate the original array', () => {
    const entries = [
      { name: 'b.ts', isDirectory: false },
      { name: 'a', isDirectory: true },
    ];
    const original = [...entries];
    sortDirectoriesFirst(entries);
    expect(entries).toEqual(original);
  });

  it('handles empty array', () => {
    expect(sortDirectoriesFirst([])).toEqual([]);
  });
});
