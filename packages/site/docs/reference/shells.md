---
sidebar_position: 3
title: Shells
description: Mobitty discovers available shells on the host and lets you choose which one runs in each session. Create custom shells with specific commands and environment variables.
---

# Shells

A shell defines which program runs when you create a session — for example, `bash`, `zsh`, `fish`, or `powershell`. Mobitty automatically discovers shells installed on the server and lets you manage them from the settings panel.

## Auto-discovered shells

When the server starts, Mobitty scans the system for available shells.

**Linux and macOS** — reads `/etc/shells` to find installed shell paths, verifies each one exists, and adds it to the list. Common interactive shells (bash, zsh, fish, ksh, tcsh, dash) are launched in interactive login mode (`-i -l`) automatically.

**Windows** — probes for PowerShell 5, PowerShell 7, cmd.exe, Git Bash, and WSL in that order.

Discovered shells appear in the shell list with an **auto** badge. They are detected fresh each time the server starts and are not saved to disk.

## Custom shells

You can create your own shell entries from **Settings > Shells > Add Shell**. A custom shell has three fields:

| Field | Description |
|-------|-------------|
| Name | A unique identifier (letters, numbers, hyphens, underscores) |
| Command | The program and arguments to run (e.g. `/bin/bash -i -l`) |
| Environment variables | Optional key-value pairs added to the shell's environment at launch |

Custom shells are saved to the server and persist across restarts.

To customise a discovered shell — for example, to add environment variables to `zsh` — click **Save As** next to it. This creates a saved copy you can edit. If you later delete the saved copy, the original discovered shell reappears.

## Choosing a shell for a session

When you connect to Mobitty for the first time, a full-screen shell picker lets you choose which shell to start with. If only one shell is available, this step is skipped and a session is created immediately.

When creating additional sessions from the session panel:

- **One shell available** — the session is created immediately with that shell.
- **Multiple shells available** — an inline picker shows each shell's name, command, and source. Tap a shell to create the session.

Each session remembers which shell it was created with. The shell name is shown in the session list.

## Environment variables

The optional environment variables on a shell are merged into the process environment when a session starts. This is useful for setting variables like `LANG`, `SHELL`, or tool-specific configuration that should apply only to sessions using that shell.

## Rediscovering shells

If you install a new shell on the server, you don't need to restart — go to **Settings > Shells** and click **Rediscover Shells** to re-scan the system.
