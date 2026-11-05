// Holds the iPhone Duo screen pose the iOS app sends and mirrors it onto
// `#root` as `data-duo-shape` / `data-duo-folded` and the `--duo-*` rect
// variables (src/screen-pose.ts). Returns null off the Duo, on apps without
// `screenPose`, and outside the iOS shell.

import { useEffect, useState } from 'react';
import { getNativeBridge, type ScreenPosePayload } from '@/native-bridge';
import { applyDuoRootState, duoRootState, parseScreenPose } from '@/screen-pose';

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
