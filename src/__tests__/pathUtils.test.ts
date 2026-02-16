import { describe, it, expect } from 'vitest';
import { basename, dirname, extname, join, normalize, isAbsolute } from '@/lib/pathUtils';

describe('basename', () => {
  it('extracts the last segment', () => {
    expect(basename('/foo/bar/baz.ts')).toBe('baz.ts');
    expect(basename('src/lib/file.ts')).toBe('file.ts');
  });

  it('returns the input for bare filenames', () => {
    expect(basename('file.txt')).toBe('file.txt');
  });

  it('strips trailing slashes', () => {
    expect(basename('src/')).toBe('src');
    expect(basename('/foo/bar/')).toBe('bar');
  });

  it('handles root', () => {
    expect(basename('/')).toBe('');
  });

  it('handles empty string', () => {
    expect(basename('')).toBe('');
  });

  it('handles Windows backslashes', () => {
    expect(basename('C:\\Users\\foo\\file.txt')).toBe('file.txt');
    expect(basename('src\\lib\\file.ts')).toBe('file.ts');
  });

  it('handles hidden files', () => {
    expect(basename('/home/.gitignore')).toBe('.gitignore');
  });

  it('handles mixed separators', () => {
    expect(basename('foo/bar\\baz.ts')).toBe('baz.ts');
  });
});

describe('dirname', () => {
  it('returns parent directory', () => {
    expect(dirname('/foo/bar/baz.ts')).toBe('/foo/bar');
    expect(dirname('src/lib/file.ts')).toBe('src/lib');
  });

  it('returns . for bare filenames', () => {
    expect(dirname('file.txt')).toBe('.');
  });

  it('strips trailing slashes before computing', () => {
    expect(dirname('src/')).toBe('.');
    expect(dirname('/foo/bar/')).toBe('/foo');
  });

  it('returns / for root-level files', () => {
    expect(dirname('/file.txt')).toBe('/');
  });

  it('returns / for root', () => {
    expect(dirname('/')).toBe('.');
  });

  it('returns . for empty string', () => {
    expect(dirname('')).toBe('.');
  });

  it('handles Windows backslashes', () => {
    expect(dirname('C:\\Users\\foo\\file.txt')).toBe('C:\\Users\\foo');
  });

  it('handles mixed separators', () => {
    expect(dirname('foo/bar\\baz.ts')).toBe('foo/bar');
  });
});

describe('extname', () => {
  it('returns extension with dot', () => {
    expect(extname('file.ts')).toBe('.ts');
    expect(extname('/foo/bar.test.tsx')).toBe('.tsx');
  });

  it('returns empty for no extension', () => {
    expect(extname('Makefile')).toBe('');
    expect(extname('/foo/bar')).toBe('');
  });

  it('returns empty for hidden files with no extension', () => {
    expect(extname('.gitignore')).toBe('');
    expect(extname('/home/.bashrc')).toBe('');
  });

  it('handles trailing dot', () => {
    expect(extname('file.')).toBe('.');
  });

  it('handles hidden files with extensions', () => {
    expect(extname('.eslintrc.json')).toBe('.json');
  });

  it('handles paths with directories', () => {
    expect(extname('src/lib/file.ts')).toBe('.ts');
  });
});

describe('join', () => {
  it('joins segments with /', () => {
    expect(join('foo', 'bar')).toBe('foo/bar');
    expect(join('/foo', 'bar', 'baz')).toBe('/foo/bar/baz');
  });

  it('resolves .. during join', () => {
    expect(join('foo', '..', 'bar')).toBe('bar');
    expect(join('/foo', 'bar', '..', 'baz')).toBe('/foo/baz');
  });

  it('returns . for no arguments', () => {
    expect(join()).toBe('.');
  });

  it('skips empty parts', () => {
    expect(join('', 'foo', '', 'bar')).toBe('foo/bar');
  });

  it('handles absolute paths', () => {
    expect(join('/', 'foo', 'bar')).toBe('/foo/bar');
  });

  it('normalizes backslashes', () => {
    expect(join('foo\\bar', 'baz')).toBe('foo/bar/baz');
  });

  it('handles single part', () => {
    expect(join('foo')).toBe('foo');
    expect(join('/foo')).toBe('/foo');
  });
});

describe('normalize', () => {
  it('resolves . and ..', () => {
    expect(normalize('/foo/./bar/../baz')).toBe('/foo/baz');
    expect(normalize('foo/./bar')).toBe('foo/bar');
  });

  it('normalizes separators', () => {
    expect(normalize('foo\\bar\\baz')).toBe('foo/bar/baz');
    expect(normalize('foo//bar///baz')).toBe('foo/bar/baz');
  });

  it('returns . for empty input', () => {
    expect(normalize('')).toBe('.');
  });

  it('preserves absolute paths', () => {
    expect(normalize('/foo/bar')).toBe('/foo/bar');
  });

  it('does not go above root', () => {
    expect(normalize('/foo/../..')).toBe('/');
    expect(normalize('/../foo')).toBe('/foo');
  });

  it('handles relative .. correctly', () => {
    expect(normalize('foo/../..')).toBe('..');
    expect(normalize('../foo')).toBe('../foo');
  });

  it('handles Windows drive letters', () => {
    expect(normalize('C:\\Users\\foo\\..\\bar')).toBe('C:/Users/bar');
    expect(normalize('C:/foo/./bar')).toBe('C:/foo/bar');
  });

  it('handles trailing slashes', () => {
    expect(normalize('/foo/bar/')).toBe('/foo/bar');
  });

  it('handles only dots', () => {
    expect(normalize('.')).toBe('.');
    expect(normalize('..')).toBe('..');
    expect(normalize('./.')).toBe('.');
  });
});

describe('isAbsolute', () => {
  it('detects Unix absolute paths', () => {
    expect(isAbsolute('/foo')).toBe(true);
    expect(isAbsolute('/')).toBe(true);
  });

  it('detects Windows absolute paths', () => {
    expect(isAbsolute('C:/')).toBe(true);
    expect(isAbsolute('C:\\')).toBe(true);
    expect(isAbsolute('D:/foo')).toBe(true);
  });

  it('returns false for relative paths', () => {
    expect(isAbsolute('foo')).toBe(false);
    expect(isAbsolute('./foo')).toBe(false);
    expect(isAbsolute('../foo')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isAbsolute('')).toBe(false);
  });
});
