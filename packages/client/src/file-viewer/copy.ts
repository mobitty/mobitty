// Copy text to the clipboard from a user gesture. The native bridge comes
// first: `navigator.clipboard.writeText` is blocked in the iOS app's WKWebView
// (see native-bridge.ts `writeClipboard`). `execCommand('copy')` covers plain
// HTTP on a LAN, where the async Clipboard API is unavailable.

import { getNativeBridge } from '@/native-bridge';

export async function copyText(text: string): Promise<boolean> {
  const bridge = getNativeBridge();
  if (bridge?.writeClipboard) {
    try {
      bridge.writeClipboard(text);
      return true;
    } catch { /* fall through */ }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* fall through */ }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch { /* ignore */ }
  textarea.remove();
  return copied;
}
