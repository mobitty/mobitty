---
sidebar_position: 4
title: Custom Keys
description: Create custom Mobitty soft keys that send any key combination or multi-step macro sequence to the terminal.
---

# Custom Keys

Custom keys let you create soft key buttons that send any key combination or multi-step sequence to the terminal.

## Creating a custom key

In the settings panel, under the soft key editor:

1. Tap **Add custom key**
2. Enter a **label** — the text shown on the button (e.g. `C-c`)
3. Enter a **combo** — the key sequence to send (e.g. `Ctrl+c`)

## Combo format

Each combo is a comma-separated list of key steps. Each step is a combination of modifiers and a key:

```
Ctrl+c
Ctrl+Shift+a
Escape, Shift+;, q
```

Valid modifiers: `Ctrl`, `Alt`, `Shift`

Valid keys: any single character, plus `Esc`, `Tab`, `Up`, `Down`, `Left`, `Right`, `Home`, `End`, `PageUp`, `PageDown`

## Examples

| Label | Combo | Use case |
|-------|-------|----------|
| C-c | `Ctrl+c` | Interrupt running process |
| C-z | `Ctrl+z` | Suspend process |
| C-l | `Ctrl+l` | Clear screen |
| tmux | `Ctrl+b` | Tmux prefix key |
| :q | `Escape, Shift+;, q` | Exit Vim |

## Default custom keys

The default mobile profile includes one custom key:

- **C-c** (`Ctrl+c`) — available in the "Extra" container
