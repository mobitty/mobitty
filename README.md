# Mobitty

Powerful mobile-first web terminal to help you stay productive anywhere.

Unlike other web terminals that bolt mobile support onto a desktop design, Mobitty is built touch-first — soft keys, gestures, and adaptive rendering make it genuinely usable on a phone.

### Who is this for?

- Access your dev server from an iPad on the couch
- SSH into machines from your phone without a native app
- Talk to AI agents and get things done in spare moments and on the go
- Start work on your desktop, continue on your phone — or the other way around

## Features

- **Touch-first UI** -- Highly customizable soft keys, macros, simulated mouse scroll, multi-touch gestures.
- **Multiple sessions** -- Create, switch, and manage multiple shells. Get OSC 9, 99, 777 notifications.
- **Profiles & themes** -- Per-profile fonts, colors, scrollback, softkey layouts, gesture mappings, and hotkeys.
- **Adaptive sync** -- WebGL, Canvas, and DOM renderer backends with incremental sync that adapts to network latency — stays responsive even on slow connections.
- **TCP protocol** -- Works through any TCP tunnel (SSH, Cloudflare Tunnel, Tailscale) for best network compatibility.
- **PWA support** -- Installable as a standalone app on mobile and desktop.
- **Image paste** -- Paste screenshots directly into AI agents running in your terminal.

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

Usable out of the box with sensible default settings. Press the hamburger button in the lower left to customize. `--help` to see all CLI options.

## Security

Mobitty does not provide encryption or authentication on its own. Do not expose it directly to the internet. Instead, access it over a TCP tunnel with strong authentication (e.g., SSH port forwarding, Cloudflare Tunnel, Tailscale Funnel) or through a VPN.

## License

[BSL-1.1](LICENSE) -- free for personal, non-commercial use. Converts to GPLv2+ four years after each release.
