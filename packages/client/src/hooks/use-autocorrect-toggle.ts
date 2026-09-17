// Runs the autocorrect toggle for one textarea.
//
// iOS WebKit reads a field's text-input traits when it *gains focus*. Changing
// the attributes on an already-focused textarea does nothing until it is
// refocused — which is exactly the case that matters: toggling mid-typing with
// the keyboard up. So the toggle has to blur and refocus the field.
//
// Two ordering constraints make this a synchronous event-handler job rather
// than an effect:
//
//   1. The attributes must already be in the DOM before blur() — hence
//      flushSync around the state update. (Same reasoning as the remote-editor
//      commit in App.tsx: don't hand discrete work to React's scheduler. A
//      WKWebView once starved that scheduler for 12.2 s, and a blur/focus pair
//      landing 12 s late would yank the keyboard mid-typing.)
//   2. iOS only re-raises the keyboard for a programmatic focus() inside a
//      user gesture, and the activation token only propagates through the
//      gesture's synchronous call stack.
//
// The `document.activeElement` guard is load-bearing, not just an
// optimization: in the iOS shell's terminal/dismissed keyboard modes the
// native side has already blurred everything, and refocusing there would raise
// the system keyboard behind the custom terminal keyboard.

import { useCallback, type RefObject } from 'react';
import { flushSync } from 'react-dom';

export function useAutocorrectToggle(
  ref: RefObject<HTMLTextAreaElement | null>,
  onToggle: () => void,
): () => void {
  return useCallback(() => {
    const el = ref.current;
    const refocus = el !== null && document.activeElement === el;
    const selectionStart = el?.selectionStart ?? 0;
    const selectionEnd = el?.selectionEnd ?? 0;
    const scrollTop = el?.scrollTop ?? 0;

    flushSync(onToggle);

    if (refocus && el) {
      el.blur();
      el.focus({ preventScroll: true });
      el.setSelectionRange(selectionStart, selectionEnd);
      el.scrollTop = scrollTop;
    }
  }, [ref, onToggle]);
}
