const STORAGE_PREFIX = 'mobitty-remote-editor:';
// Skip persist for huge drafts to avoid evicting other localStorage entries.
const MAX_DRAFT_BYTES = 1_000_000;

/** Stored draft record. Written as JSON so a draft can be aged out; a bare
 *  string is the pre-timestamp format and still reads back (see
 *  `takeStaleRemoteEditorDrafts`). */
interface DraftRecord {
  /** Epoch ms of the last keystroke. */
  t: number;
  s: string;
}

function parseRecord(raw: string): DraftRecord | null {
  try {
    const parsed = JSON.parse(raw) as DraftRecord;
    if (typeof parsed === 'object' && parsed !== null
      && typeof parsed.t === 'number' && typeof parsed.s === 'string') {
      return parsed;
    }
  } catch {
    // Not JSON — legacy bare-string draft.
  }
  return null;
}

export function getRemoteEditorDraft(filePath: string): string | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_PREFIX + filePath);
  } catch {
    return null;
  }
  if (raw === null) return null;
  return parseRecord(raw)?.s ?? raw;
}

export function setRemoteEditorDraft(filePath: string, text: string): void {
  if (text.length > MAX_DRAFT_BYTES) return;
  try {
    const record: DraftRecord = { t: Date.now(), s: text };
    localStorage.setItem(STORAGE_PREFIX + filePath, JSON.stringify(record));
  } catch {
    // localStorage may be unavailable
  }
}

export function clearRemoteEditorDraft(filePath: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + filePath);
  } catch {
    // localStorage may be unavailable
  }
}

export interface StaleDraft {
  filePath: string;
  text: string;
}

/** Remove and return every draft older than `maxAgeMs`.
 *
 *  Claude Code's Ctrl+G uses a fresh UUID temp path per invocation, so a draft
 *  whose edit never reached Save or Cancel strands a key that nothing will ever
 *  read again. The caller hands what comes back to the editor history ring, so
 *  the content becomes recoverable instead of invisible garbage.
 *
 *  A legacy bare-string draft has no timestamp; it was written by a build that
 *  predates this sweep, so it counts as stale. */
export function takeStaleRemoteEditorDrafts(maxAgeMs: number): StaleDraft[] {
  const stale: StaleDraft[] = [];
  const cutoff = Date.now() - maxAgeMs;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      const record = parseRecord(raw);
      if (record !== null && record.t > cutoff) continue;
      stale.push({ filePath: key.slice(STORAGE_PREFIX.length), text: record?.s ?? raw });
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage may be unavailable
  }
  return stale;
}
