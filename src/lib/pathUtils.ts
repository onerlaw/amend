/**
 * Cross-platform path utilities.
 * Handles both / and \ separators, always outputs /.
 */

/** Return the last segment of a path. */
export function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '');
  if (!trimmed) return '';
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return i === -1 ? trimmed : trimmed.slice(i + 1);
}

/** Return everything before the last segment. */
export function dirname(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '');
  if (!trimmed) return '.';
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (i === -1) return '.';
  if (i === 0) return '/';
  return trimmed.slice(0, i);
}

/** Return the file extension including the leading dot. */
export function extname(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot);
}

/** Join path segments and normalize the result. */
export function join(...parts: string[]): string {
  if (parts.length === 0) return '.';
  return normalize(parts.filter(Boolean).join('/'));
}

/** Resolve `.`/`..` segments and normalize separators to `/`. */
export function normalize(path: string): string {
  if (!path) return '.';

  const p = path.replace(/\\/g, '/');

  // Extract root prefix
  let root = '';
  let rest = p;
  if (/^[a-zA-Z]:\//.test(p)) {
    root = p.slice(0, 3);
    rest = p.slice(3);
  } else if (p[0] === '/') {
    root = '/';
    rest = p.slice(1);
  }

  const segments = rest.split('/');
  const result: string[] = [];

  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (result.length > 0 && result[result.length - 1] !== '..') {
        result.pop();
      } else if (!root) {
        result.push('..');
      }
    } else {
      result.push(seg);
    }
  }

  const joined = result.join('/');
  if (root) return root + joined;
  return joined || '.';
}

/** Check whether a path is absolute. */
export function isAbsolute(path: string): boolean {
  return path[0] === '/' || /^[a-zA-Z]:[/\\]/.test(path);
}
