#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import type { ServerConfig } from './types.ts';
import { startServer } from './server.ts';
import { createLogger } from './logger.ts';
import { loadConfig, ConfigError } from './settings.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  allowPositionals: false,
  options: {
    port: { type: 'string', short: 'p' },
    interface: { type: 'string', short: 'i' },
    'log-level': { type: 'string', short: 'l' },
    'file-log-level': { type: 'string' },
    'log-rotation-interval': { type: 'string' },
    'log-retention': { type: 'string' },
    'tls-cert': { type: 'string' },
    'tls-key': { type: 'string' },
    'tls-ca': { type: 'string' },
    'no-tls': { type: 'boolean', default: false },
    'max-payload': { type: 'string' },
    'max-connections': { type: 'string' },
    'max-sessions': { type: 'string' },
    'start-dir': { type: 'string' },
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
    -l, --log-level         Console log level: debug|info|warn|error (default: warn)
        --file-log-level    File log level: debug|info|warn|error (default: info)
        --log-rotation-interval  Log file rotation interval (default: 24h)
        --log-retention     Log file retention period (default: 7d)
        --tls-cert          Path to TLS certificate file (PEM)
        --tls-key           Path to TLS private key file (PEM)
        --tls-ca            Path to TLS CA chain file (PEM, optional)
        --no-tls            Disable TLS even if cert/key are set in settings.ini
        --max-payload       Maximum WebSocket payload in MB (default: 50)
        --max-connections   Maximum concurrent WebSocket connections (default: 100, 0 = unlimited)
        --max-sessions      Maximum concurrent terminal sessions (default: 50, 0 = unlimited)
        --start-dir         Default starting directory for new shells (default: server cwd)
    -v, --version           Print version and exit
    -h, --help              Print this help and exit

ENVIRONMENT:
    MOBITTY_DATA_FOLDER      Data folder path (default: ~/.mobitty)

Persistent defaults are stored in MOBITTY_DATA_FOLDER/settings.ini.
Shells are auto-discovered and can be managed via the web UI.`);
  process.exit(0);
}

if (values.version) {
  console.log(`mobitty version ${pkg.version}`);
  process.exit(0);
}

const dataFolder = process.env['MOBITTY_DATA_FOLDER'] ?? join(homedir(), '.mobitty');

let resolved;
try {
  resolved = loadConfig(dataFolder, {
    port: values.port,
    interface: values.interface,
    'log-level': values['log-level'],
    'file-log-level': values['file-log-level'],
    'log-rotation-interval': values['log-rotation-interval'],
    'log-retention': values['log-retention'],
    'tls-cert': values['tls-cert'],
    'tls-key': values['tls-key'],
    'tls-ca': values['tls-ca'],
    'no-tls': values['no-tls'],
    'max-payload': values['max-payload'],
    'max-connections': values['max-connections'],
    'max-sessions': values['max-sessions'],
    'start-dir': values['start-dir'],
  });
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`mobitty: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const logger = createLogger({
  consoleLevel: resolved.consoleLogLevel,
  fileLevel: resolved.fileLogLevel,
  dataFolder,
  rotationMs: resolved.logRotationMs,
  retentionMs: resolved.logRetentionMs,
});

const isWindows = process.platform === 'win32';

let effectiveStartDir = resolved.startDir;
if (effectiveStartDir !== process.cwd()) {
  try {
    if (!existsSync(effectiveStartDir) || !statSync(effectiveStartDir).isDirectory()) {
      logger.warn('configured start-dir is not a directory; falling back to server cwd', { startDir: resolved.startDir });
      effectiveStartDir = process.cwd();
    }
  } catch (err) {
    logger.warn('cannot stat configured start-dir; falling back to server cwd', {
      startDir: resolved.startDir,
      error: err instanceof Error ? err.message : String(err),
    });
    effectiveStartDir = process.cwd();
  }
}

const config: ServerConfig = {
  port: resolved.port,
  host: resolved.host,
  terminalType: 'xterm-256color',
  prefsJson: JSON.stringify(isWindows ? { isWindows: true } : {}),
  dataFolder,
  startDir: effectiveStartDir,
  maxPayloadBytes: resolved.maxPayloadBytes,
  maxConnections: resolved.maxConnections,
  maxSessions: resolved.maxSessions,
  tls: resolved.tls,
};

startServer(config, logger);
