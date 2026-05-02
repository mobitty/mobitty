const STORAGE_PREFIX = 'mobitty-remote-editor:';
// Skip persist for huge drafts to avoid evicting other localStorage entries.
const MAX_DRAFT_BYTES = 1_000_000;

export function getRemoteEditorDraft(filePath: string): string | null {
  try {
    return localStorage.getItem(STORAGE_PREFIX + filePath);
  } catch {
    return null;
  }
}

export function setRemoteEditorDraft(filePath: string, text: string): void {
  if (text.length > MAX_DRAFT_BYTES) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + filePath, text);
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
