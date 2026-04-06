---
sidebar_position: 1
title: Getting Started
description: Get Mobitty running in under a minute.
---

# Getting Started

Run Mobitty without installing:

```sh
npx mobitty
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000) in your browser.

## Access from other devices

By default Mobitty binds to `127.0.0.1` (localhost only). To make it reachable from other devices on your network, bind to all interfaces:

```sh
npx mobitty --interface 0.0.0.0
```

:::warning
Only bind to `0.0.0.0` on a private, trusted network. On a public network, use a secure tunnel instead — see [Security and Remote Access](/docs/guides/remote-access).
:::

## What's next

- [Installation](/docs/guides/installation) — install globally for repeated use
- [Security and Remote Access](/docs/guides/remote-access) — access Mobitty over the internet securely
- [CLI Options](/docs/reference/cli-options) — all command-line flags
