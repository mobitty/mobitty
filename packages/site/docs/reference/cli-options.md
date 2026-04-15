---
sidebar_position: 1
title: Server Configuration
description: Mobitty server configuration via the data folder, settings.ini, CLI flags, and logging. No telemetry — all data stays local.
---

# Server Configuration

## Data folder

Mobitty stores all server-side data in a single folder. Set its location with the `MOBITTY_DATA_FOLDER` environment variable, or leave it at the default `~/.mobitty`.

| Variable | Description | Default |
|----------|-------------|---------|
| `MOBITTY_DATA_FOLDER` | Data directory for settings, sessions, logs, and themes | `~/.mobitty` |

## settings.ini

Mobitty auto-generates a `settings.ini` file in the data folder on first run. Edit it to set persistent defaults without passing CLI flags every time.

```ini
[server]
port = 8000
interface = 127.0.0.1
max-payload = 50

[logging]
console-level = warn
file-level = info
rotation-interval = 24h
retention = 7d

[tls]
# Paths are resolved relative to this file's directory.
# cert = tls.crt
# key = tls.key
# ca = ca.pem
```

CLI flags take precedence over `settings.ini` values. Empty values in the INI file (e.g., `port =`) fall through to the built-in defaults.

The file is never overwritten by the server — your edits are preserved across upgrades.

## CLI flags

```
mobitty [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port <number>` | HTTP server port | `8000` |
| `-i, --interface <address>` | Bind address | `127.0.0.1` |
| `--max-payload <number>` | Maximum WebSocket message size in MB | `50` |
| `-l, --log-level <level>` | Console log level (`debug`, `info`, `warn`, `error`) | `warn` |
| `--file-log-level <level>` | File log level (`debug`, `info`, `warn`, `error`) | `info` |
| `--log-rotation-interval <duration>` | Log file rotation interval (e.g., `1h`, `24h`, `7d`) | `24h` |
| `--log-retention <duration>` | Log file retention period (e.g., `7d`, `30d`) | `7d` |
| `--tls-cert <path>` | Path to TLS certificate file | — |
| `--tls-key <path>` | Path to TLS private key file | — |
| `--tls-ca <path>` | Path to TLS CA certificate file | — |
| `-v, --version` | Print version and exit | — |
| `-h, --help` | Print help and exit | — |

:::note
When using TLS, both `--tls-cert` and `--tls-key` must be provided together.
:::

## Logging

All logging is fully local. Mobitty does not send telemetry, analytics, or log data to the internet.

Server logs are written as rotating JSONL files in the `logs/` subfolder of the data folder. The console log level controls what prints to the terminal; the file log level controls what is written to disk. Log files are automatically rotated and old files cleaned up based on the configured interval and retention period.
