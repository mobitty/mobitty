---
sidebar_position: 1
title: Modifier and Special Keys
description: Built-in modifier, navigation, and special keys.
---

# Modifier and Special Keys

## Modifier keys

| Key | Label | Behaviour |
|-----|-------|-----------|
| `ctrl` | Ctrl | Toggles the Ctrl modifier. Stays active until the next key press consumes it. |
| `alt` | Alt | Toggles the Alt modifier. Same toggle behaviour as Ctrl. |
| `shift` | Shift | Toggles the Shift modifier. Same toggle behaviour as Ctrl. |

Modifiers are **sticky** — tap Ctrl, then tap another key, and the combination is sent (e.g. Ctrl+C). The modifier clears after being consumed. You can stack multiple modifiers (e.g. Ctrl+Shift+A).

## Navigation keys

| Key | Label | Hold-to-repeat |
|-----|-------|---------------|
| `up` | \u2191 | Yes |
| `down` | \u2193 | Yes |
| `left` | \u2190 | Yes |
| `right` | \u2192 | Yes |
| `home` | Home | No |
| `end` | End | No |
| `pageup` | PgUp | No |
| `pagedown` | PgDn | No |

Arrow keys fire repeatedly when held down.

## Special keys

| Key | Label | Description |
|-----|-------|-------------|
| `esc` | Esc | Sends Escape |
| `tab` | Tab | Sends Tab (useful for autocompletion) |
| `enter` | \u23CE | Sends Enter (carriage return) |
| `space` | Spc | Sends Space |

## Scroll keys

| Key | Label | Hold-to-repeat | Description |
|-----|-------|---------------|-------------|
| `wheel_up` | W\u2191 | Yes | Scrolls terminal up (simulates mouse wheel) |
| `wheel_down` | W\u2193 | Yes | Scrolls terminal down (simulates mouse wheel) |

Scroll speed is configurable per key via the **wheelDelta** setting (10–500 pixels, default 100).
