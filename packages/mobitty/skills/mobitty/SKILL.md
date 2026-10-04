---
name: mobitty
description: Show, hand over, or let the user edit files through the browser that is driving this terminal, using `mobitty-cli`. Use whenever `MOBITTY_SESSION_ID` is set and you want the user to look at a file or folder (an image, a PDF, a rendered Markdown doc, a screenshot, a diff you wrote out), edit a file themselves, or receive a file on their device — rather than pasting its contents into the conversation. Also use to understand why `$EDITOR` opens a panel in the user's browser.
---

# mobitty

mobitty is a web terminal. When `MOBITTY_SESSION_ID` is set, the shell you run
in is a mobitty session, and the human is reading it in a browser — often on a
phone, where scrolling back through pasted file contents is painful. The session
gives you `mobitty-cli`, which puts a file in front of them in that browser.

Check before you use it:

```sh
echo "$MOBITTY_SESSION_ID"   # empty → not in mobitty; none of this applies
```

Outside a mobitty session every command fails with
`missing MOBITTY_SESSION_ID or MOBITTY_CLI_PORT`.

## Commands

```
mobitty-cli view <path>       read-only viewer for a file or folder
mobitty-cli edit <path>       open a file in the browser editor
mobitty-cli download <path>   send a file to the user's device
```

Paths resolve against your working directory; absolute paths are never wrong.
Errors go to stderr prefixed `mobitty-cli:`, with exit status 1.

### `view` — show the user something

- A **file** opens a preview: text, syntax-highlighted code, images, and
  rendered Markdown.
- A **folder** opens a file tree with the same preview beside it.
- The viewer offers the user Copy path and Edit; an edit they make there is
  written to disk by the server.
- **With the user attached to this session, it blocks until they close the
  view**, like a pager, then exits 0.
- **With no one attached, it queues the view and exits 0 at once**, printing
  `view: queued <path> — …` to stderr. The session gets an alert badge and the
  view opens when the user next opens the session. Queue several and they
  appear as tabs the user closes one by one; repeating a queued path replaces
  it rather than adding a tab.

### `edit` — let the user change a file

- Opens the file in an editor panel. A path that does not exist yet opens
  empty, and is created on save.
- **It blocks until the user saves or cancels.** On save the new content is
  written to the file; on cancel the file is untouched. Both exit 0 — re-read
  the file to learn which happened.
- Images (`.png .jpg .jpeg .gif .webp .bmp .svg`) open for display only;
  nothing is written back.

### `download` — give the user the file

- Sends one regular file to the browser, which saves it on the user's device.
  Folders are refused; archive one first.
- Returns as soon as the browser is told to fetch the file, printing
  `download: <name>` to stderr. It does not wait for the transfer to finish.

## Blocking commands and your tool calls

`view` (when the user is attached) and `edit` wait on a human, for as long as
the human takes. Run them so the wait does not hold up your turn or hit a tool
timeout — in Claude Code, call
Bash with `run_in_background: true`; you are notified when the user closes the
panel. Do not poll for it, and do not wrap the command in `timeout`: killing the
CLI closes the panel under the user.

`download` is quick; run it in the foreground.

## Failures that mean something

| stderr | Meaning | What to do |
|---|---|---|
| `server error 503: …No client connected…` | `edit` or `download`: no browser is attached to this session right now. (`view` queues instead.) | Tell the user; retry once they reopen it. |
| `server error 409: …already…` | An editor is already open in this session. | Wait for it to close; one at a time. |
| `not found: <path>` / `file not found` | Path does not exist (for `edit`, only images must exist). | Fix the path. |
| `not a regular file` | `download` was given a folder or device. | Archive the folder, download the archive. |

## `$EDITOR`

With the remote editor enabled, mobitty sets `$EDITOR` and `$VISUAL` to
`mobitty-cli-edit`, the same as `mobitty-cli edit`. Anything that launches an
editor — `git commit` without `-m`, `git rebase -i`, `crontab -e` — therefore
opens a panel in the user's browser and blocks until they finish. Pass the
content non-interactively (`git commit -m …`) unless you mean to hand the edit
to the user.
