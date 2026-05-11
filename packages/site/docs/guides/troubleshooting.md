---
sidebar_position: 4
title: Troubleshooting
description: Diagnose connection problems and other common Mobitty issues.
---

# Troubleshooting

## Can't reach Mobitty

When the iOS app or your browser shows "Can't reach Mobitty", the client could not open a TCP connection to any of the configured server URLs. The iOS error screen lists every URL that was tried — work through the checks below for each one.

### 1. Is the Mobitty server running?

The server must be running on the computer at the listed address.

- Check the terminal where you launched Mobitty. If the process exited (crash, Ctrl+C, terminal window closed, laptop lid closed), nothing is listening.
- Restart it with `npx mobitty` (or `mobitty` if installed globally — see [Installation](/docs/guides/installation)).
- If you run Mobitty inside `tmux` or `screen`, confirm the session is still attached and the process inside it is still alive.

### 2. Is the computer awake?

Most laptops suspend networking when the lid closes or the system sleeps, which silently breaks any client trying to connect.

- Wake the machine and confirm it has a network connection.
- For long-lived remote access, configure the machine to stay awake (macOS: `caffeinate -di`; Windows: Settings → System → Power; Linux: `systemd-inhibit` or disable sleep targets).
- Wired ethernet usually survives sleep better than Wi-Fi on the same machine.

### 3. Is your VPN or tunnel connected?

If your client reaches the server through a VPN or SSH tunnel, that tunnel has to be up before any connection attempt will succeed.

- **VPN (e.g. Tailscale, WireGuard):** confirm the VPN app shows "connected" on both the client device and the server machine. Tailscale in particular drops nodes when they sleep.
- **SSH port-forward:** if you started it with `ssh -L 8000:localhost:8000 ...`, the ssh process must still be running. Network changes (Wi-Fi switch, sleep) frequently kill it without warning.
- **HTTPS tunnel (Cloudflare Tunnel, Azure Dev Tunnels):** check the tunnel daemon is running on the server and the public URL is still valid.

See [Security and Remote Access](/docs/guides/remote-access) for details on each option.

### 4. Is the URL correct?

Compare the URL shown on the error screen to where the server is actually listening.

- The server prints its listening address at startup (e.g. `Listening on http://127.0.0.1:8000`).
- `127.0.0.1` / `localhost` is only reachable from the **same machine**. If you are connecting from a phone or another computer, the server must bind to a routable address — start it with `--interface 0.0.0.0` (private network only) or front it with a tunnel.
- `http://` vs `https://` matters. If you put Mobitty behind a TLS-terminating reverse proxy or tunnel, use the `https://` URL the proxy serves, not the internal `http://` one.

### 5. Same network and reachable?

For direct LAN access:

- Client and server must be on the same network segment, or routed between them.
- The server's firewall must allow the Mobitty port (default `8000`). macOS, Windows Defender, and Linux `ufw` / `firewalld` all block unknown inbound ports by default.
- A quick reachability test from the client (in a terminal app): `curl -v http://SERVER:8000` — a 200 or even a 404 means the port is open; "connection refused" or a timeout points at firewall / wrong interface / server not running.

## Adding multiple URLs for failover

The iOS app accepts multiple URLs per saved server and tries them in order until one connects. This is useful when your server is reachable two ways — e.g. a Tailscale address and a local LAN address — and you want it to "just work" whether or not the VPN is up.

Open the iOS app's server setup and add each URL on its own line. The first one is tried first; the rest are fallbacks.
