#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { ServerConfig, TlsConfig } from './types.ts';
import { isLogLevel } from './types.ts';
import { startServer } from './server.ts';
import { createLogger } from './logger.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  allowPositionals: false,
  options: {
    port: { type: 'string', short: 'p', default: '8000' },
    interface: { type: 'string', short: 'i', default: '127.0.0.1' },
    'log-level': { type: 'string', short: 'l', default: 'info' },
    'tls-cert': { type: 'string' },
    'tls-key': { type: 'string' },
    'tls-ca': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false },
  },
});

const pkg: { version: string } = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'),
);

if (values.help) {
  console.log(`mobitty - Share your terminal over the web

USAGE:
    mobitty [options]

OPTIONS:
    -p, --port              Port to listen (default: 8000)
    -i, --interface         Network interface to bind (default: 127.0.0.1)
    -l, --log-level         Console log level: debug|info|warn|error (default: info)
        --tls-cert          Path to TLS certificate file (PEM)
        --tls-key           Path to TLS private key file (PEM)
        --tls-ca            Path to TLS CA chain file (PEM, optional)
    -v, --version           Print version and exit
    -h, --help              Print this help and exit

ENVIRONMENT:
    MOBITTY_DATA_FOLDER      Data folder path (default: ~/.mobitty)

Shells are auto-discovered and can be managed via the web UI.`);
  process.exit(0);
}

if (values.version) {
  console.log(`mobitty version ${pkg.version}`);
  process.exit(0);
}

const port = parseInt(values.port ?? '8000', 10);
if (!Number.isFinite(port) || port < 0 || port > 65535) {
  console.error(`mobitty: invalid port: ${values.port}`);
  process.exit(1);
}

const logLevel = values['log-level'] ?? 'info';
if (!isLogLevel(logLevel)) {
  console.error(`mobitty: invalid log-level: ${logLevel} (must be debug|info|warn|error)`);
  process.exit(1);
}

let tls: TlsConfig | undefined;
const tlsCert = values['tls-cert'];
const tlsKey = values['tls-key'];
if (tlsCert !== undefined || tlsKey !== undefined) {
  if (tlsCert === undefined || tlsKey === undefined) {
    console.error('mobitty: --tls-cert and --tls-key must both be provided');
    process.exit(1);
  }
  let cert: string;
  let key: string;
  try {
    cert = readFileSync(resolve(tlsCert), 'utf-8');
  } catch {
    console.error(`mobitty: cannot read TLS certificate: ${tlsCert}`);
    process.exit(1);
  }
  try {
    key = readFileSync(resolve(tlsKey), 'utf-8');
  } catch {
    console.error(`mobitty: cannot read TLS private key: ${tlsKey}`);
    process.exit(1);
  }
  const tlsCa = values['tls-ca'];
  let ca: string | undefined;
  if (tlsCa !== undefined) {
    try {
      ca = readFileSync(resolve(tlsCa), 'utf-8');
    } catch {
      console.error(`mobitty: cannot read TLS CA file: ${tlsCa}`);
      process.exit(1);
    }
  }
  tls = { cert, key, ca };
}

const dataFolder = process.env['MOBITTY_DATA_FOLDER'] ?? join(homedir(), '.mobitty');
const logger = createLogger(logLevel, 'debug', dataFolder);

const isWindows = process.platform === 'win32';

const config: ServerConfig = {
  port,
  host: values.interface ?? '127.0.0.1',
  terminalType: 'xterm-256color',
  prefsJson: JSON.stringify(isWindows ? { isWindows: true } : {}),
  dataFolder,
  tls,
};

startServer(config, logger);
