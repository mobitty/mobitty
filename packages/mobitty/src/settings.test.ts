import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseIni, generateDefaultIni, loadConfig, parseDuration, ConfigError } from './settings.ts';
import type { CliArgs } from './settings.ts';

describe('parseIni', () => {
  it('returns empty object for blank input', () => {
    assert.deepEqual(parseIni(''), {});
  });

  it('returns empty object for comments-only input', () => {
    assert.deepEqual(parseIni('# comment\n; also a comment\n'), {});
  });

  it('parses sections with keys', () => {
    const result = parseIni('[server]\nport = 9000\ninterface = 0.0.0.0\n');
    assert.deepEqual(result, { server: { port: '9000', interface: '0.0.0.0' } });
  });

  it('trims whitespace around keys and values', () => {
    const result = parseIni('[s]\n  key  =  value  \n');
    assert.deepEqual(result, { s: { key: 'value' } });
  });

  it('splits on first = only (values may contain =)', () => {
    const result = parseIni('[tls]\ncert = C:\\path=weird\\cert.pem\n');
    assert.equal(result['tls']!['cert'], 'C:\\path=weird\\cert.pem');
  });

  it('ignores keys before any section header', () => {
    const result = parseIni('orphan = value\n[s]\nkey = val\n');
    assert.deepEqual(result, { s: { key: 'val' } });
  });

  it('handles multiple sections', () => {
    const result = parseIni('[a]\nx = 1\n[b]\ny = 2\n');
    assert.deepEqual(result, { a: { x: '1' }, b: { y: '2' } });
  });

  it('skips lines without = inside a section', () => {
    const result = parseIni('[s]\ngood = val\nbadline\n');
    assert.deepEqual(result, { s: { good: 'val' } });
  });
});

describe('generateDefaultIni', () => {
  it('produces parseable output with expected defaults', () => {
    const ini = parseIni(generateDefaultIni());
    assert.equal(ini['server']!['port'], '8000');
    assert.equal(ini['server']!['interface'], '127.0.0.1');
    assert.equal(ini['logging']!['console-level'], 'warn');
    assert.equal(ini['logging']!['file-level'], 'info');
    assert.equal(ini['logging']!['rotation-interval'], '24h');
    assert.equal(ini['logging']!['retention'], '7d');
    // TLS keys are commented out — should not appear
    assert.equal(ini['tls']?.['cert'], undefined);
    assert.equal(ini['tls']?.['key'], undefined);
  });
});

describe('loadConfig', () => {
  let tmpDir: string;
  const noCli: CliArgs = {};

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-settings-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates settings.ini with defaults on first run', () => {
    const config = loadConfig(tmpDir, noCli);
    assert.ok(existsSync(join(tmpDir, 'settings.ini')));
    assert.equal(config.port, 8000);
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.consoleLogLevel, 'warn');
    assert.equal(config.fileLogLevel, 'info');
    assert.equal(config.logRotationMs, 86400000);
    assert.equal(config.logRetentionMs, 604800000);
    assert.equal(config.dataFolder, tmpDir);
    assert.equal(config.tls, undefined);
  });

  it('reads existing settings.ini', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'settings.ini'), '[server]\nport = 9000\n[logging]\nfile-level = debug\n');

    const config = loadConfig(tmpDir, noCli);
    assert.equal(config.port, 9000);
    assert.equal(config.fileLogLevel, 'debug');
    // Defaults for unset values
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.consoleLogLevel, 'warn');
  });

  it('CLI overrides settings.ini', () => {
    writeFileSync(join(tmpDir, 'settings.ini'), '[server]\nport = 9000\ninterface = 0.0.0.0\n');

    const config = loadConfig(tmpDir, { port: '4000', interface: '10.0.0.1' });
    assert.equal(config.port, 4000);
    assert.equal(config.host, '10.0.0.1');
  });

  it('CLI overrides log levels', () => {
    writeFileSync(join(tmpDir, 'settings.ini'), '[logging]\nconsole-level = error\nfile-level = error\n');

    const config = loadConfig(tmpDir, { 'log-level': 'debug', 'file-log-level': 'info' });
    assert.equal(config.consoleLogLevel, 'debug');
    assert.equal(config.fileLogLevel, 'info');
  });

  it('throws on invalid port', () => {
    assert.throws(
      () => loadConfig(tmpDir, { port: '99999' }),
      (err: unknown) => err instanceof ConfigError && /invalid port/.test(err.message),
    );
  });

  it('throws on non-numeric port', () => {
    assert.throws(
      () => loadConfig(tmpDir, { port: 'abc' }),
      (err: unknown) => err instanceof ConfigError && /invalid port/.test(err.message),
    );
  });

  it('throws on invalid console log level', () => {
    assert.throws(
      () => loadConfig(tmpDir, { 'log-level': 'verbose' }),
      (err: unknown) => err instanceof ConfigError && /console log level/.test(err.message),
    );
  });

  it('throws on invalid file log level', () => {
    assert.throws(
      () => loadConfig(tmpDir, { 'file-log-level': 'trace' }),
      (err: unknown) => err instanceof ConfigError && /file log level/.test(err.message),
    );
  });

  it('throws when tls-cert provided without tls-key', () => {
    assert.throws(
      () => loadConfig(tmpDir, { 'tls-cert': '/tmp/cert.pem' }),
      (err: unknown) => err instanceof ConfigError && /must both be provided/.test(err.message),
    );
  });

  it('throws when tls-key provided without tls-cert', () => {
    assert.throws(
      () => loadConfig(tmpDir, { 'tls-key': '/tmp/key.pem' }),
      (err: unknown) => err instanceof ConfigError && /must both be provided/.test(err.message),
    );
  });

  it('resolves TLS paths from INI relative to dataFolder', () => {
    writeFileSync(join(tmpDir, 'cert.pem'), 'CERT');
    writeFileSync(join(tmpDir, 'key.pem'), 'KEY');
    writeFileSync(join(tmpDir, 'settings.ini'), '[tls]\ncert = cert.pem\nkey = key.pem\n');

    const config = loadConfig(tmpDir, noCli);
    assert.equal(config.tls?.cert, 'CERT');
    assert.equal(config.tls?.key, 'KEY');
  });

  it('resolves TLS paths from CLI relative to cwd', () => {
    // Write cert/key files in tmpDir, pass absolute paths as CLI args
    const certPath = join(tmpDir, 'cli-cert.pem');
    const keyPath = join(tmpDir, 'cli-key.pem');
    writeFileSync(certPath, 'CLI-CERT');
    writeFileSync(keyPath, 'CLI-KEY');

    const config = loadConfig(tmpDir, { 'tls-cert': certPath, 'tls-key': keyPath });
    assert.equal(config.tls?.cert, 'CLI-CERT');
    assert.equal(config.tls?.key, 'CLI-KEY');
  });

  it('CLI TLS paths override INI TLS paths', () => {
    writeFileSync(join(tmpDir, 'ini-cert.pem'), 'INI-CERT');
    writeFileSync(join(tmpDir, 'ini-key.pem'), 'INI-KEY');
    writeFileSync(join(tmpDir, 'settings.ini'), '[tls]\ncert = ini-cert.pem\nkey = ini-key.pem\n');

    const cliCert = join(tmpDir, 'cli-cert.pem');
    const cliKey = join(tmpDir, 'cli-key.pem');
    writeFileSync(cliCert, 'CLI-CERT');
    writeFileSync(cliKey, 'CLI-KEY');

    const config = loadConfig(tmpDir, { 'tls-cert': cliCert, 'tls-key': cliKey });
    assert.equal(config.tls?.cert, 'CLI-CERT');
    assert.equal(config.tls?.key, 'CLI-KEY');
  });

  it('reads TLS CA from INI', () => {
    writeFileSync(join(tmpDir, 'cert.pem'), 'CERT');
    writeFileSync(join(tmpDir, 'key.pem'), 'KEY');
    writeFileSync(join(tmpDir, 'ca.pem'), 'CA');
    writeFileSync(join(tmpDir, 'settings.ini'), '[tls]\ncert = cert.pem\nkey = key.pem\nca = ca.pem\n');

    const config = loadConfig(tmpDir, noCli);
    assert.equal(config.tls?.ca, 'CA');
  });

  it('treats empty INI values as absent', () => {
    writeFileSync(join(tmpDir, 'settings.ini'), '[server]\nport =\ninterface =\n');
    const config = loadConfig(tmpDir, noCli);
    // Falls through to defaults
    assert.equal(config.port, 8000);
    assert.equal(config.host, '127.0.0.1');
  });

  it('does not overwrite existing settings.ini', () => {
    const customIni = '[server]\nport = 3000\n';
    writeFileSync(join(tmpDir, 'settings.ini'), customIni);

    loadConfig(tmpDir, noCli);
    assert.equal(readFileSync(join(tmpDir, 'settings.ini'), 'utf-8'), customIni);
  });

  it('reads rotation-interval and retention from INI', () => {
    writeFileSync(join(tmpDir, 'settings.ini'), '[logging]\nrotation-interval = 1h\nretention = 30d\n');
    const config = loadConfig(tmpDir, noCli);
    assert.equal(config.logRotationMs, 3600000);
    assert.equal(config.logRetentionMs, 2592000000);
  });

  it('CLI overrides rotation-interval and retention', () => {
    writeFileSync(join(tmpDir, 'settings.ini'), '[logging]\nrotation-interval = 1h\nretention = 1d\n');
    const config = loadConfig(tmpDir, { 'log-rotation-interval': '7d', 'log-retention': '30d' });
    assert.equal(config.logRotationMs, 604800000);
    assert.equal(config.logRetentionMs, 2592000000);
  });

  it('throws on invalid rotation-interval', () => {
    assert.throws(
      () => loadConfig(tmpDir, { 'log-rotation-interval': 'abc' }),
      (err: unknown) => err instanceof ConfigError && /log rotation interval/.test(err.message),
    );
  });

  it('throws on invalid retention', () => {
    assert.throws(
      () => loadConfig(tmpDir, { 'log-retention': '0h' }),
      (err: unknown) => err instanceof ConfigError && /log retention/.test(err.message),
    );
  });
});

describe('parseDuration', () => {
  it('parses hours', () => {
    assert.equal(parseDuration('1h', 'test'), 3600000);
    assert.equal(parseDuration('24h', 'test'), 86400000);
  });

  it('parses days', () => {
    assert.equal(parseDuration('1d', 'test'), 86400000);
    assert.equal(parseDuration('7d', 'test'), 604800000);
    assert.equal(parseDuration('30d', 'test'), 2592000000);
  });

  it('throws on invalid format', () => {
    assert.throws(() => parseDuration('abc', 'test'), ConfigError);
    assert.throws(() => parseDuration('10m', 'test'), ConfigError);
    assert.throws(() => parseDuration('10', 'test'), ConfigError);
    assert.throws(() => parseDuration('', 'test'), ConfigError);
  });

  it('throws on zero value', () => {
    assert.throws(() => parseDuration('0h', 'test'), ConfigError);
    assert.throws(() => parseDuration('0d', 'test'), ConfigError);
  });
});
