// Path helpers for the viewer. View-relative paths are always POSIX; the view
// root is whatever the server's OS uses. Pure, so `node --test` can load it.

export function dirname(relPath: string): string {
  const slash = relPath.lastIndexOf('/');
  return slash === -1 ? '' : relPath.slice(0, slash);
}

export function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/** A URL with a scheme (`https:`, `mailto:`, `data:`) or protocol-relative. */
export function isExternalUrl(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');
}

/** Resolve a Markdown link or image `href` written in `fromFile` to a
 *  view-relative path. Returns `null` for external URLs, fragment-only links,
 *  root-absolute paths, and anything that climbs above the view root. */
export function resolveRelative(fromFile: string, href: string): string | null {
  if (href === '' || href.startsWith('#') || href.startsWith('/') || isExternalUrl(href)) return null;
  let target = href.split(/[?#]/, 1)[0] ?? '';
  try {
    target = decodeURIComponent(target);
  } catch { /* keep the raw form */ }
  if (target === '') return null;

  const out = dirname(fromFile).split('/').filter(Boolean);
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(segment);
    }
  }
  return out.length === 0 ? null : out.join('/');
}

/** Absolute path of a view-relative path, in the root's own separator style
 *  (a Windows root like `C:\repo` yields backslashes). */
export function absolutePath(root: string, relPath: string): string {
  if (relPath === '') return root;
  const windows = root.includes('\\') && !root.includes('/');
  const sep = windows ? '\\' : '/';
  const rel = windows ? relPath.replace(/\//g, '\\') : relPath;
  return root.endsWith(sep) ? root + rel : root + sep + rel;
}
