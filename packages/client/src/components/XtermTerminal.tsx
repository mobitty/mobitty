import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { TerminalCore, type TerminalCoreOptions, type TerminalCoreCallbacks, type ModifierSource } from '@/terminal-core';
import { DEFAULT_SOFTKEY_SETTINGS, type Profile, type ProfileTheme } from '@/profiles';
import type { GestureMapping } from '@/gesture-types';
import type { KeySpec } from '@/softkey-types';

export interface XtermTerminalHandle {
  core: TerminalCore | null;
}

interface XtermTerminalProps {
  options: TerminalCoreOptions;
  profile?: Profile;
  themeColors?: ProfileTheme;
  isMobile?: boolean;
  modifierSource?: ModifierSource;
  callbacks?: TerminalCoreCallbacks;
  gestureMapping?: GestureMapping;
  customKeyMap?: Map<string, KeySpec>;
}

export const XtermTerminal = forwardRef<XtermTerminalHandle, XtermTerminalProps>(
  function XtermTerminal({ options, profile, themeColors, isMobile, modifierSource, callbacks, gestureMapping, customKeyMap }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const coreRef = useRef<TerminalCore | null>(null);

    useImperativeHandle(ref, () => ({
      get core() { return coreRef.current; },
    }), []);

    // Create terminal on mount
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const core = new TerminalCore(options);
      coreRef.current = core;
      core.open(container);
      core.refreshToken().then(() => core.connect());

      return () => {
        core.dispose();
        coreRef.current = null;
      };
      // Only run on mount
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Update modifier source
    useEffect(() => {
      coreRef.current?.setModifierSource(modifierSource);
    }, [modifierSource]);

    // Update callbacks
    useEffect(() => {
      if (coreRef.current && callbacks) {
        coreRef.current.callbacks = callbacks;
      }
    }, [callbacks]);

    // Apply profile changes
    useEffect(() => {
      if (profile && coreRef.current) {
        coreRef.current.applyProfile(profile, themeColors, isMobile);
        coreRef.current.setScrollback(profile.scrollback);
        coreRef.current.setSoftkeySettings(profile.softkeySettings ?? DEFAULT_SOFTKEY_SETTINGS);
        coreRef.current.setImagePasteDir(profile.imagePasteDir ?? 'tmp');
        coreRef.current.setNotificationMode(profile.notificationMode);
      }
    }, [profile, themeColors, isMobile]);

    // Update gesture mapping
    useEffect(() => {
      if (gestureMapping) {
        coreRef.current?.setGestureMapping(gestureMapping);
      }
    }, [gestureMapping]);

    // Update custom key map
    useEffect(() => {
      if (customKeyMap) {
        coreRef.current?.setCustomKeyMap(customKeyMap);
      }
    }, [customKeyMap]);

    return (
      <div
        ref={containerRef}
        className="absolute inset-0"
      />
    );
  }
);
