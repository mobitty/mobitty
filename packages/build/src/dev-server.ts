import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import concurrently from 'concurrently';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..', '..');
const initCwd = process.env['INIT_CWD'] ?? process.cwd();
const nodemonBin = resolve(__dirname, '..', 'node_modules', '.bin', 'nodemon');

// Dev-server flags (for Vite): --port, --interface, --tls-cert, --tls-key, --tls-ca (long form only).
// All other flags pass through to the WS server (e.g. -p, -l).
// The WS server always binds to 127.0.0.1 — Vite proxies to it.
const argv = process.argv.slice(2);
let vitePort: string | undefined;
let iface = '127.0.0.1';
let tlsCert: string | undefined;
let tlsKey: string | undefined;
let tlsCa: string | undefined;
const serverArgs: string[] = [];

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!;
  if (arg === '--port') {
    vitePort = argv[++i];
  } else if (arg.startsWith('--port=')) {
    vitePort = arg.slice(7);
  } else if (arg === '--interface') {
    iface = argv[++i] ?? iface;
  } else if (arg.startsWith('--interface=')) {
    iface = arg.slice(12);
  } else if (arg === '--tls-cert') {
    tlsCert = argv[++i];
  } else if (arg.startsWith('--tls-cert=')) {
    tlsCert = arg.slice(11);
  } else if (arg === '--tls-key') {
    tlsKey = argv[++i];
  } else if (arg.startsWith('--tls-key=')) {
    tlsKey = arg.slice(10);
  } else if (arg === '--tls-ca') {
    tlsCa = argv[++i];
  } else if (arg.startsWith('--tls-ca=')) {
    tlsCa = arg.slice(9);
  } else {
    serverArgs.push(arg);
  }
}

if (!vitePort) {
  console.error('Error: --port is required (Vite dev server port)');
  process.exit(1);
}

// Extract server port from pass-through args, or default to vitePort + 1.
let serverPort: string | undefined;
for (let i = 0; i < serverArgs.length; i++) {
  if (serverArgs[i] === '-p' && i + 1 < serverArgs.length) {
    serverPort = serverArgs[i + 1]!;
  }
}
if (!serverPort) {
  serverPort = String(Number(vitePort) + 1);
  serverArgs.push('-p', serverPort);
}

mkdirSync(resolve(rootDir, 'logs'), { recursive: true });
const logFile = createWriteStream(resolve(rootDir, 'logs', 'dev-server.txt'));
const tee = new Writable({
  write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    process.stdout.write(chunk, encoding);
    logFile.write(chunk, encoding, callback);
  },
});

// Server always binds to localhost; append -i 127.0.0.1 last to enforce it.
const serverExec = ['node', resolve(rootDir, 'packages/server/src/main.ts'), ...serverArgs, '-i', '127.0.0.1']
  .map((a) => (/\s/.test(a) ? `'${a}'` : a))
  .join(' ');

const { commands, result } = concurrently(
  [
    {
      command: `${nodemonBin} --watch "${resolve(rootDir, 'packages/server/src')}" --ext ts --exec "${serverExec}"`,
      name: 'server',
      prefixColor: 'blue',
    },
    {
      command: `pnpm exec vite --host ${iface} --port ${vitePort}`,
      name: 'client',
      prefixColor: 'green',
      cwd: resolve(rootDir, 'packages/client'),
      env: {
        ...process.env,
        MOBITTY_SERVER_PORT: serverPort,
        ...(tlsCert !== undefined ? { MOBITTY_TLS_CERT: resolve(initCwd, tlsCert) } : {}),
        ...(tlsKey !== undefined ? { MOBITTY_TLS_KEY: resolve(initCwd, tlsKey) } : {}),
        ...(tlsCa !== undefined ? { MOBITTY_TLS_CA: resolve(initCwd, tlsCa) } : {}),
      },
    },
  ],
  {
    killOthers: ['failure', 'success'],
    outputStream: tee,
  },
);

for (const cmd of commands) {
  cmd.stateChange.subscribe((state) => {
    if (state === 'started' && cmd.pid !== undefined) {
      const msg = `[dev-server] ${cmd.name} PID: ${cmd.pid}\n`;
      process.stdout.write(msg);
      logFile.write(msg);
    }
  });
}

process.on('exit', () => logFile.close());

result.catch(() => process.exit(1));
