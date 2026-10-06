---
sidebar_position: 12
title: Shell Tools (mobitty-cli)
description: Mobitty shell tools for downloading files, editing, and viewing files and folders from your terminal session in the browser.
---

# Shell Tools (mobitty-cli)

Mobitty provides a set of shell tools available inside your terminal sessions. These commands let you interact with the browser directly from the command line.

```
mobitty-cli <command> <path>
```

| Command | Description |
|---------|-------------|
| `edit <path>` | Open a file in the browser editor |
| `view <path>` | View a file or folder in the browser |
| `download <path>` | Download a file to the browser |

### edit

Opens a file in a full-screen browser editor. This is the same command that runs when programs like `git commit` or `crontab -e` need an editor — Mobitty sets `$EDITOR` and `$VISUAL` to a dedicated `mobitty-cli-edit` binary (which behaves identically to `mobitty-cli edit`) when the [Remote Editor](/docs/reference/remote-editor) setting is enabled.

You can also invoke it directly:

```bash
mobitty-cli edit ~/.bashrc
```

When you open an image file, it automatically switches to the image viewer.

### view

Opens a read-only viewer for a file or folder. A file shows a preview: text, syntax-highlighted code, images (with zoom), rendered Markdown, or an audio player. A folder shows a file tree beside the preview. The viewer offers Copy path and Edit.

```bash
mobitty-cli view screenshot.png
mobitty-cli view .
```

While you are watching the session, the command waits until you close the viewer. If no browser is attached to the session, the view is queued and the command returns at once: the session shows an alert, and the view opens the next time you open that session. Several views open as tabs, which you close one at a time.

### download

Download a file from the server to your browser.

```bash
mobitty-cli download backup.tar.gz
```

The file is streamed directly to your browser's download manager — you'll see the standard download prompt or progress indicator, just like downloading any file from a website. Both absolute and relative paths are supported.
