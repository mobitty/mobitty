---
sidebar_position: 1
title: CLI Options
description: Mobitty CLI flags for port, bind address, TLS, log level, and the MOBITTY_DATA_FOLDER environment variable.
---

# CLI Options

```
mobitty [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port <number>` | HTTP server port | `8000` |
| `-i, --interface <address>` | Bind address | `127.0.0.1` |
| `-l, --log-level <level>` | Log level (`debug`, `info`, `warn`, `error`) | `info` |
| `--tls-cert <path>` | Path to TLS certificate file | — |
| `--tls-key <path>` | Path to TLS private key file | — |
| `--tls-ca <path>` | Path to TLS CA certificate file | — |
| `-v, --version` | Print version and exit | — |
| `-h, --help` | Print help and exit | — |

:::note
When using TLS, both `--tls-cert` and `--tls-key` must be provided together.
:::

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MOBITTY_DATA_FOLDER` | Data directory for sessions, themes, and logs | `~/.mobitty` |
