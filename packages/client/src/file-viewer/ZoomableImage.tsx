// Image preview with in-app zoom. The page viewport is `user-scalable=no`
// (the terminal needs it), so browser pinch-zoom never reaches the image:
// zoom is a scale on the fitted width, and the scroll container pans.
// Pinch (touch), ctrl+wheel and trackpad pinch (desktop), double-tap or
// double-click, and the corner buttons all drive it.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Padding around the image, in px (`p-6`). */
const PAD = 24;
const STEP = 1.5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 30;

interface Anchor {
  /** Fraction of the image under the focal point. */
  fx: number;
  fy: number;
  /** Focal point, relative to the scroller's viewport. */
  px: number;
  py: number;
}

interface ZoomableImageProps {
  src: string;
  alt: string;
  onLoad: (w: number, h: number) => void;
}

export function ZoomableImage({ src, alt, onLoad }: ZoomableImageProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [availW, setAvailW] = useState(0);
  const [scale, setScale] = useState(1);
  const anchorRef = useRef<Anchor | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvailW(Math.max(1, el.clientWidth - 2 * PAD)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit = the image's own width, shrunk to the panel. Scale multiplies it.
  const base = natural ? Math.min(natural.w, availW || natural.w) : 0;
  const maxScale = natural && base ? Math.max(4, Math.min(4 * natural.w, 8192) / base) : 1;

  // Live values for the native listeners, which are bound once.
  const live = useRef({ scale, maxScale, base });
  live.current = { scale, maxScale, base };

  /** Zoom to `next`, keeping the image point under (clientX, clientY) there. */
  const zoomAt = useCallback((next: number, clientX: number, clientY: number, from?: { fx: number; fy: number }) => {
    const scroller = scrollerRef.current;
    const img = imgRef.current;
    if (!scroller || !img) return;
    const clamped = Math.min(live.current.maxScale, Math.max(1, next));
    const sr = scroller.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    anchorRef.current = {
      fx: from?.fx ?? (clientX - ir.left) / ir.width,
      fy: from?.fy ?? (clientY - ir.top) / ir.height,
      px: clientX - sr.left,
      py: clientY - sr.top,
    };
    setScale(clamped);
  }, []);

  // After the new width lays out, scroll so the anchor stays put.
  useLayoutEffect(() => {
    const a = anchorRef.current;
    const scroller = scrollerRef.current;
    const img = imgRef.current;
    if (!a || !scroller || !img) return;
    anchorRef.current = null;
    scroller.scrollLeft = img.offsetLeft + a.fx * img.offsetWidth - a.px;
    scroller.scrollTop = img.offsetTop + a.fy * img.offsetHeight - a.py;
  }, [scale]);

  const toggleAt = useCallback((clientX: number, clientY: number) => {
    const { scale: s, base: b } = live.current;
    const img = imgRef.current;
    if (s > 1 || !img) { zoomAt(1, clientX, clientY); return; }
    zoomAt(Math.max(2, img.naturalWidth / b), clientX, clientY);
  }, [zoomAt]);

  // Native listeners: wheel and touchmove must be non-passive to cancel the
  // browser's own handling.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    let pinch: { dist: number; scale: number; fx: number; fy: number } | null = null;
    let lastTap: { t: number; x: number; y: number } | null = null;
    let tapStart: { x: number; y: number } | null = null;
    let gestureScale = 1;

    // Callers check `touches.length === 2` first.
    const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const mid = (t: TouchList) => ({ x: (t[0]!.clientX + t[1]!.clientX) / 2, y: (t[0]!.clientY + t[1]!.clientY) / 2 });

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const img = imgRef.current;
        if (!img) return;
        const m = mid(e.touches);
        const ir = img.getBoundingClientRect();
        pinch = { dist: dist(e.touches), scale: live.current.scale, fx: (m.x - ir.left) / ir.width, fy: (m.y - ir.top) / ir.height };
        tapStart = null;
        lastTap = null;
      } else if (e.touches.length === 1) {
        tapStart = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
      } else {
        tapStart = null;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        const m = mid(e.touches);
        zoomAt(pinch.scale * (dist(e.touches) / pinch.dist), m.x, m.y, pinch);
      } else if (tapStart && e.touches.length === 1) {
        const t = e.touches[0]!;
        if (Math.hypot(t.clientX - tapStart.x, t.clientY - tapStart.y) > DOUBLE_TAP_SLOP) tapStart = null;
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
      if (e.touches.length > 0 || !tapStart) return;
      const now = performance.now();
      const { x, y } = tapStart;
      tapStart = null;
      if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < DOUBLE_TAP_SLOP) {
        e.preventDefault(); // no synthesized dblclick on top
        lastTap = null;
        toggleAt(x, y);
      } else {
        lastTap = { t: now, x, y };
      }
    };
    // Chrome and Firefox report trackpad pinch as ctrl+wheel.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(live.current.scale * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };
    // Desktop Safari reports trackpad pinch as gesture events. iOS fires them
    // too, alongside the touches handled above, so they only cancel there.
    type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScale = live.current.scale;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (pinch) return;
      const g = e as GestureEvent;
      zoomAt(gestureScale * g.scale, g.clientX, g.clientY);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchEnd);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, [zoomAt, toggleAt]);

  const zoomCenter = (next: number) => {
    const r = scrollerRef.current?.getBoundingClientRect();
    if (r) zoomAt(next, r.left + r.width / 2, r.top + r.height / 2);
  };

  const width = base ? base * scale : undefined;
  // Percent of the image's real pixels, so 100% means 1:1.
  const percent = natural && width ? Math.round((width / natural.w) * 100) : null;

  return (
    <div className="relative h-full">
      <div ref={scrollerRef} className="h-full overflow-auto" style={{ touchAction: 'pan-x pan-y' }}>
        <div className="fv-checker relative flex min-h-full min-w-full w-max p-6">
          <img
            ref={imgRef}
            src={src}
            alt={alt}
            draggable={false}
            className={cn('m-auto h-auto select-none', !width && 'max-w-full')}
            style={width ? { width, maxWidth: 'none' } : undefined}
            onDoubleClick={e => toggleAt(e.clientX, e.clientY)}
            onLoad={e => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
              setNatural({ w, h });
              onLoad(w, h);
            }}
          />
        </div>
      </div>
      {natural && (
        <div className="absolute bottom-3 right-3 flex items-center rounded-md border border-border bg-background/90 text-xs text-muted-foreground shadow-sm">
          <button type="button" className="px-2 py-1.5 disabled:opacity-40" aria-label="Zoom out"
            disabled={scale <= 1} onClick={() => zoomCenter(scale / STEP)}>
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="min-w-12 px-1 py-1 tabular-nums" title="Fit to panel"
            onClick={() => zoomCenter(1)}>
            {percent}%
          </button>
          <button type="button" className="px-2 py-1.5 disabled:opacity-40" aria-label="Zoom in"
            disabled={scale >= maxScale} onClick={() => zoomCenter(scale * STEP)}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
