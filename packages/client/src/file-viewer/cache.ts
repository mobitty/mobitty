// Cache of VIEWER_FILE payloads for every open view, keyed by view and path.
// One bound on content size across all views, so a folder of large images —
// or several queued views of them — cannot pin unbounded memory in the
// WebView. Pure.

import type { ViewerFilePayload } from './types.ts';

/** About 48 MB of `content` characters (base64 images dominate). */
export const VIEWER_CACHE_MAX_CHARS = 48 * 1024 * 1024;

export class ViewerFileCache {
  /** Keyed by `cacheKey(viewId, path)`; Map order is insertion order. */
  private files = new Map<string, ViewerFilePayload>();
  private chars = 0;
  private maxChars: number;

  constructor(maxChars: number = VIEWER_CACHE_MAX_CHARS) {
    this.maxChars = maxChars;
  }

  get(viewId: number, path: string): ViewerFilePayload | undefined {
    return this.files.get(cacheKey(viewId, path));
  }

  has(viewId: number, path: string): boolean {
    return this.files.has(cacheKey(viewId, path));
  }

  get size(): number {
    return this.files.size;
  }

  /** Insert or replace, then evict least-recently-inserted entries until under
   *  the cap. The entry just inserted is never evicted, even if it alone is over. */
  set(file: ViewerFilePayload): void {
    const key = cacheKey(file.viewId, file.path);
    this.remove(key);
    this.files.set(key, file);
    this.chars += file.content?.length ?? 0;
    for (const k of this.files.keys()) {
      if (this.chars <= this.maxChars || k === key) break;
      this.remove(k);
    }
  }

  /** Drop one view's files, when that view closes. */
  clearView(viewId: number): void {
    for (const [k, entry] of this.files) {
      if (entry.viewId === viewId) this.remove(k);
    }
  }

  private remove(key: string): void {
    const existing = this.files.get(key);
    if (!existing) return;
    this.files.delete(key);
    this.chars -= existing.content?.length ?? 0;
  }
}

function cacheKey(viewId: number, path: string): string {
  return `${viewId}\0${path}`;
}
