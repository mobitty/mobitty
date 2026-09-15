// Recoverable history of full-screen editor contents.
//
// The per-keystroke draft in `remote-editor-storage.ts` is keyed by file path,
// and Claude Code's Ctrl+G allocates a fresh UUID temp path per invocation — so
// that key never recurs and everything typed died on Save/Cancel. This module is
// the path-independent ring the editor commits to instead, so a previous draft
// can always be brought back and is dropped only when the user deletes it.
//
// See docs/done-design-remote-editor.md.

const STORAGE_KEY = 'mobitty-editor-history';
const SCHEMA_VERSION = 1;

const MAX_ENTRIES = 20;
const MAX_ENTRY_BYTES = 256_000;
const MAX_TOTAL_BYTES = 1_500_000;

export type EditorHistoryOutcome = 'saved' | 'cancelled';

export interface EditorHistoryEntry {
  id: string;
  text: string;
  /** Epoch ms. */
  savedAt: number;
  /** basename(filePath), for display only. */
  fileName: string;
  /** Session title || name at capture time; '' when unknown. */
  sessionLabel: string;
  outcome: EditorHistoryOutcome;
}

interface StoredShape {
  v: number;
  entries: EditorHistoryEntry[];
}

// `crypto.randomUUID` is secure-context-only and mobitty is routinely served
// over plain HTTP on a LAN, so roll our own — these ids only need to be unique
// within one localStorage ring.
let idCounter = 0;
function makeId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isEntry(value: unknown): value is EditorHistoryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return typeof e.id === 'string'
    && typeof e.text === 'string'
    && typeof e.savedAt === 'number'
    && typeof e.fileName === 'string'
    && typeof e.sessionLabel === 'string'
    && (e.outcome === 'saved' || e.outcome === 'cancelled');
}

/** Newest first. A corrupt or foreign-version payload reads as empty rather
 *  than throwing — a broken ring must not take the editor down with it. */
export function listEditorHistory(): EditorHistoryEntry[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as StoredShape;
    if (typeof parsed !== 'object' || parsed === null) return [];
    if (parsed.v !== SCHEMA_VERSION) return [];
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(isEntry).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** Drop oldest entries until the ring fits both the count and byte caps. */
function trim(entries: EditorHistoryEntry[]): EditorHistoryEntry[] {
  let kept = entries.slice(0, MAX_ENTRIES);
  while (kept.length > 1 && JSON.stringify({ v: SCHEMA_VERSION, entries: kept }).length > MAX_TOTAL_BYTES) {
    kept = kept.slice(0, kept.length - 1);
  }
  return kept;
}

/** Newest-first `entries`; retries once with half the ring if the quota bites. */
function write(entries: EditorHistoryEntry[]): void {
  const attempt = (list: EditorHistoryEntry[]): boolean => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: SCHEMA_VERSION, entries: list }));
      return true;
    } catch {
      return false;
    }
  };
  const trimmed = trim(entries);
  if (attempt(trimmed)) return;
  // Quota exceeded (or another tab filled the store) — shed the oldest half and
  // try once more. Still failing means localStorage is unusable; stay silent,
  // matching the other storage modules.
  attempt(trimmed.slice(0, Math.max(1, Math.floor(trimmed.length / 2))));
}

export interface PushEditorHistoryInput {
  text: string;
  fileName: string;
  sessionLabel: string;
  outcome: EditorHistoryOutcome;
  /** Server-supplied original. Text identical to it means the user opened and
   *  left without typing — nothing worth keeping. */
  baseline?: string;
}

/** Returns true when an entry was recorded. */
export function pushEditorHistory(input: PushEditorHistoryInput): boolean {
  const { text, fileName, sessionLabel, outcome, baseline } = input;
  if (text.trim() === '') return false;
  if (baseline !== undefined && text === baseline) return false;
  if (text.length > MAX_ENTRY_BYTES) return false;

  const entries = listEditorHistory();
  const newest = entries[0];
  if (newest !== undefined && newest.text === text) {
    // Same content as last time (e.g. Cancel right after a restore) — refresh
    // the existing entry instead of stacking duplicates.
    write([{ ...newest, savedAt: Date.now(), fileName, sessionLabel, outcome }, ...entries.slice(1)]);
    return true;
  }

  write([{ id: makeId(), text, savedAt: Date.now(), fileName, sessionLabel, outcome }, ...entries]);
  return true;
}

export function deleteEditorHistoryEntry(id: string): void {
  write(listEditorHistory().filter(e => e.id !== id));
}

export function clearEditorHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage may be unavailable
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Coarse "2 min ago" style label; `now` is injectable for tests. */
export function formatRelativeTime(savedAt: number, now: number = Date.now()): string {
  const delta = now - savedAt;
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} min ago`;
  if (delta < DAY) {
    const hours = Math.floor(delta / HOUR);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  const days = Math.floor(delta / DAY);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
