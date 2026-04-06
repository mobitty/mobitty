---
sidebar_position: 3
title: System Meter
description: Connection status and latency metrics display.
---

# System Meter

| Key | Label |
|-----|-------|
| `system_meter` | Meter |

Toggles the system metrics panel — a draggable floating overlay that shows real-time connection health. Tap the key to show or hide it. The system meter is included by default in both the desktop and mobile layouts.

## Metrics

The panel displays four metrics, each shown over three time windows (1 minute, 5 minutes, 10 minutes):

### RTT (Round-Trip Time)

Network latency between client and server, in milliseconds.

### FPS (Frames Per Second)

The current target refresh rate for terminal screen updates, automatically adapted based on RTT.

### Data In

Total raw bytes received from the server (terminal output, state updates) summed over each time window.

### Data Out

Total raw bytes sent to the server (keyboard input, resize events) summed over each time window.

All four metrics are explained in detail on the [Adaptive Protocol](/docs/reference/adaptive-protocol) page.
