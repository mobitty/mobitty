---
sidebar_position: 5
title: Containers
description: Group soft keys into expandable panels.
---

# Containers

Containers are expandable groups of soft keys. A container appears as a single button on the main bar — tap it to open a panel with its child keys.

## How containers work

- Tapping a container button opens its panel above the soft key bar
- Tapping it again (or tapping a different container) closes it
- Only one container can be open at a time
- Child keys behave exactly like keys on the main bar — they support modifiers, hold-to-repeat, and all other key behaviours
- Containers cannot be nested inside other containers

## Creating a container

In the settings panel, under the soft key editor:

1. Tap **Add container**
2. Enter a **label** — the text shown on the button (e.g. `Extra`)
3. Add child keys by selecting from built-in keys, custom keys, or single characters

## Default container

The default mobile profile includes one container:

**Extra** — contains the system meter, Ctrl+C, Home, End, and arrow keys. This keeps the main bar focused on the most-used modifier keys while providing easy access to navigation keys when needed.
