import { exec } from 'node:child_process';

export function openUri(url: string): void {
  const platform = process.platform;
  let cmd: string;
  if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, (err) => {
    if (err) console.error(`[mobitty] failed to open browser: ${err.message}`);
  });
}
