// Written to the terminal before every STATE_FULL payload (terminal-core.ts).
//
// Resets to the default every mode the payload emits only when it is not the
// default (`serializeModes` in @mobitty/vt's diff.ts sends SET sequences,
// never RESETs). Without this, a mode set by a previous session's TUI —
// github copilot enables `?1000h` mouse tracking, vim `?1h` cursor keys —
// survives session switches, because one Terminal instance is shared across
// sessions. The payload's own SET sequences follow and re-enable whatever
// the new session needs.
//
//   ?1049 — alt buffer (first, so `CSI 3 J` targets the normal buffer)
//   ?9, ?1000, ?1002, ?1003 — mouse tracking protocols
//   ?1004 — focus event reporting
//   ?1005, ?1006, ?1015, ?1016 — mouse coordinate encodings
//   ?2004 — bracketed paste
//   CSI 3 J — clear scrollback (on the normal buffer; the payload re-dumps it)
//   ?1 cursor keys, ?66 keypad (DECNKM), 4 insert (IRM), ?6 origin,
//   ?45 reverse-wrap off; ?7 autowrap on
//
// See docs/done-bug-mouse-mode-leak-on-session-switch.md.
export const STATE_FULL_PREFIX = '\x1b[?1049l'
  + '\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l'
  + '\x1b[?1004l'
  + '\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1016l'
  + '\x1b[?2004l'
  + '\x1b[3J'
  + '\x1b[?1l\x1b[?66l\x1b[4l\x1b[?6l\x1b[?45l\x1b[?7h';
