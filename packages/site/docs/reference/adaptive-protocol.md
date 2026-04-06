---
sidebar_position: 8
title: Adaptive Protocol
description: How Mobitty adapts refresh rate and data transfer to network conditions.
---

# Adaptive Protocol

Mobitty continuously measures the network between your browser and the server, then adjusts how it sends terminal updates to stay as responsive as possible under the current network conditions.

## Adaptive refresh rate

Mobitty measures the round-trip time (RTT) to the server and uses it to choose a refresh rate:

| Connection | Refresh rate |
|------------|-------------|
| Fast (LAN) | 60 fps — full speed |
| Typical internet | 30 fps — avoids congestion and keeps latency low |
| Slow or distant | Scales down further, minimum 4 fps |

Sending fewer updates on a slower link prevents packets from queuing up, which would otherwise add latency to everything — including your keystrokes. Your input is always sent immediately; only screen refreshes are adapted.

## Incremental updates

Rather than resending the entire terminal on every frame, the server sends only what has changed since the last update. This keeps each message small, reducing both bandwidth and round-trip overhead. A full screen refresh is sent when you first connect, when the terminal resizes, or when the client falls out of sync.

## Compression

All traffic between the browser and the server is compressed. Terminal data is highly repetitive, so compression typically reduces it to 10–30% of the raw size — less data on the wire means less congestion and faster delivery.

## Monitoring

The [system meter](/docs/reference/softkeys/system-meter) soft key shows RTT, refresh rate, and data usage in real time.
