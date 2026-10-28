// File viewer: tree listing and confined reads for `mobitty-cli view`.
// See docs/todo-design-file-viewer.md.
//
// The server does the reading (not the blocked CLI): any client that can send
// VIEWER_REQUEST already drives a shell in the same session, so relaying reads
// through the CLI would buy no security. Confinement to `root` is a scoping
// rule — it keeps the viewer on the folder the user named.

import { execFile } from 'node:child_process';
import { open, lstat, readdir, readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { IMAGE_EXTENSIONS } from './cli-shared.ts';
import type { ViewKind } from './types.ts';

export const MAX_VIEW_ENTRIES = 20_000;
export const MAX_VIEW_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_VIEW_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIEW_AUDIO_BYTES = 16 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8192;
const GIT_TIMEOUT_MS = 10_000;
const WALK_SKIP_DIRS = new Set(['.git', 'node_modules']);

/** Extensions previewed with an `<audio>` player. Whether the browser can
 *  decode one (e.g. Ogg in older Safari) is the client's to report. */
export const AUDIO_EXTENSIONS: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.weba': 'audio/webm',
};

/** `[relPath, size]` — POSIX-separated, relative to the view root. Files only. */
export type ViewEntry = [string, number];

export interface ViewListing {
  entries: ViewEntry[];
  truncated: boolean;
}

export type ViewFileKind = 'text' | 'image' | 'audio' | 'binary' | 'too-large' | 'error';

export interface ViewFile {
  path: string;
  kind: ViewFileKind;
  size: number;
  mtimeMs: number;
  content?: string;
  contentType?: string;
  error?: string;
}

/** Resolve `relPath` against `root`, or `null` if it escapes `root`. */
export function resolveInRoot(root: string, relPath: string): string | null {
  if (relPath === '' || isAbsolute(relPath)) return null;
  const rel = normalize(relPath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  const abs = resolve(root, rel);
  const back = relative(root, abs);
  if (back === '' || back.startsWith('..') || isAbsolute(back)) return null;
  return abs;
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

/** True when `root` is itself gitignored. `ls-files --exclude-standard` then
 *  lists nothing, yet the user asked for this folder by name — walk it. */
function gitIgnoresRoot(root: string): Promise<boolean> {
  return new Promise(resolvePromise => {
    execFile('git', ['check-ignore', '-q', '.'], { cwd: root, timeout: GIT_TIMEOUT_MS }, err => {
      // Exit 0 = ignored; 1 = not ignored; 128 = not a work tree.
      resolvePromise(err === null);
    });
  });
}

function gitLsFiles(root: string): Promise<string[] | null> {
  return new Promise(resolvePromise => {
    execFile(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: root, timeout: GIT_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024 },
      (err, stdout) => {
        // Not a work tree, git missing, or timed out — fall back to the walk.
        if (err) { resolvePromise(null); return; }
        resolvePromise(stdout.split('\0').filter(p => p !== ''));
      },
    );
  });
}

async function listFromGit(root: string, paths: string[]): Promise<ViewListing> {
  const entries: ViewEntry[] = [];
  // `--cached` and `--others` can both name a path (e.g. during a merge).
  const seen = new Set<string>();
  for (const p of paths) {
    if (entries.length >= MAX_VIEW_ENTRIES) return { entries, truncated: true };
    if (seen.has(p)) continue;
    seen.add(p);
    try {
      const st = await lstat(join(root, p));
      if (st.isDirectory()) continue; // submodule gitlink
      entries.push([p, st.size]);
    } catch {
      // Tracked but deleted from the work tree.
    }
  }
  return { entries, truncated: false };
}

async function listByWalk(root: string): Promise<ViewListing> {
  const entries: ViewEntry[] = [];
  const queue: string[] = [''];
  while (queue.length > 0) {
    const dirRel = queue.shift()!;
    let dirents;
    try {
      dirents = await readdir(join(root, dirRel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirents) {
      const rel = dirRel === '' ? d.name : `${dirRel}/${d.name}`;
      // Dirent types come from lstat semantics: a symlinked directory is a
      // symlink, not a directory, so it is never descended into (no cycles).
      if (d.isDirectory()) {
        if (!WALK_SKIP_DIRS.has(d.name)) queue.push(rel);
        continue;
      }
      if (d.isSymbolicLink()) {
        try {
          const st = await stat(join(root, rel));
          if (!st.isFile()) continue;
          if (entries.length >= MAX_VIEW_ENTRIES) return { entries, truncated: true };
          entries.push([rel, st.size]);
        } catch { /* dangling link */ }
        continue;
      }
      if (!d.isFile()) continue;
      if (entries.length >= MAX_VIEW_ENTRIES) return { entries, truncated: true };
      try {
        const st = await lstat(join(root, rel));
        entries.push([rel, st.size]);
      } catch { /* vanished mid-walk */ }
    }
  }
  return { entries, truncated: false };
}

/** List the files under `root`. Inside a git work tree this honours
 *  `.gitignore`; elsewhere — or when `root` itself is ignored — it walks,
 *  skipping `.git` and `node_modules`. */
export async function listViewTree(root: string): Promise<ViewListing> {
  const gitPaths = (await gitIgnoresRoot(root)) ? null : await gitLsFiles(root);
  if (gitPaths !== null) {
    return listFromGit(root, gitPaths.map(p => toPosix(p)));
  }
  return listByWalk(root);
}

async function sniffBinary(absPath: string): Promise<boolean> {
  const fh = await open(absPath, 'r');
  try {
    const buf = Buffer.alloc(BINARY_SNIFF_BYTES);
    const { bytesRead } = await fh.read(buf, 0, BINARY_SNIFF_BYTES, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await fh.close();
  }
}

/** Classify what `mobitty-cli view` asked for, so the server can tell
 *  whether the attached client can show it. Same rules as `readViewFile`:
 *  extension first, then a binary sniff; text over MAX_VIEW_TEXT_BYTES is
 *  `large-text`. A file that can't be sniffed counts as text, so the client
 *  shows the read error rather than the view waiting for another client. */
export async function classifyViewTarget(absPath: string, isDir: boolean, size: number): Promise<ViewKind> {
  if (isDir) return 'folder';
  const ext = extname(absPath).toLowerCase();
  if (IMAGE_EXTENSIONS[ext]) return 'image';
  if (AUDIO_EXTENSIONS[ext]) return 'audio';
  try {
    if (await sniffBinary(absPath)) return 'binary';
  } catch { /* unreadable — readViewFile reports it */ }
  return size > MAX_VIEW_TEXT_BYTES ? 'large-text' : 'text';
}

/** Read one file for the viewer. Never throws — failures come back as
 *  `kind: 'error'` so the client can show them in the preview. */
export async function readViewFile(root: string, relPath: string): Promise<ViewFile> {
  const base = { path: relPath, size: 0, mtimeMs: 0 };
  const abs = resolveInRoot(root, relPath);
  if (abs === null) return { ...base, kind: 'error', error: 'Path is outside the viewed folder' };

  let st;
  try {
    st = await stat(abs);
  } catch {
    return { ...base, kind: 'error', error: 'File not found' };
  }
  if (!st.isFile()) return { ...base, kind: 'error', error: 'Not a regular file' };
  const meta = { path: relPath, size: st.size, mtimeMs: st.mtimeMs };

  try {
    const ext = extname(abs).toLowerCase();
    const imageType = IMAGE_EXTENSIONS[ext];
    if (imageType) {
      if (st.size > MAX_VIEW_IMAGE_BYTES) return { ...meta, kind: 'too-large' };
      const buf = await readFile(abs);
      return { ...meta, kind: 'image', content: buf.toString('base64'), contentType: imageType };
    }
    const audioType = AUDIO_EXTENSIONS[ext];
    if (audioType) {
      if (st.size > MAX_VIEW_AUDIO_BYTES) return { ...meta, kind: 'too-large' };
      const buf = await readFile(abs);
      return { ...meta, kind: 'audio', content: buf.toString('base64'), contentType: audioType };
    }
    if (st.size > MAX_VIEW_TEXT_BYTES) return { ...meta, kind: 'too-large' };
    if (await sniffBinary(abs)) return { ...meta, kind: 'binary' };
    return { ...meta, kind: 'text', content: await readFile(abs, 'utf-8') };
  } catch (err) {
    return { ...meta, kind: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}
