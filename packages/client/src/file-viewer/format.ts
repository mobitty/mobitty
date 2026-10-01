// Formatting for the viewer's meta strip and mobile rows. Pure.

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Coarse "Modified …" phrasing: `just now`, `5 min ago`, `2 hours ago`,
 *  `3 days ago`, then a calendar date. */
export function formatRelativeTime(mtimeMs: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - mtimeMs) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(mtimeMs).toLocaleDateString();
}
