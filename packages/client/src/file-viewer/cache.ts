// Per-view cache of VIEWER_FILE payloads, bounded by content size so a folder
// of large images cannot pin unbounded memory in the WebView. Pure.

import type { ViewerFilePayload } from './types.ts';

/** About 48 MB of `content` characters (base64 images dominate). */
export const VIEWER_CACHE_MAX_CHARS = 48 * 1024 * 1024;

export class ViewerFileCache {
  private files = new Map<string, ViewerFilePayload>();
  private chars = 0;
  private maxChars: number;

  constructor(maxChars: number = VIEWER_CACHE_MAX_CHARS) {
    this.maxChars = maxChars;
  }

  get(path: string): ViewerFilePayload | undefined {
    return this.files.get(path);
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  get size(): number {
    return this.files.size;
  }

  /** Insert or replace, then evict least-recently-inserted entries until under
   *  the cap. The entry just inserted is never evicted, even if it alone is over. */
  set(file: ViewerFilePayload): void {
    this.remove(file.path);
    this.files.set(file.path, file);
    this.chars += file.content?.length ?? 0;
    for (const [path, entry] of this.files) {
      if (this.chars <= this.maxChars || path === file.path) break;
      this.files.delete(path);
      this.chars -= entry.content?.length ?? 0;
    }
  }

  clear(): void {
    this.files.clear();
    this.chars = 0;
  }

  private remove(path: string): void {
    const existing = this.files.get(path);
    if (!existing) return;
    this.files.delete(path);
    this.chars -= existing.content?.length ?? 0;
  }
}
