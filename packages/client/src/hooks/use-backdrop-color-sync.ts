// Tells the iOS shell what color to paint behind the WebView so the system
// keyboard's rounded top corners blend with the softkey bar instead of
// showing two black notches. Reads the bar's rendered background color,
// composites the 0.92 alpha over the body background, and posts the
// resulting solid color to `mobittyNative.setBackdropColor`. Also posts the
// raw body background to `mobittyNative.setBodyBgColor`, which the shell
// paints into the top safe-area strip so the status-bar background blends
// with the terminal area below it. Re-posts on `(prefers-color-scheme)`
// flips. No-ops outside the iOS shell.

import { useEffect, type RefObject } from 'react';
import { getNativeBridge } from '@/native-bridge';

interface ParsedColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

const RGB_PATTERN =
  /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d+(?:\.\d+)?%?))?\s*\)$/;

function parseRgb(s: string): ParsedColor | null {
  const m = s.trim().match(RGB_PATTERN);
  if (!m) return null;
  const [, rs, gs, bs, asRaw] = m;
  let a = 1;
  if (asRaw !== undefined) {
    a = asRaw.endsWith('%')
      ? Number(asRaw.slice(0, -1)) / 100
      : Number(asRaw);
  }
  return {
    r: Number(rs),
    g: Number(gs),
    b: Number(bs),
    a,
  };
}

// Standard "source-over" composite of `top` onto an opaque `bottom`.
function compositeOverOpaque(top: ParsedColor, bottom: ParsedColor): ParsedColor {
  const blend = (t: number, b: number): number => t * top.a + b * (1 - top.a);
  return {
    r: blend(top.r, bottom.r),
    g: blend(top.g, bottom.g),
    b: blend(top.b, bottom.b),
    a: 1,
  };
}

function formatRgb(c: ParsedColor): string {
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}

export function useBackdropColorSync(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const post = (): void => {
      const bridge = getNativeBridge();
      if (!bridge?.setBackdropColor) return;
      const el = ref.current;
      if (!el) return;
      const bar = parseRgb(getComputedStyle(el).backgroundColor);
      if (!bar) return;
      const bodyRaw = getComputedStyle(document.body).backgroundColor;
      const body = parseRgb(bodyRaw);
      if (body) {
        // Body bg drives the iOS top safe-area paint. Send opaque so the
        // shell doesn't have to composite.
        bridge.setBodyBgColor?.(formatRgb({ ...body, a: 1 }));
      }
      if (bar.a >= 1) {
        bridge.setBackdropColor(formatRgb(bar));
        return;
      }
      if (!body) {
        // Body bg unparseable (e.g. unresolved oklch on an old engine) —
        // send the bar verbatim. iOS will composite over UIWindow black,
        // ~7% darker than ideal but still not a black notch.
        bridge.setBackdropColor(getComputedStyle(el).backgroundColor);
        return;
      }
      bridge.setBackdropColor(formatRgb(compositeOverOpaque(bar, { ...body, a: 1 })));
    };

    // First post is deferred a frame so initial CSS-variable resolution and
    // layout have settled.
    const raf = requestAnimationFrame(post);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      requestAnimationFrame(post);
    };
    mq.addEventListener('change', onChange);
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener('change', onChange);
    };
  }, [ref]);
}
