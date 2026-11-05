// The iPhone Duo screen pose the iOS app sends (`mobittyNative.screenPose`,
// `onScreenPose`), and what the web client derives from it: the `data-duo-*`
// attributes and `--duo-*` variables on `#root`, and which pane a panel
// docks in. Pure; the hook in hooks/use-screen-pose.ts applies it.
// See docs/todo-design-ios-iphone-duo.md (Panels).

import type { DuoShape, KeyboardMode, PoseRect, ScreenPosePayload } from './native-bridge.ts';

const SHAPES: readonly DuoShape[] = ['column', 'columnTurned', 'wide', 'tall'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isShape(value: unknown): value is DuoShape {
  return typeof value === 'string' && SHAPES.some((s) => s === value);
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseRect(value: unknown): PoseRect | null {
  if (!isRecord(value)) return null;
  const x = finite(value.x);
  const y = finite(value.y);
  const w = finite(value.w);
  const h = finite(value.h);
  if (x === null || y === null || w === null || h === null) return null;
  if (w < 0 || h < 0) return null;
  return { x, y, w, h };
}

/// A rect field that may be null. `undefined` result means malformed.
function parseOptionalRect(value: unknown): PoseRect | null | undefined {
  if (value === null) return null;
  return parseRect(value) ?? undefined;
}

/// The pose from the bridge, or null when absent or malformed (treated as
/// off the Duo: today's layout).
export function parseScreenPose(value: unknown): ScreenPosePayload | null {
  if (!isRecord(value)) return null;
  const { shape, folded } = value;
  if (!isShape(shape) || typeof folded !== 'boolean') return null;
  const paneA = parseRect(value.paneA);
  const band = parseOptionalRect(value.band);
  const paneB = parseOptionalRect(value.paneB);
  if (paneA === null || band === undefined || paneB === undefined) return null;
  return { shape, folded, band, paneA, paneB };
}

export function isOpenShape(shape: DuoShape): boolean {
  return shape === 'wide' || shape === 'tall';
}

/// Tabletop: open tall with the band active. The terminal stays in pane A
/// (the standing half) and nothing resizes when a keyboard comes or goes.
export function isTabletop(pose: ScreenPosePayload | null): boolean {
  return pose !== null && pose.shape === 'tall' && pose.folded && pose.paneB !== null;
}

/// Tabletop with the system keyboard over pane B: the visual viewport ends
/// above pane B's top (the WebView keeps its height, only `visualViewport`
/// shrinks to the keyboard's top). False off tabletop.
export function tabletopSystemKeyboardUp(pose: ScreenPosePayload | null, vvHeight: number): boolean {
  return isTabletop(pose) && pose?.paneB != null && vvHeight < pose.paneB.y;
}

/// What pane B shows in tabletop with no panel open there: the session list
/// while no keyboard is up (*Decisions* 2), blank under a keyboard. The
/// terminal keyboard is up in mode `terminal`; the system keyboard when
/// `tabletopSystemKeyboardUp`. `paneBTyping` (a text field in a pane-B
/// panel raised the system keyboard; that panel sits in pane A meanwhile,
/// `tabletopLift`): the system keyboard does not count, so the session list
/// being typed in (renaming) stays open. Off tabletop: blank (no resting
/// list).
export function tabletopPaneB(
  pose: ScreenPosePayload | null,
  mode: KeyboardMode | null,
  vvHeight: number,
  paneBTyping = false,
): 'sessions' | 'blank' {
  if (!isTabletop(pose)) return 'blank';
  if (mode === 'terminal') return 'blank';
  if (paneBTyping) return 'sessions';
  return tabletopSystemKeyboardUp(pose, vvHeight) ? 'blank' : 'sessions';
}

/// Tabletop: the pane-B panel holding the focused text field moves to pane
/// A while the system keyboard it raised covers pane B, so the field stays
/// in sight; it returns when the keyboard goes. Same rule as the typing
/// panels (remote editor, fullscreen input), which sit in pane A in
/// tabletop. The terminal does not move: its box is pane A's either way.
export function tabletopLift(pose: ScreenPosePayload | null, vvHeight: number, paneBTyping: boolean): boolean {
  return paneBTyping && tabletopSystemKeyboardUp(pose, vvHeight);
}

/// The slice of a focused element `isPaneBTextField` reads.
export interface FocusTarget {
  tagName: string;
  type?: string;
  readOnly?: boolean;
  disabled?: boolean;
  isContentEditable?: boolean;
  closest(selector: string): unknown;
}

const NON_TEXT_INPUTS: ReadonlySet<string> = new Set([
  'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
]);

/// A focused element that raises the system keyboard (a writable text
/// input, textarea or contenteditable) inside a panel docked in pane B
/// (`data-duo-dock="b"`).
export function isPaneBTextField(el: FocusTarget | null): boolean {
  if (!el || el.readOnly === true || el.disabled === true) return false;
  const tag = el.tagName.toUpperCase();
  const text = tag === 'TEXTAREA' || el.isContentEditable === true
    || (tag === 'INPUT' && !NON_TEXT_INPUTS.has((el.type ?? 'text').toLowerCase()));
  return text && el.closest('[data-duo-dock="b"]') != null;
}

// --- #root state ---

export interface DuoRootState {
  attrs: Record<string, string>;
  vars: Record<string, string>;
}

export const DUO_ROOT_ATTRS = ['data-duo-shape', 'data-duo-folded'] as const;

const RECT_NAMES = ['band', 'pane-a', 'pane-b'] as const;
const RECT_KEYS = ['x', 'y', 'w', 'h'] as const;

export const DUO_ROOT_VARS: readonly string[] = RECT_NAMES.flatMap((name) =>
  RECT_KEYS.map((key) => `--duo-${name}-${key}`),
);

function rectVars(name: (typeof RECT_NAMES)[number], rect: PoseRect | null, out: Record<string, string>): void {
  if (!rect) return;
  for (const key of RECT_KEYS) out[`--duo-${name}-${key}`] = `${rect[key]}px`;
}

/// `data-duo-shape` / `data-duo-folded` and the `--duo-{band,pane-a,pane-b}-{x,y,w,h}`
/// variables (px, window coordinates). Empty off the Duo; a null rect has no
/// variables.
export function duoRootState(pose: ScreenPosePayload | null): DuoRootState {
  const attrs: Record<string, string> = {};
  const vars: Record<string, string> = {};
  if (!pose) return { attrs, vars };
  attrs['data-duo-shape'] = pose.shape;
  attrs['data-duo-folded'] = String(pose.folded);
  rectVars('band', pose.band, vars);
  rectVars('pane-a', pose.paneA, vars);
  rectVars('pane-b', pose.paneB, vars);
  return { attrs, vars };
}

/// The slice of HTMLElement `applyDuoRootState` touches.
export interface DuoRootTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): string;
  };
}

/// Writes `state` onto `el`, removing any `data-duo-*` / `--duo-*` it no
/// longer lists.
export function applyDuoRootState(el: DuoRootTarget, state: DuoRootState): void {
  for (const name of DUO_ROOT_ATTRS) {
    const value = state.attrs[name];
    if (value === undefined) el.removeAttribute(name);
    else el.setAttribute(name, value);
  }
  for (const name of DUO_ROOT_VARS) {
    const value = state.vars[name];
    if (value === undefined) el.style.removeProperty(name);
    else el.style.setProperty(name, value);
  }
}

// --- Panels ---

export type DuoPanel = 'sessions' | 'settings' | 'shell' | 'editor' | 'input' | 'viewer';
export type DuoDock = 'full' | 'paneA' | 'paneB';

/// Where a full-screen panel sits (the design's Panels table): on the open
/// Duo, sessions/settings/shell picker/file viewer take pane B; the remote
/// editor and fullscreen input take pane B wide and pane A tall (the
/// keyboard is in or over pane B). Closed or off the Duo: the whole
/// terminal area.
export function panelDock(pose: ScreenPosePayload | null, panel: DuoPanel): DuoDock {
  if (!pose || !isOpenShape(pose.shape)) return 'full';
  const typing = panel === 'editor' || panel === 'input';
  const dock: DuoDock = typing && pose.shape === 'tall' ? 'paneA' : 'paneB';
  const rect = dock === 'paneA' ? pose.paneA : pose.paneB;
  return rect ? dock : 'full';
}

export interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DockRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/// The dock's rect relative to the terminal frame (`frame` in window
/// coordinates, e.g. its `getBoundingClientRect()`). Wide: x/width from the
/// pane, top/height from the frame. Tall: top from the pane, bottom = the
/// lower of the pane's and the frame's bottoms; x/width from the frame.
/// `full`, or a pane the pose lacks: the whole frame.
export function dockRect(pose: ScreenPosePayload | null, dock: DuoDock, frame: DOMRectLike): DockRect {
  const whole: DockRect = { left: 0, top: 0, width: frame.width, height: frame.height };
  if (!pose || dock === 'full' || !isOpenShape(pose.shape)) return whole;
  const pane = dock === 'paneA' ? pose.paneA : pose.paneB;
  if (!pane) return whole;
  if (pose.shape === 'wide') {
    return { left: pane.x - frame.left, top: 0, width: pane.w, height: frame.height };
  }
  const top = Math.max(pane.y, frame.top);
  const bottom = Math.min(pane.y + pane.h, frame.top + frame.height);
  return { left: 0, top: top - frame.top, width: frame.width, height: Math.max(0, bottom - top) };
}

// --- Dock rects on .terminal-frame ---

/// The `data-duo-dock` value a panel root carries: `a` / `b` on the open
/// Duo, absent otherwise (the panel keeps its `inset-0`).
export function dockAttr(dock: DuoDock): 'a' | 'b' | undefined {
  if (dock === 'paneA') return 'a';
  if (dock === 'paneB') return 'b';
  return undefined;
}

const DOCK_NAMES = ['a', 'b'] as const;
const DOCK_KEYS = ['left', 'top', 'width', 'height'] as const;

export const DUO_DOCK_VARS: readonly string[] = DOCK_NAMES.flatMap((name) =>
  DOCK_KEYS.map((key) => `--duo-dock-${name}-${key}`),
);

/// Below this a pane-docked panel would be unusable (tall, with a keyboard
/// reaching into pane B): the dock falls back to the whole frame.
export const MIN_DOCK_HEIGHT = 96;

/// `--duo-dock-{a,b}-{left,top,width,height}` (px, relative to the terminal
/// frame at `frame`, window coordinates) on the open Duo; empty otherwise.
/// A pane the pose lacks has no variables.
export function duoDockVars(pose: ScreenPosePayload | null, frame: DOMRectLike): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!pose || !isOpenShape(pose.shape)) return vars;
  for (const name of DOCK_NAMES) {
    const dock: DuoDock = name === 'a' ? 'paneA' : 'paneB';
    if (!(name === 'a' ? pose.paneA : pose.paneB)) continue;
    let rect = dockRect(pose, dock, frame);
    if (rect.height < MIN_DOCK_HEIGHT) rect = dockRect(pose, 'full', frame);
    for (const key of DOCK_KEYS) vars[`--duo-dock-${name}-${key}`] = `${rect[key]}px`;
  }
  return vars;
}

/// Writes `vars` onto `el`, removing any `--duo-dock-*` it no longer lists.
export function applyDuoDockVars(el: Pick<DuoRootTarget, 'style'>, vars: Record<string, string>): void {
  for (const name of DUO_DOCK_VARS) {
    const value = vars[name];
    if (value === undefined) el.style.removeProperty(name);
    else el.style.setProperty(name, value);
  }
}
