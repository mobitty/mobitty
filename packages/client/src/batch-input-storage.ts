const STORAGE_KEY = 'mobitty-batch-input';

export function getBatchInputDraft(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setBatchInputDraft(text: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    // localStorage may be unavailable
  }
}

export function clearBatchInputDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage may be unavailable
  }
}
