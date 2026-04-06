---
sidebar_position: 8
title: Gestures
description: Touch gestures on mobile — swipe, flick, tap, pinch, rotate, and long-press.
---

# Gestures

Gestures let you map touch actions on the terminal to any soft key. They are configured per profile under **Settings > Gestures** (mobile profiles only).

By default no gestures are mapped — the terminal uses its native touch behaviors (scrolling, text selection). When you map a gesture, it fires the assigned soft key action instead.

## Available gestures

### 1-finger swipe

Slide one finger across the terminal. Commonly mapped to scroll or arrow keys.

When mapped to a scroll key (`wheel_up` / `wheel_down`), the terminal scrolls smoothly as your finger moves rather than jumping one step per swipe.

:::note
Mapping 1-finger swipes overrides native touch scrolling for the mapped directions. Unmapped directions still scroll normally.
:::

### 1-finger flick

A quick, fast swipe. If a regular swipe is also mapped for the same direction, the swipe takes priority.

### 2-finger swipe

Slide two fingers across the terminal. Vertical 2-finger swipes also support smooth scrolling when mapped to a scroll key.

### 3-finger swipe

Slide three fingers across the terminal. Same smooth-scrolling support as 1-finger and 2-finger swipe.

### Double-tap

Tap twice quickly. When unmapped, double-tap selects the word under the tap (the terminal's built-in behavior).

### Triple-tap

Tap three times quickly. When unmapped, triple-tap selects the line under the tap. You can combine it with modifier soft keys:

- **Shift + triple-tap** — select all visible lines
- **Alt + triple-tap** — select all text

### Long-press

Touch and hold for about half a second. Does nothing unless mapped.

### Pinch

Two-finger squeeze (pinch in) or spread (pinch out). Each direction is a separate gesture you can map independently.

### Rotate

Two-finger twist, clockwise or counter-clockwise. Each direction is a separate gesture.

## Configuring gestures

Open **Settings**, select a mobile profile, and go to the **Gestures** tab. Each gesture has a dropdown listing all available soft keys (built-in and custom). Set a gesture to **disabled** to restore its default behavior.

Tap **Reset to Defaults** to clear all mappings.
