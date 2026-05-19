import { writeFile, unlink, rename, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join, basename, extname } from 'node:path';

export const MAX_UPLOAD_SIZE = 25 * 1024 * 1024; // 25 MB — matches MAX_IMAGE_SIZE

export interface UploadWriteResult {
  success: boolean;
  savedName?: string;
  savedPath?: string;
  error?: string;
}

export function sanitizeFilename(name: string): string | null {
  const base = basename(name);
  const cleaned = Array.from(base)
    .filter(ch => {
      const code = ch.charCodeAt(0);
      if (code < 0x20 || code === 0x7f) return false;
      if (ch === '/' || ch === '\\') return false;
      return true;
    })
    .join('')
    .trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return null;
  if (Buffer.byteLength(cleaned, 'utf-8') > 255) return null;
  return cleaned;
}

export function shellQuoteForBash(name: string): string {
  if (/^[A-Za-z0-9._+\-=:,@%/]+$/.test(name)) return name;
  return `'${name.split(`'`).join(`'\\''`)}'`;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveAvailableName(dir: string, name: string): Promise<string | null> {
  if (!await pathExists(join(dir, name))) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; i <= 1000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!await pathExists(join(dir, candidate))) return candidate;
  }
  return null;
}

export async function writeUploadToCwd(
  data: Buffer,
  rawName: string,
  cwd: string,
): Promise<UploadWriteResult> {
  if (data.length === 0) return { success: false, error: 'Empty file' };
  if (data.length > MAX_UPLOAD_SIZE) {
    return { success: false, error: `File too large: ${data.length} bytes (max ${MAX_UPLOAD_SIZE})` };
  }
  const sanitized = sanitizeFilename(rawName);
  if (!sanitized) return { success: false, error: 'invalid-filename' };
  if (!cwd) return { success: false, error: 'cwd-unavailable' };

  const finalName = await resolveAvailableName(cwd, sanitized);
  if (!finalName) return { success: false, error: 'name-collision' };

  const finalPath = join(cwd, finalName);
  const tmpPath = finalPath + '.tmp';
  try {
    await writeFile(tmpPath, data, { mode: 0o644 });
    await rename(tmpPath, finalPath);
    return { success: true, savedName: finalName, savedPath: finalPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try { await unlink(tmpPath); } catch { /* ignore */ }
    return { success: false, error: msg };
  }
}
