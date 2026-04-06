---
sidebar_position: 7
title: Desktop Keyboard Shortcuts
description: Keyboard shortcuts available on desktop.
---

# Desktop Keyboard Shortcuts

## Global

| Shortcut | Action |
|----------|--------|
| **Ctrl+Shift+S** | Toggle session panel |

The session switcher hotkey is configurable under the **Hotkey** setting in the desktop profile.

## Session panel

| Key | Action |
|-----|--------|
| **Up / Down** | Navigate session list |
| **Enter** | Switch to selected session |
| **Escape** | Close panel |
| **N** | New session |
| **R** | Rename selected session |
| **Delete** | Delete selected session |
| **Shift+Up / Shift+Down** | Reorder selected session |
| **?** | Show help |

## Shell selector

| Key | Action |
|-----|--------|
| **Up / Down** | Navigate shell list |
| **Enter** | Select shell |
| **Escape** | Close selector |
| **?** | Show help |

## Remote editor

| Shortcut | Action |
|----------|--------|
| **Ctrl+S / Cmd+S** | Save file |

## Browser key interception

Mobitty intercepts certain browser shortcuts so they reach the terminal instead:

| Key | Normal browser action | Mobitty behaviour |
|-----|----------------------|-------------------|
| **Ctrl+W** | Close tab | Sent to terminal (e.g. delete word in bash) |
| **Ctrl+T** | New tab | Sent to terminal |
| **Ctrl+N** | New window | Sent to terminal |
| **Ctrl+L** | Focus address bar | Sent to terminal (clear screen in some shells) |
| **Ctrl+R** | Reload page | Sent to terminal (reverse search in bash) |
