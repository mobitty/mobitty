---
sidebar_position: 3
title: Profiles
description: Desktop and mobile profile settings reference.
---

# Profiles

Mobitty maintains separate profiles for desktop and mobile. The active profile is chosen automatically based on your device — touch devices load the mobile profile, everything else loads the desktop profile.

Profiles are edited in the settings panel. Changes are saved to the server and cached locally in the browser so the terminal can mount instantly on the next visit.

## Settings

| Setting | Range | Default (desktop) | Default (mobile) |
|---------|-------|--------------------|-------------------|
| Font size | 8–72 px | 13 | 10 |
| Font family | Any CSS font family | CaskaydiaCove NFM | CaskaydiaCove NFM |
| Theme (light) | Theme name | default-light | default-light |
| Theme (dark) | Theme name | default-dark | default-dark |
| Scrollback | 100–50 000 lines | 5 000 | 5 000 |
| Padding | 0–48 px | 4 | 4 |
| Soft key size | 28–60 px | 44 | 44 |
| Option is Meta | on / off | on | on |
| Notification mode | iterm / kitty / ghostty / off | ghostty | ghostty |
| Remote editor | on / off | off | on |
| Copy on select | on / off | off | off |
| Image paste dir | Directory path | tmp | tmp |

### Option is Meta

When enabled, the Option key (macOS) or Alt key is treated as the Meta modifier. This is the standard terminal behaviour — disable it only if you need Option for composing special characters.

### Notification mode

Determines which terminal notification protocol Mobitty listens for. Programmes running inside the terminal can trigger desktop-style notifications through these protocols.

- **ghostty** — Ghostty's notification protocol (default)
- **iterm** — iTerm2's proprietary escape sequence
- **kitty** — Kitty's notification protocol
- **off** — Ignore notification escape sequences

### Remote editor

When enabled, Mobitty intercepts editor launch requests (e.g. `$EDITOR`) and opens the file in a built-in editor panel instead of a terminal-based editor. Useful on mobile where terminal editors are harder to use.

### Copy on select

Automatically copies selected text to the clipboard without requiring an explicit copy action. When enabled on mobile, selection handles appear for precise text selection.

## Soft key layout

Each profile includes a soft key layout that defines which keys appear in the bar at the bottom of the terminal. See [Soft Keys](/docs/reference/softkeys) for the full reference.

## Default layouts

**Desktop** — a minimal bar with the system meter and inline input.

**Mobile** — Esc, Ctrl, Alt, Shift, Tab, batch input, and an expandable container with navigation keys, Ctrl+C, and the system meter.
