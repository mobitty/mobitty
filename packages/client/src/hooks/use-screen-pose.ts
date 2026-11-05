// Holds the iPhone Duo screen pose the iOS app sends and mirrors it onto
// `#root` as `data-duo-shape` / `data-duo-folded` and the `--duo-*` rect
// variables (src/screen-pose.ts). Returns null off the Duo, on apps without
// `screenPose`, and outside the iOS shell.
//
// On the open Duo, full-screen panels dock in a pane: `useDuoDockFrame`
// writes the frame-relative `--duo-dock-*` rects on `.terminal-frame`, and
// each panel root takes `data-duo-dock={useDuoDock(panel)}`; index.css
// places `[data-duo-dock]` by those variables.

import { createContext, useContext, useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { getNativeBridge, type ScreenPosePayload } from '@/native-bridge';
import {
  applyDuoDockVars, applyDuoRootState, dockAttr, duoDockVars, duoRootState, panelDock, parseScreenPose,
  type DuoPanel,
} from '@/screen-pose';

export function useScreenPose(): ScreenPosePayload | null {
  const [pose, setPose] = useState<ScreenPosePayload | null>(() =>
    parseScreenPose(getNativeBridge()?.screenPose),
  );

  useEffect(() => {
    const bridge = getNativeBridge();
    if (!bridge) return;
    // The pose may have changed between the first render and this effect.
    setPose(parseScreenPose(bridge.screenPose));
    bridge.onScreenPose = (next) => { setPose(parseScreenPose(next)); };
    return () => { bridge.onScreenPose = () => {}; };
  }, []);

  useEffect(() => {
    const root = document.getElementById('root');
    if (root) applyDuoRootState(root, duoRootState(pose));
  }, [pose]);

  return pose;
}

/// The pose, for panels below App (App provides it).
export const ScreenPoseContext = createContext<ScreenPosePayload | null>(null);

/// The `data-duo-dock` value for `panel`'s root: `a` / `b` on the open Duo,
/// undefined (no attribute, whole terminal area) otherwise.
export function useDuoDock(panel: DuoPanel): 'a' | 'b' | undefined {
  return dockAttr(panelDock(useContext(ScreenPoseContext), panel));
}

/// Keeps `--duo-dock-*` on the terminal frame in step with the pose and the
/// frame's box (a keyboard or the batch panel resizes it; the window turns).
export function useDuoDockFrame(frameRef: RefObject<HTMLElement | null>, pose: ScreenPosePayload | null): void {
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => applyDuoDockVars(frame, duoDockVars(pose, frame.getBoundingClientRect()));
    update();
    if (!pose) return;
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    // The frame can move without resizing (the safe-area band above it).
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [frameRef, pose]);
}
