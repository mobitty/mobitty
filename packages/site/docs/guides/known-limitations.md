---
sidebar_position: 3
title: Known Limitations
description: Mobitty known limitations including browser shortcut restrictions and workarounds.
---

# Known Limitations

## Browser keyboard shortcuts

Certain keyboard shortcuts are reserved by the browser and cannot be intercepted by any web application, including Mobitty. When you press these keys, the browser handles them before the page has a chance to respond.

Common examples:

| Shortcut | Browser action |
|----------|---------------|
| **Ctrl+W** | Close tab |
| **Ctrl+T** | New tab |
| **Ctrl+N** | New window |
| **Ctrl+Tab** | Switch tab |
| **F11** | Toggle fullscreen |

These shortcuts work as expected inside the terminal only when Mobitty is installed as a standalone app (PWA). In standalone mode, the browser chrome is hidden and these keys are forwarded to the web app.

### Workaround: install as a standalone app

1. Open Mobitty in Chrome, Edge, or Safari
2. Use the browser's **Install** option (usually in the address bar or the three-dot menu)
3. Mobitty opens in its own window without browser chrome
4. Browser-reserved shortcuts now reach the terminal

On mobile, use **Add to Home Screen** for the same effect.

### Terminal-safe alternatives

Some browser shortcuts have terminal-safe alternatives that work in both browser tabs and standalone mode:

| Instead of | Use | Effect |
|-----------|-----|--------|
| **Ctrl+W** (delete word) | **Alt+Backspace** | Delete word backward in most shells |
| **Ctrl+L** (clear screen) | Type `clear` + Enter | Clear the terminal |
| **Ctrl+R** (reverse search) | Type `history \| grep` | Search command history |
