---
sidebar_position: 2
title: Security and Remote Access
description: Access Mobitty securely over the internet.
---

# Security and Remote Access

Mobitty is a terminal with full shell access — anyone who can reach it can run commands on your machine. By default it binds to `127.0.0.1` (localhost only), so it is only reachable from the machine it runs on. We chose this default to avoid accidental exposure — in most use cases, you will want to access it over the internet through an authenticated tunnel.

:::warning
Never expose Mobitty directly to the public internet without authentication. Always use a secure tunnel or VPN.
:::

This page lists some common options for secure tunneling. The mentioned names belong to their respective vendors. Mobitty does not endorse any particular option, choose the option that best suits your setup. Make sure to follow each tool's documentation to configure it securely.

## SSH port forwarding

Forward a remote port over an encrypted SSH connection. This works with any SSH client and requires no extra software on the server beyond OpenSSH.

- [Desktop OpenSSH](https://www.openssh.com/) — built into macOS and Linux, available on Windows via OpenSSH client
- [iOS — iSH](https://ish.app/) — Linux shell environment for iOS with SSH support
- [iOS — Termius](https://termius.com/) — SSH client with port forwarding for iOS
- [Android — Termux](https://termux.dev/) — terminal emulator for Android with OpenSSH packages

## HTTPS tunnels

Expose a local port via a public HTTPS URL with authentication and TLS handled by the tunnel provider.

- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) — zero-trust tunnel through Cloudflare's network
- [Azure Dev Tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/) — Microsoft's dev tunnel service

## VPN

Place your devices on a private network so Mobitty is reachable without exposing it to the public internet.

- [Tailscale](https://tailscale.com/) — WireGuard-based mesh VPN with zero configuration
- Custom VPN — any WireGuard or OpenVPN setup that connects your devices
