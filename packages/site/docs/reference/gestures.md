---
sidebar_position: 9
title: Gestures
description: Touch gestures on mobile — swipe, flick, tap, pinch, and rotate.
---

# Gestures

Gestures let you map touch actions on the terminal to any soft key. They are configured per profile under **Settings > Gestures** (mobile profiles only).

By default no gestures are mapped — the terminal uses its native touch behaviors (scrolling, text selection). When you map a gesture, it fires the assigned soft key action instead.

## Available gestures

### 1-finger swipe

Slide one finger left or right across the terminal. Only horizontal directions are configurable — vertical 1-finger swipes always scroll natively.

### 1-finger flick

A quick, fast swipe. If a regular swipe is also mapped for the same direction, the swipe takes priority.

### 2-finger swipe

Slide two fingers across the terminal. Vertical 2-finger swipes also support smooth scrolling when mapped to a scroll key (`wheel_up` / `wheel_down`).

### 3-finger swipe

Slide three fingers across the terminal. Same smooth-scrolling support as 2-finger swipe.

### Double-tap

Tap twice quickly.

### Triple-tap

Tap three times quickly.

### Pinch

Two-finger squeeze (pinch in) or spread (pinch out). Each direction is a separate gesture you can map independently.

### Rotate

Two-finger twist, clockwise or counter-clockwise. Each direction is a separate gesture.

## Default behaviors

These touch actions always use their built-in behavior and are not configurable:

- **Long-press** (~500ms hold) — selects the word under the touch
- **1-finger swipe up/down** — native terminal scrolling

## Selection actions

Three built-in soft keys are available for mapping to gestures:

| Key ID | Label | Action |
|---|---|---|
| `select_line` | Sel Line | Select the line at the gesture position |
| `select_visible` | Sel Visible | Select all visible viewport lines |
| `select_all` | Sel All | Select all text in the terminal |

For example, mapping triple-tap to `select_line` gives line-select on triple-tap, or mapping it to `select_all` selects everything.

## Configuring gestures

Open **Settings**, select a mobile profile, and go to the **Gestures** tab. Each gesture has a dropdown listing all available soft keys (built-in and custom). Set a gesture to **disabled** to clear it.

Tap **Reset to Defaults** to clear all mappings.
