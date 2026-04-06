---
sidebar_position: 9
title: Notifications
description: Mobitty shows terminal notifications as in-app toasts. Supports Ghostty, iTerm2, and Kitty notification protocols.
---

# Notifications

Programs running in your terminal can send notifications — for example, an AI agent signaling that a long task is done, or a build tool reporting completion. Mobitty shows these as in-app toasts.

## How it works

When a program sends a terminal notification, Mobitty displays a toast at the top of the screen with the notification title and body. If the notification came from a background session, the toast includes a button to switch to that session.

Notifications from the currently active session are not shown as toasts — you're already looking at it.

## Bell alerts

When a program sends the bell character (the beep you hear in a normal terminal), Mobitty marks the session with an alert indicator in the session list. This lets you know something happened in a background session without switching to it.

## Notification mode

Mobitty emulates terminal notification protocols so that programs detect and use them automatically. You can choose which protocol to emulate in Settings under **Notification Mode**:

| Mode | Protocol | Compatible with |
|------|----------|----------------|
| **Ghostty** (default) | OSC 777 | Ghostty, rxvt-unicode |
| **iTerm2** | OSC 9 | iTerm2, ConEmu |
| **Kitty** | OSC 99 | Kitty |
| **Off** | — | Disables notification emulation |

Mobitty sets the `TERM_PROGRAM` environment variable to match your selection so that programs know which protocol to use. This applies to new sessions only.

Most users can leave this on the default. Change it if you use tools that specifically target a different protocol.

Product names listed above are trademarks of their respective owners. Mobitty is not affiliated with any of these projects.
