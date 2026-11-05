// Holds the iPhone Duo screen pose the iOS app sends and mirrors it onto
// `#root` as `data-duo-shape` / `data-duo-folded` and the `--duo-*` rect
// variables (src/screen-pose.ts). Returns null off the Duo, on apps without
// `screenPose`, and outside the iOS shell.
//
// On the open Duo, full-screen panels dock in a pane: `useDuoDockFrame`
// writes the frame-relative `--duo-dock-*` rects on `.terminal-frame`, and
// each panel root takes `data-duo-dock={useDuoDock(panel)}`; index.css
// places `[data-duo-dock]` by those variables.
//
// In tabletop (`useTabletop`) the terminal stays in pane A and pane B
// shows the session list while no keyboard is up.

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  getNativeBridge, lastKeyboardMode, subscribeKeyboardMode, type KeyboardMode, type ScreenPosePayload,
} from '@/native-bridge';
import {
  applyDuoDockVars, applyDuoRootState, dockAttr, duoDockVars, duoRootState, isPaneBTextField, isTabletop, panelDock,
  parseScreenPose, tabletopLift, tabletopPaneB, tabletopSystemKeyboardUp, type DuoPanel,
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

export interface TabletopState {
  /// What pane B shows with no panel open there (`tabletopPaneB`):
  /// `sessions` while no keyboard is up, `blank` under one and off tabletop.
  paneB: 'sessions' | 'blank';
  /// A pane-B panel's text field raised the system keyboard: that panel
  /// sits in pane A until the keyboard goes (`tabletopLift`). App sets
  /// `data-duo-lift` on the terminal frame; index.css moves the pane-B
  /// panel holding the focus (`:focus-within`) to pane A's dock rect.
  lift: boolean;
}

/// Tabletop state from the app's keyboard mode, the visual viewport's height
/// (the system keyboard) and the focus. "Typing in pane B" starts when a text
/// field in a pane-B panel takes the focus and ends when the focus moves to
/// another element or the system keyboard goes down, so a field that blurs
/// first (a rename committed) does not flash pane B blank under the
/// keyboard on its way down.
export function useTabletop(pose: ScreenPosePayload | null): TabletopState {
  const [mode, setMode] = useState<KeyboardMode | null>(lastKeyboardMode);
  const [vvHeight, setVvHeight] = useState(() => window.visualViewport?.height ?? window.innerHeight);
  const [paneBTyping, setPaneBTyping] = useState(false);
  const tabletop = isTabletop(pose);
  const poseRef = useRef(pose);
  poseRef.current = pose;

  useEffect(() => subscribeKeyboardMode(setMode), []);

  useEffect(() => {
    if (!tabletop) return;
    const vv = window.visualViewport;
    let wasUp = vv ? tabletopSystemKeyboardUp(poseRef.current, vv.height) : false;
    const update = () => {
      if (!vv) return;
      setVvHeight(vv.height);
      const up = tabletopSystemKeyboardUp(poseRef.current, vv.height);
      if (wasUp && !up) setPaneBTyping(false);
      wasUp = up;
    };
    const onFocusIn = (e: FocusEvent) => {
      setPaneBTyping(e.target instanceof HTMLElement && isPaneBTextField(e.target));
    };
    update();
    setPaneBTyping(document.activeElement instanceof HTMLElement && isPaneBTextField(document.activeElement));
    vv?.addEventListener('resize', update);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      vv?.removeEventListener('resize', update);
      document.removeEventListener('focusin', onFocusIn);
      setPaneBTyping(false);
    };
  }, [tabletop]);

  return {
    paneB: tabletopPaneB(pose, mode, vvHeight, paneBTyping),
    lift: tabletopLift(pose, vvHeight, paneBTyping),
  };
}
