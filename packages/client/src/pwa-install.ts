// PWA install prompt capture — side-effect module.
// Import early (e.g. from main.tsx) so the beforeinstallprompt listener
// is registered before the browser fires the event.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

const INSTALL_HINT_KEY = 'mobitty-install-hint-shown';

let deferredPrompt: BeforeInstallPromptEvent | undefined;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // suppress mini-infobar
  deferredPrompt = e;
});

interface NavigatorStandalone extends Navigator {
  standalone?: boolean;
}

export function isStandaloneMode(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  if ((navigator as NavigatorStandalone).standalone === true) return true;
  return false;
}

export function hasDeferredInstallPrompt(): boolean {
  return deferredPrompt !== undefined;
}

export async function triggerInstallPrompt(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const event = deferredPrompt;
  deferredPrompt = undefined;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome === 'accepted';
  } catch {
    return false;
  }
}

export function wasInstallHintShown(): boolean {
  try {
    return localStorage.getItem(INSTALL_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function markInstallHintShown(): void {
  try {
    localStorage.setItem(INSTALL_HINT_KEY, '1');
  } catch {
    // localStorage unavailable — hint may repeat
  }
}
