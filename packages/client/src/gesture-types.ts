// Gesture types, constants, defaults, and UI helpers.

export type GestureDirection = 'up' | 'down' | 'left' | 'right';

export type SwipeGestureId = `swipe-${1 | 2 | 3}-${GestureDirection}`;
export type FlickGestureId = `flick-1-${GestureDirection}`;
export type GestureId = SwipeGestureId | FlickGestureId
  | 'double-tap' | 'triple-tap' | 'long-press'
  | 'pinch-in' | 'pinch-out' | 'rotate-cw' | 'rotate-ccw';

/** Maps gesture IDs to softkey key IDs. Absent = disabled. */
export type GestureMapping = Partial<Record<GestureId, string>>;

const DIRECTIONS: readonly GestureDirection[] = ['up', 'down', 'left', 'right'];

function swipeIds(fingers: 1 | 2 | 3): SwipeGestureId[] {
  return DIRECTIONS.map(d => `swipe-${fingers}-${d}` as SwipeGestureId);
}

function flickIds(): FlickGestureId[] {
  return DIRECTIONS.map(d => `flick-1-${d}` as FlickGestureId);
}

export const ALL_GESTURE_IDS: readonly GestureId[] = [
  ...swipeIds(1), ...flickIds(), ...swipeIds(2), ...swipeIds(3),
  'double-tap', 'triple-tap', 'long-press',
  'pinch-in', 'pinch-out', 'rotate-cw', 'rotate-ccw',
];

export const VALID_GESTURE_IDS = new Set<string>(ALL_GESTURE_IDS);

export const GESTURE_LABELS: Record<GestureId, string> = {
  'swipe-1-up': '1-finger swipe up',
  'swipe-1-down': '1-finger swipe down',
  'swipe-1-left': '1-finger swipe left',
  'swipe-1-right': '1-finger swipe right',
  'flick-1-up': '1-finger flick up',
  'flick-1-down': '1-finger flick down',
  'flick-1-left': '1-finger flick left',
  'flick-1-right': '1-finger flick right',
  'swipe-2-up': '2-finger swipe up',
  'swipe-2-down': '2-finger swipe down',
  'swipe-2-left': '2-finger swipe left',
  'swipe-2-right': '2-finger swipe right',
  'swipe-3-up': '3-finger swipe up',
  'swipe-3-down': '3-finger swipe down',
  'swipe-3-left': '3-finger swipe left',
  'swipe-3-right': '3-finger swipe right',
  'double-tap': 'Double-tap',
  'triple-tap': 'Triple-tap',
  'long-press': 'Long-press',
  'pinch-in': 'Pinch in',
  'pinch-out': 'Pinch out',
  'rotate-cw': 'Rotate clockwise',
  'rotate-ccw': 'Rotate counter-clockwise',
};

export interface GestureGroup {
  label: string;
  gestures: GestureId[];
}

export const GESTURE_GROUPS: readonly GestureGroup[] = [
  { label: '1-Finger Swipe', gestures: [...swipeIds(1)] },
  { label: '1-Finger Flick', gestures: [...flickIds()] },
  { label: '2-Finger Swipe', gestures: [...swipeIds(2)] },
  { label: '3-Finger Swipe', gestures: [...swipeIds(3)] },
  { label: 'Taps', gestures: ['double-tap', 'triple-tap'] },
  { label: 'Press', gestures: ['long-press'] },
  { label: 'Pinch', gestures: ['pinch-in', 'pinch-out'] },
  { label: 'Rotate', gestures: ['rotate-cw', 'rotate-ccw'] },
];

export const DEFAULT_GESTURE_MAPPING: GestureMapping = {};
