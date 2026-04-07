import { writeFile, unlink, mkdir, rename } from 'node:fs/promises';
import { readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';

interface ClipboardWriteResult {
  success: boolean;
  error?: string;
}

export interface ImageWriteResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
]);

const MAX_IMAGE_SIZE = 25 * 1024 * 1024; // 25 MB

function mimeToExtension(mime: string): string {
  switch (mime) {
    case 'image/png': return '.png';
    case 'image/jpeg': return '.jpeg';
    case 'image/gif': return '.gif';
    case 'image/webp': return '.webp';
    case 'image/bmp': return '.bmp';
    default: return '.png';
  }
}

function execFilePromise(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

function execFileWithStdin(command: string, args: string[], stdin: Buffer): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
    if (child.stdin) {
      child.stdin.on('error', () => {}); // handled by execFile callback
      child.stdin.write(stdin);
      child.stdin.end();
    } else {
      reject(new Error('Failed to write to stdin'));
    }
  });
}

async function writeClipboardWindows(tempPath: string): Promise<void> {
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('${tempPath.replace(/'/g, "''")}')
[System.Windows.Forms.Clipboard]::SetImage($img)
$img.Dispose()
`;
  await execFilePromise('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript]);
}

async function writeClipboardDarwin(tempPath: string, mime: string): Promise<void> {
  if (mime === 'image/png') {
    const script = `set the clipboard to (read (POSIX file "${tempPath}") as «class PNGf»)`;
    await execFilePromise('osascript', ['-e', script]);
  } else {
    // For non-PNG, use a general approach via NSPasteboard
    const script = `
use framework "AppKit"
set imageData to (current application's NSData's dataWithContentsOfFile:"${tempPath}")
set img to (current application's NSImage's alloc()'s initWithData:imageData)
set pb to current application's NSPasteboard's generalPasteboard()
pb's clearContents()
pb's writeObjects:{img}
`;
    await execFilePromise('osascript', ['-e', script]);
  }
}

async function writeClipboardLinux(tempPath: string, mime: string): Promise<void> {
  const imageData = await import('node:fs').then(fs => fs.readFileSync(tempPath));
  await execFileWithStdin('xclip', ['-selection', 'clipboard', '-t', mime, '-i'], imageData);
}

export async function writeImageToSystemClipboard(imageData: Buffer, mimeType: string): Promise<ClipboardWriteResult> {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return { success: false, error: `Unsupported MIME type: ${mimeType}` };
  }

  if (imageData.length === 0) {
    return { success: false, error: 'Empty image data' };
  }

  if (imageData.length > MAX_IMAGE_SIZE) {
    return { success: false, error: `Image too large: ${imageData.length} bytes (max ${MAX_IMAGE_SIZE})` };
  }

  const ext = mimeToExtension(mimeType);
  const tempPath = join(tmpdir(), `mobitty-clip-${randomBytes(8).toString('hex')}${ext}`);

  try {
    await writeFile(tempPath, imageData, { mode: 0o600 });

    const platform = process.platform;
    if (platform === 'win32') {
      await writeClipboardWindows(tempPath);
    } else if (platform === 'darwin') {
      await writeClipboardDarwin(tempPath, mimeType);
    } else {
      await writeClipboardLinux(tempPath, mimeType);
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  } finally {
    try { await unlink(tempPath); } catch { /* ignore cleanup error */ }
  }
}

export function getProcessCwd(pid: number): string {
  try {
    if (process.platform === 'linux') {
      return readlinkSync(`/proc/${pid}/cwd`);
    }
    if (process.platform === 'darwin') {
      const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'],
        { timeout: 3000, encoding: 'utf-8' });
      for (const line of out.split('\n')) {
        if (line.startsWith('n')) return line.slice(1);
      }
    }
  } catch { /* fall through */ }
  return process.cwd();
}

export async function writeImageToFile(
  imageData: Buffer,
  mimeType: string,
  dirPath: string,
): Promise<ImageWriteResult> {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return { success: false, error: `Unsupported MIME type: ${mimeType}` };
  }
  if (imageData.length === 0) {
    return { success: false, error: 'Empty image data' };
  }
  if (imageData.length > MAX_IMAGE_SIZE) {
    return { success: false, error: `Image too large: ${imageData.length} bytes (max ${MAX_IMAGE_SIZE})` };
  }

  const ext = mimeToExtension(mimeType);
  const filename = randomUUID() + ext;
  const filePath = join(dirPath, filename);
  const tmpPath = filePath + '.tmp';

  try {
    await mkdir(dirPath, { recursive: true });
    await writeFile(tmpPath, imageData, { mode: 0o644 });
    await rename(tmpPath, filePath);
    return { success: true, filePath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try { await unlink(tmpPath); } catch { /* ignore */ }
    return { success: false, error: msg };
  }
}

export { ALLOWED_MIME_TYPES, MAX_IMAGE_SIZE };
