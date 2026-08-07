---
sidebar_position: 10
title: Clipboard
description: How copy, paste, and image paste work on mobile and desktop.
---

# Clipboard

## Copying text

### Mobile

Tap and hold on the terminal to start a selection. Two draggable handles appear at the edges of the selected text — drag them to adjust. A floating menu with **Copy** and **Paste** buttons appears between the handles. Tap **Copy** to copy the selected text.

A brief scissors icon confirms the copy succeeded.

### Desktop

Click and drag to select text, then copy with your platform's shortcut:

- **Windows:** **Ctrl+Shift+Z** copies the selection and **Ctrl+Shift+X** pastes. (Browsers reserve Ctrl+C / Ctrl+Shift+C, so Mobitty binds keys they leave alone.)
- **macOS / Linux:** no shortcut is bound by default — use your browser's native copy, or turn on Copy on Select below.

If nothing is selected, the copy shortcut does nothing.

Both shortcuts are configurable: **Settings → Copy Hotkey / Paste Hotkey**. Set a field to blank to unbind it.

### Copy on select

You can enable **Copy on Select** in Settings so that any text you select is automatically copied to the clipboard — no extra tap or shortcut needed. This works on both mobile and desktop.

### Copying from full-screen apps

Programs that take over the screen and track the mouse — Claude Code, vim, tmux, lazygit — receive your click-and-drag themselves, so the selection belongs to the program, not to Mobitty. Those programs do their own copying.

When such a program copies, it can hand the text to your terminal using a standard escape sequence (OSC 52). Mobitty understands it and puts the text on **your device's** clipboard, confirming with a brief *Copied from session* message. This works from any session, including one running on a remote server.

Some programs need this turned on:

- **tmux:** `set -g set-clipboard on`
- **Neovim:** `let g:clipboard = 'osc52'` (see `:help clipboard-osc52`)
- **Claude Code, lazygit:** works out of the box

To check it end to end, run this inside a session — `hello` should land on your clipboard:

```sh
printf '\033]52;c;%s\a' "$(printf hello | base64)"
```

:::note
This needs a secure page: `https://` or `localhost`. Over plain `http://` the browser blocks clipboard writes and you'll see *Copy failed* instead.
:::

Programs may also copy to the clipboard of the machine running the Mobitty server, if that machine has one. Claude Code, for example, does both. That's the program's own behavior, not something Mobitty controls.

For privacy, Mobitty never lets a program *read* your clipboard this way — only write to it.

## Pasting text

### Mobile

When a selection is active, the floating edit menu shows both **Copy** and **Paste** buttons. Tap **Paste** to insert clipboard text at the cursor.

You can also add the `paste` soft key to your soft key layout for quick one-tap pasting without a selection — see [Input Control](/docs/reference/softkeys/input-control#paste).

The platform's native paste gesture still works too:

- **iOS:** Tap with three fingers to bring up the context menu, then tap **Paste**
- **Android:** Long-press the terminal, then tap **Paste** from the context menu

### Desktop

- **Windows:** press **Ctrl+Shift+X**.
- **macOS / Linux:** use your browser's native paste — **Cmd+V** or **Ctrl+Shift+V**.

As with copy, the shortcut is configurable in **Settings → Paste Hotkey**.

## Pasting images

Mobitty lets you paste images (screenshots, photos) directly into the terminal — useful for sending visual context to AI agents.

![Terminal showing "Image saved, path typed" after pasting a screenshot](/img/image-paste.webp)

1. Copy an image to your clipboard as usual (screenshot, photo, etc.)
2. Paste into the terminal using the same gesture as text paste (see above)
3. Mobitty sends the image to the server

What happens next depends on your server environment:

- **If the server has a system clipboard** (macOS, Windows, or Linux with X11/Wayland): the image is copied to the server's clipboard so the running program can access it.
- Sometimes the server doesn't have clipboard support (for example, a Linux server without X11). In that case, if you have an **Image Paste Directory** configured in Settings, Mobitty saves the image as a file in that directory and types the file path into your terminal automatically.

Supported formats: PNG, JPEG, GIF, WebP, and BMP. Maximum size: 25 MB.

### iOS note

iOS may prompt you to allow clipboard access the first time. If you see a "Clipboard empty" message, allow access when prompted and try again.

### Image paste directory

In Settings, the **Image Paste Directory** field sets where images are saved as a fallback. The path is relative to your shell's current working directory. Defaults to `tmp`.
