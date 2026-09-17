// Autocorrect — the three DOM attributes that make up what a user calls
// "autocorrect", kept together so every text-entry surface flips all three in
// lockstep.
//
// These fields carry text that goes straight to a PTY or to disk, so the
// attributes were hardcoded off for a long time: iOS autocorrect mangles
// flags, paths and identifiers. They are now driven by the `autocorrect`
// profile setting (default on) plus an in-session override, because the other
// half of what gets typed here is prose — prompts, commit messages, file
// content.
//
// Scope: the three text-entry boxes only (inline input, input panel, remote
// editor). Typing straight into the terminal goes through xterm's own helper
// textarea, which hardcodes these attributes off internally; letting
// autocorrection touch that node would inject corrected words and smart
// punctuation directly into the PTY byte stream.

export interface AutocorrectAttrs {
  spellCheck: boolean;
  autoCapitalize: 'sentences' | 'off';
  autoCorrect: 'on' | 'off';
}

// Note: WebKit derives smartQuotesType/smartDashesType from the `autocorrect`
// attribute — there is no separate web attribute — so enabling this also
// enables curly quotes and em-dashes. That is the main reason the per-session
// toggle exists next to the setting.
export function autocorrectAttrs(enabled: boolean): AutocorrectAttrs {
  return enabled
    ? { spellCheck: true, autoCapitalize: 'sentences', autoCorrect: 'on' }
    : { spellCheck: false, autoCapitalize: 'off', autoCorrect: 'off' };
}
