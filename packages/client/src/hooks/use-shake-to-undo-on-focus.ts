// Tells the iOS shell to enable shake-to-undo while the wrapped textarea is
// focused. Native default is off (the WKWebView's "Undo Typing" alert can't
// reach xterm's helper textarea); we only flip it on for textareas where
// WebKit's edit history actually does something useful — currently the
// remote editor and the mobile batch-input panel.
//
// Native independently resets to false on page navigation start and on app
// backgrounding (see MobittyApp.scenePhase + WebViewCoordinator's
// didStartProvisionalNavigation). The hook also fires a defensive `false` on
// unmount in case the component is removed while still focused (no `blur`
// event would have a chance to fire).
//
// No-ops outside the iOS shell.

import { useEffect, type RefObject } from 'react';
import { getNativeBridge } from '@/native-bridge';

export function useShakeToUndoOnFocus(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const bridge = getNativeBridge();
    if (!bridge?.setShakeToUndo) return;
    const el = ref.current;
    if (!el) return;
    const set = bridge.setShakeToUndo;

    const onFocus = (): void => set(true);
    const onBlur = (): void => set(false);
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);

    // If autofocus already landed before this effect attached, reflect it
    // immediately — the focus event already fired.
    if (document.activeElement === el) {
      set(true);
    }

    return () => {
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', onBlur);
      // Unmount-while-focused: blur would fire after cleanup runs and the
      // element may already be detached. Disable now so the flag doesn't
      // get stuck on.
      set(false);
    };
  }, [ref]);
}
