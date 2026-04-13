import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { LogLevel, TlsConfig } from './types.ts';
import { isLogLevel } from './types.ts';

// ── INI parser ───────────────────────────────────────────────────────────────

/** Parse a simple INI file into section → key → value map.
 *  Handles # and ; comments, [section] headers, key = value (split on first =).
 *  Keys before any section header are ignored. */
export function parseIni(text: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  let section: string | null = null;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line[0] === '#' || line[0] === ';') continue;

    const sectionMatch = /^\[([a-zA-Z0-9_-]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1]!;
      result[section] ??= {};
      continue;
    }

    if (section === null) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    const value = line.slice(eqIdx + 1).trim();
    if (key !== '') result[section]![key] = value;
  }

  return result;
}

// ── Default settings.ini template ────────────────────────────────────────────

export function generateDefaultIni(): string {
  return `# Mobitty server configuration
# CLI arguments take precedence over these settings.

[server]
# Port to listen on (1-65535)
port = 8000

# Network interface to bind
interface = 127.0.0.1

[logging]
# Console log level: debug | info | warn | error
console-level = warn

# File (JSONL) log level: debug | info | warn | error
file-level = info

# Log file rotation interval (e.g., 1h, 24h, 7d)
rotation-interval = 24h

# Log file retention period (e.g., 7d, 30d)
retention = 7d

[tls]
# Paths are resolved relative to this file's directory.
# Path to TLS certificate file (PEM)
# cert =

# Path to TLS private key file (PEM)
# key =

# Path to TLS CA chain file (PEM, optional)
# ca =
`;
}

// ── Config types ─────────────────────────────────────────────────────────────

/** CLI arguments passed from parseArgs — all optional strings. */
export interface CliArgs {
  port?: string;
  interface?: string;
  'log-level'?: string;
  'file-log-level'?: string;
  'log-rotation-interval'?: string;
  'log-retention'?: string;
  'tls-cert'?: string;
  'tls-key'?: string;
  'tls-ca'?: string;
}

/** Fully validated, ready-to-use configuration. */
export interface ResolvedConfig {
  port: number;
  host: string;
  consoleLogLevel: LogLevel;
  fileLogLevel: LogLevel;
  logRotationMs: number;
  logRetentionMs: number;
  dataFolder: string;
  tls?: TlsConfig;
}

// ── Config loader ────────────────────────────────────────────────────────────

/** Load, merge, and validate configuration.
 *  Precedence: hardcoded defaults → settings.ini → CLI args.
 *  Creates settings.ini with defaults on first run. */
export function loadConfig(dataFolder: string, cli: CliArgs): ResolvedConfig {
  mkdirSync(dataFolder, { recursive: true });

  const iniPath = join(dataFolder, 'settings.ini');
  let ini: Record<string, Record<string, string>> = {};

  if (existsSync(iniPath)) {
    ini = parseIni(readFileSync(iniPath, 'utf-8'));
  } else {
    writeFileSync(iniPath, generateDefaultIni());
  }

  const server = ini['server'] ?? {};
  const logging = ini['logging'] ?? {};
  const tls = ini['tls'] ?? {};

  // ── Port ──

  const portStr = cli.port ?? nonEmpty(server['port']) ?? '8000';
  const port = parseInt(portStr, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new ConfigError(`invalid port: ${portStr}`);
  }

  // ── Host ──

  const host = cli.interface ?? nonEmpty(server['interface']) ?? '127.0.0.1';

  // ── Log levels ──

  const consoleLogLevel = validateLogLevel(
    cli['log-level'] ?? nonEmpty(logging['console-level']) ?? 'warn',
    'console log level',
  );
  const fileLogLevel = validateLogLevel(
    cli['file-log-level'] ?? nonEmpty(logging['file-level']) ?? 'info',
    'file log level',
  );

  // ── Log rotation / retention ──

  const logRotationMs = parseDuration(
    cli['log-rotation-interval'] ?? nonEmpty(logging['rotation-interval']) ?? '24h',
    'log rotation interval',
  );
  const logRetentionMs = parseDuration(
    cli['log-retention'] ?? nonEmpty(logging['retention']) ?? '7d',
    'log retention',
  );

  // ── TLS ──
  // INI paths resolve relative to dataFolder; CLI paths resolve relative to cwd.

  const tlsCertPath = cli['tls-cert'] ?? nonEmpty(tls['cert']);
  const tlsKeyPath = cli['tls-key'] ?? nonEmpty(tls['key']);
  const tlsCaPath = cli['tls-ca'] ?? nonEmpty(tls['ca']);

  let tlsConfig: TlsConfig | undefined;
  if (tlsCertPath !== undefined || tlsKeyPath !== undefined) {
    if (tlsCertPath === undefined || tlsKeyPath === undefined) {
      throw new ConfigError('tls-cert and tls-key must both be provided');
    }

    const certResolved = cli['tls-cert'] ? resolve(cli['tls-cert']) : resolve(dataFolder, tlsCertPath);
    const keyResolved = cli['tls-key'] ? resolve(cli['tls-key']) : resolve(dataFolder, tlsKeyPath);

    let cert: string;
    try {
      cert = readFileSync(certResolved, 'utf-8');
    } catch {
      throw new ConfigError(`cannot read TLS certificate: ${certResolved}`);
    }

    let key: string;
    try {
      key = readFileSync(keyResolved, 'utf-8');
    } catch {
      throw new ConfigError(`cannot read TLS private key: ${keyResolved}`);
    }

    let ca: string | undefined;
    if (tlsCaPath !== undefined) {
      const caResolved = cli['tls-ca'] ? resolve(cli['tls-ca']) : resolve(dataFolder, tlsCaPath);
      try {
        ca = readFileSync(caResolved, 'utf-8');
      } catch {
        throw new ConfigError(`cannot read TLS CA file: ${caResolved}`);
      }
    }

    tlsConfig = { cert, key, ca };
  }

  return { port, host, consoleLogLevel, fileLogLevel, logRotationMs, logRetentionMs, dataFolder, tls: tlsConfig };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Treat empty strings as absent. */
function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined;
}

function validateLogLevel(value: string, label: string): LogLevel {
  if (!isLogLevel(value)) {
    throw new ConfigError(`invalid ${label}: ${value} (must be debug|info|warn|error)`);
  }
  return value;
}

const DURATION_UNITS: Record<string, number> = { h: 3600000, d: 86400000 };

export function parseDuration(value: string, label: string): number {
  const match = /^(\d+)(h|d)$/.exec(value);
  if (!match) {
    throw new ConfigError(`invalid ${label}: ${value} (e.g., 1h, 24h, 7d)`);
  }
  const n = parseInt(match[1]!, 10);
  if (n < 1) {
    throw new ConfigError(`invalid ${label}: ${value} (must be >= 1)`);
  }
  return n * DURATION_UNITS[match[2]!]!;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
