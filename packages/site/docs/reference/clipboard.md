---
sidebar_position: 6
title: Clipboard
description: How copy, paste, and image paste work on mobile and desktop.
---

# Clipboard

## Copying text

### Mobile

Tap and hold on the terminal to start a selection. Two draggable handles appear at the edges of the selected text — drag them to adjust. A floating **Copy** button appears between the handles. Tap it to copy.

A brief scissors icon confirms the copy succeeded.

### Desktop

Click and drag to select text, then use your system's copy shortcut (**Ctrl+C** on Linux/Windows, **Cmd+C** on macOS). The browser's native selection and clipboard work as expected.

### Copy on select

You can enable **Copy on Select** in Settings so that any text you select is automatically copied to the clipboard — no extra tap or shortcut needed. This works on both mobile and desktop.

## Pasting text

Paste uses your platform's native method — there is no paste soft key.

- **Desktop:** **Ctrl+V** (Linux/Windows) or **Cmd+V** (macOS)
- **iOS:** Tap with three fingers to bring up the context menu, then tap **Paste**
- **Android:** Long-press the terminal, then tap **Paste** from the context menu

## Pasting images

Mobitty lets you paste images (screenshots, photos) directly into the terminal — useful for sending visual context to AI agents.

1. Copy an image to your clipboard as usual (screenshot, photo, etc.)
2. Paste into the terminal using the same gesture as text paste (see above)
3. Mobitty sends the image to the server

What happens next depends on your server environment:

- **If the server has a system clipboard** (macOS, Windows, or Linux with X11/Wayland): the image is copied to the server's clipboard so the running program can access it.
- Sometimes the server doesn't have clipboard support (for example, a Linux server without X11). In that case, if you have an **Image Paste Directory** configured in Settings, Mobitty saves the image as a file in that directory and types the file path into your terminal automatically.

Supported formats: PNG, JPEG, GIF, WebP, and BMP. Maximum size: 10 MB.

### iOS note

iOS may prompt you to allow clipboard access the first time. If you see a "Clipboard empty" message, allow access when prompted and try again.

### Image paste directory

In Settings, the **Image Paste Directory** field sets where images are saved as a fallback. The path is relative to your shell's current working directory. Defaults to `tmp`.
