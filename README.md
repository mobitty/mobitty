# Mobitty

[![npm version](https://img.shields.io/npm/v/mobitty)](https://www.npmjs.com/package/mobitty)
[![npm downloads](https://img.shields.io/npm/dm/mobitty)](https://www.npmjs.com/package/mobitty)
[![license](https://img.shields.io/badge/license-BSL--1.1-blue)](https://github.com/mobitty/mobitty/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/mobitty/mobitty)](https://github.com/mobitty/mobitty)

A touch-first web terminal for AI agent workflows. Self-hosted, source-available.

Mobitty is a self-hosted web terminal for running AI coding agents like Claude Code and Codex from your phone, tablet, or any browser. Unlike web terminals that bolt mobile support onto a desktop design (ttyd, Wetty), Mobitty is built for fingers — soft keys, gestures, and adaptive rendering that stays responsive even on slow connections.

Run Claude Code from your phone. Paste screenshots into AI agents. SSH into machines from an iPad. Start on your desktop, continue on your phone.

## Features

- **AI agent integration** -- Paste screenshots directly into AI agents. Watch output in real time. Interrupt when needed.
- **Touch-first UI** -- Customizable soft keys, macros, simulated mouse scroll, multi-touch gestures.
- **Persistent sessions** -- Sessions survive disconnects. Pick up on any device.
- **Adaptive sync** -- Stays responsive on slow connections by adapting to network latency (WebGL, Canvas, and DOM renderer backends).
- **Tunnel-friendly** -- Works through SSH, Cloudflare Tunnel, Tailscale — any TCP tunnel.
- **PWA support** -- Installable as a standalone app on mobile and desktop.
- **Profiles & themes** -- Per-profile fonts, colors, scrollback, softkey layouts, gesture mappings, and hotkeys.

## Get Started

```sh
npx mobitty
```

Open <http://127.0.0.1:8000> in your browser.

To access from other devices:

```sh
npx mobitty -i 0.0.0.0
```

Then open `http://<your-ip>:8000` from any device on the network.

No Docker, no config files, no accounts. `--help` to see all CLI options. Open the menu in the lower left to customize.

## Security

Mobitty does not provide encryption or authentication on its own. Do not expose it directly to the internet. Instead, access it over a TCP tunnel with strong authentication (e.g., SSH port forwarding, Cloudflare Tunnel, Tailscale Funnel) or through a VPN.

## Documentation

[mobitty.dev](https://mobitty.dev)

## License

[BSL-1.1](LICENSE) -- free for personal, non-commercial use. Converts to GPLv2+ four years after each release.
