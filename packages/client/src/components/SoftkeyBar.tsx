import { useState, useCallback, useImperativeHandle, forwardRef, useMemo, useRef, useEffect, type ReactNode } from 'react';
import {
  type KeyBehavior, type ModifierFlags, type KeySpec,
  emptyModifiers, getKeySpec, buildCustomKeyMap, buildContainerKeyMap, mergeKeyMaps,
  type SoftkeyCustomKeySpec, type SoftkeyContainerSpec,
} from '@/softkey-types';
import type { ModifierSource } from '@/terminal-core';
import { SoftkeyButton } from '@/components/SoftkeyButton';
import { getBatchInputDraft, setBatchInputDraft } from '@/batch-input-storage';
import { getNativeBridge, type KeyboardMode } from '@/native-bridge';
import {
  buildSoftkeyBarPayload, createDedupedSender, dispatchAppSoftkeyPress,
  runKeyBehavior as runSharedKeyBehavior, type KeyBehaviorHandlers,
} from '@/app-softkey-bar';
import { useBackdropColorSync } from '@/hooks/use-backdrop-color-sync';
import { usePressLongPress } from '@/hooks/use-press-long-press';
import { useAutocorrectToggle } from '@/hooks/use-autocorrect-toggle';
import { ArrowUp, Keyboard, Menu, SpellCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { autocorrectAttrs } from '@/lib/autocorrect';

// --- SoftkeyBar handle ---

export interface SoftkeyBarHandle extends ModifierSource {
  toggleModifier(modifier: keyof ModifierFlags): void;
}

// --- Props ---

interface SoftkeyBarProps {
  pages: string[][];
  customKeys: SoftkeyCustomKeySpec[];
  containers?: SoftkeyContainerSpec[];
  activeContainerId?: string | null;
  batchInputOpen?: boolean;
  softkeySize?: number;
  hasAlerts?: boolean;
  isMobile?: boolean;
  isNativeApp?: boolean;
  autocorrect: boolean;
  onAutocorrectToggle: () => void;
  onSessionsOpen: () => void;
  onMeterToggle: () => void;
  onAction: (action: KeyBehavior, modifiers: ModifierFlags) => void;
  onPaste: () => void;
  onFileUpload: () => void;
  onBatchInputToggle: () => void;
  onBatchSubmit?: (text: string) => void;
  onContainerToggle: (containerId: string) => void;
  onKeepFocus?: () => void;
  onModifiersChange?: (modifiers: ModifierFlags) => void;
  /// The iOS app draws the bar (`appSoftkeyBar` capability): this component
  /// keeps its state and handlers, renders nothing, and drives the app's bar
  /// over `setSoftkeyBar` / `onSoftkeyPress`.
  appBar?: boolean;
  /// The web would hide its bar (hide rule in App). Only consulted with
  /// `appBar`; without it App unmounts the bar instead.
  hidden?: boolean;
  /// The profile's session switcher hotkey, passed to the app's bar.
  sessionHotkey?: string;
}

// --- InlineInput sub-component ---

interface InlineInputProps {
  softkeySize: number;
  autocorrect: boolean;
  onAutocorrectToggle: () => void;
  onSubmit: (text: string) => void;
  onKeepFocus?: () => void;
}

function InlineInput({ softkeySize, autocorrect, onAutocorrectToggle, onSubmit, onKeepFocus }: InlineInputProps) {
  const [draft, setDraft] = useState(() => getBatchInputDraft());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handleAutocorrectToggle = useAutocorrectToggle(textareaRef, onAutocorrectToggle);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setDraft(val);
    setBatchInputDraft(val);
  }, []);

  const handleSubmit = useCallback(() => {
    if (draft !== '') onSubmit(draft);
    onKeepFocus?.();
  }, [draft, onSubmit, onKeepFocus]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  return (
    <div className="flex-1 flex items-end gap-1" data-inline-input>
      <textarea
        ref={textareaRef}
        className="flex-1 rounded border border-input bg-background text-foreground font-mono text-sm resize-none outline-none focus:border-ring px-2 py-1"
        style={{ minHeight: softkeySize }}
        rows={1}
        value={draft}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        {...autocorrectAttrs(autocorrect)}
        aria-label="Inline input"
      />
      <button
        type="button"
        data-autocorrect-toggle
        className={cn(
          'flex items-center justify-center rounded-md shrink-0',
          'transition-colors touch-manipulation select-none',
          autocorrect
            ? 'text-foreground bg-accent'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent',
        )}
        style={{ width: softkeySize, height: softkeySize }}
        tabIndex={-1}
        aria-pressed={autocorrect}
        aria-label={autocorrect ? 'Autocorrect on' : 'Autocorrect off'}
        title={autocorrect ? 'Autocorrect on' : 'Autocorrect off'}
        onPointerUp={handleAutocorrectToggle}
      >
        <SpellCheck className="w-4 h-4" />
      </button>
      <button
        type="button"
        className={cn(
          'flex items-center justify-center rounded-md shrink-0',
          'text-muted-foreground hover:text-foreground hover:bg-accent',
          'transition-colors touch-manipulation select-none',
        )}
        style={{ width: softkeySize, height: softkeySize }}
        tabIndex={-1}
        aria-label="Send input"
        onPointerUp={handleSubmit}
      >
        <ArrowUp className="w-4 h-4" />
      </button>
    </div>
  );
}

// --- SoftkeyBar ---

export const SoftkeyBar = forwardRef<SoftkeyBarHandle, SoftkeyBarProps>(
  function SoftkeyBar({ pages, customKeys, containers, activeContainerId, batchInputOpen, softkeySize = 44, hasAlerts, isMobile, isNativeApp, autocorrect, onAutocorrectToggle, onSessionsOpen, onMeterToggle, onAction, onPaste, onFileUpload, onBatchInputToggle, onBatchSubmit, onContainerToggle, onKeepFocus, onModifiersChange, appBar = false, hidden = false, sessionHotkey = '' }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    useBackdropColorSync(containerRef);
    const [currentPage, setCurrentPage] = useState(0);
    const [modifiers, setModifiers] = useState<ModifierFlags>(emptyModifiers());
    const [keyboardMode, setKeyboardMode] = useState<KeyboardMode>('system');
    const modifiersRef = useRef<ModifierFlags>(emptyModifiers());
    const onModifiersChangeRef = useRef(onModifiersChange);
    onModifiersChangeRef.current = onModifiersChange;
    const onActionRef = useRef(onAction);
    onActionRef.current = onAction;
    // Stable handle to the latest key dispatcher so the native onKeyAction
    // listener (registered once, empty deps) doesn't capture a stale closure.
    const runKeyBehaviorRef = useRef<(behavior: KeyBehavior, consumesModifiers: boolean) => void>(() => {});

    const updateModifiers = useCallback((next: ModifierFlags) => {
      modifiersRef.current = next;
      setModifiers(next);
      onModifiersChangeRef.current?.(next);
    }, []);

    // Stable ref so the native listener doesn't re-register on every render.
    const keepFocusRef = useRef(onKeepFocus);
    keepFocusRef.current = onKeepFocus;

    // Prevent touch/click on softkey bar from stealing focus from terminal.
    // Layer 1 — preventDefault: stops browser from moving focus.
    // Layer 2 — keepFocusRef: immediately re-focuses the terminal textarea so
    //   even if the mobile OS started dismissing the keyboard, focus is restored
    //   before it visually closes.
    // Uses native listeners with { passive: false } because React doesn't
    // guarantee non-passive touch listeners.
    // Exception: the mobile horizontal scroll strip ([data-softkey-scroll]) skips
    // Layer 1 on touchstart and touch-typed pointerdown — preventDefault on those
    // would cancel the gesture and stall native horizontal scroll. Layer 2 still
    // re-focuses the terminal.
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const preventFocusSteal = (e: Event) => {
        const target = e.target as HTMLElement;
        // The autocorrect toggle sits inside [data-inline-input] but needs the
        // opposite treatment from the textarea it accompanies: stop the browser
        // blurring the field (Layer 1) but skip Layer 2, which would hand focus
        // to the terminal. The toggle re-focuses the textarea itself.
        if (target.closest('[data-autocorrect-toggle]')) {
          e.preventDefault();
          return;
        }
        if (target.closest('[data-inline-input]')) return;
        if (target.closest('[data-softkey-scroll]')) {
          const isTouchStart = e.type === 'touchstart';
          const isTouchPointer = e.type === 'pointerdown'
            && (e as PointerEvent).pointerType === 'touch';
          if (isTouchStart || isTouchPointer) {
            keepFocusRef.current?.();
            return;
          }
        }
        e.preventDefault();
        keepFocusRef.current?.();
      };
      el.addEventListener('mousedown', preventFocusSteal);
      el.addEventListener('pointerdown', preventFocusSteal);
      el.addEventListener('touchstart', preventFocusSteal, { passive: false });
      return () => {
        el.removeEventListener('mousedown', preventFocusSteal);
        el.removeEventListener('pointerdown', preventFocusSteal);
        el.removeEventListener('touchstart', preventFocusSteal);
      };
    }, []);


    // Mirror the native keyboard mode locally so the pinned keyboard button
    // can decide which mode to request next. The bridge shim's
    // onKeyboardModeChanged starts as a no-op; we override it here.
    useEffect(() => {
      const bridge = getNativeBridge();
      if (!bridge) return;
      bridge.onKeyboardModeChanged = (mode: KeyboardMode) => setKeyboardMode(mode);
      return () => {
        bridge.onKeyboardModeChanged = () => {};
      };
    }, []);

    // Forward iOS native-keyboard taps into the same TerminalCore dispatch
    // path the web softkey bar uses. The bridge shim's onKeyAction starts as
    // a no-op; without this override every tap on the iOS terminal keyboard
    // is silently dropped on the web side.
    useEffect(() => {
      const bridge = getNativeBridge();
      if (!bridge) return;
      bridge.onKeyAction = (action, mods) => {
        // Native taps carry no modifier info (mods == null): the sticky
        // ctrl/alt/shift state lives here in the softkey bar, not on the iOS
        // side. Route the tap through the same handler the on-screen keys use
        // so it consumes the armed modifiers (arrows, chars) and toggles them
        // (ctrl/alt/shift) — otherwise a modifier armed in the bar is silently
        // dropped when the next key comes from the iOS custom keyboard. A
        // future shell that resolves modifiers itself can pass `mods` to
        // bypass the bar's sticky state.
        if (mods) {
          onActionRef.current(action, mods);
          return;
        }
        runKeyBehaviorRef.current(
          action,
          action.kind === 'send-virtual' || action.kind === 'send-char',
        );
      };
      return () => {
        bridge.onKeyAction = () => {};
      };
    }, []);

    const handleKeyboardToggleTap = useCallback(() => {
      const bridge = getNativeBridge();
      if (!bridge) return;
      // iOS shells that support multiple custom-keyboard layouts own the
      // cycle state machine: tap rotates through layouts, falling through
      // to the system keyboard after the last. Older shells without
      // requestKeyboardCycle keep the simple system↔terminal toggle.
      if (bridge.requestKeyboardCycle) {
        bridge.requestKeyboardCycle();
      } else {
        const next: KeyboardMode = keyboardMode === 'terminal' ? 'system' : 'terminal';
        bridge.requestKeyboardMode(next);
      }
    }, [keyboardMode]);

    const handleKeyboardToggleLongPress = useCallback(() => {
      const bridge = getNativeBridge();
      if (!bridge) return;
      bridge.requestKeyboardMode('dismissed');
    }, []);

    const customKeyMap = useMemo(() => {
      const base = buildCustomKeyMap(customKeys);
      if (containers && containers.length > 0) {
        return mergeKeyMaps(base, buildContainerKeyMap(containers));
      }
      return base;
    }, [customKeys, containers]);

    // Clamp page index when pages change
    const safePage = pages.length > 0 ? currentPage % pages.length : 0;
    const currentPageKeys = pages[safePage] ?? [];

    const consumeModifiers = useCallback((): ModifierFlags => {
      const current = modifiersRef.current;
      if (current.ctrl || current.alt || current.shift) {
        updateModifiers(emptyModifiers());
        return { ...current };
      }
      return emptyModifiers();
    }, [updateModifiers]);

    const clearModifiers = useCallback(() => {
      if (modifiersRef.current.ctrl || modifiersRef.current.alt || modifiersRef.current.shift) {
        updateModifiers(emptyModifiers());
      }
    }, [updateModifiers]);

    const consumeModifierForTapSelection = useCallback((modifier: 'alt' | 'shift'): boolean => {
      if (modifiersRef.current[modifier]) {
        updateModifiers({ ...modifiersRef.current, [modifier]: false });
        return true;
      }
      return false;
    }, [updateModifiers]);

    useImperativeHandle(ref, () => ({
      consumeModifiers,
      clearModifiers,
      consumeModifierForTapSelection,
      toggleModifier: (modifier: keyof ModifierFlags) => {
        updateModifiers({ ...modifiersRef.current, [modifier]: !modifiersRef.current[modifier] });
      },
    }), [consumeModifiers, clearModifiers, consumeModifierForTapSelection, updateModifiers]);

    const handleToggleModifier = useCallback((modifier: keyof ModifierFlags) => {
      updateModifiers({ ...modifiersRef.current, [modifier]: !modifiersRef.current[modifier] });
    }, [updateModifiers]);

    // Run a key's behavior, shared by on-screen softkey taps and iOS
    // native-keyboard taps routed through the bridge. `consumesModifiers`
    // mirrors the KeySpec flag — send-virtual / send-char pull in the bar's
    // sticky ctrl/alt/shift, everything else doesn't.
    // The iOS app's softkey bar dispatches through the same handlers.
    const keyHandlers = useMemo((): KeyBehaviorHandlers => ({
      toggleModifier: handleToggleModifier,
      paste: onPaste,
      fileUpload: onFileUpload,
      batchInputToggle: onBatchInputToggle,
      meterToggle: onMeterToggle,
      containerToggle: onContainerToggle,
      consumeModifiers,
      emptyModifiers,
      action: onAction,
    }), [consumeModifiers, handleToggleModifier, onAction, onPaste, onFileUpload, onBatchInputToggle, onMeterToggle, onContainerToggle]);
    const runKeyBehavior = useCallback((behavior: KeyBehavior, consumesModifiers: boolean) => {
      runSharedKeyBehavior(behavior, consumesModifiers, keyHandlers);
    }, [keyHandlers]);
    runKeyBehaviorRef.current = runKeyBehavior;

    // --- iOS app's softkey bar ---

    const appPressRef = useRef<(id: string) => void>(() => {});
    appPressRef.current = (id: string) => dispatchAppSoftkeyPress(id, customKeyMap, keyHandlers);

    useEffect(() => {
      if (!appBar) return;
      const bridge = getNativeBridge();
      if (!bridge) return;
      bridge.onSoftkeyPress = (id: string) => appPressRef.current(id);
      // No web key has a long-press behavior yet (the keyboard button's is
      // the app's own); accept the call so a future one has a home.
      bridge.onSoftkeyLongPress = () => {};
      return () => {
        bridge.onSoftkeyPress = () => {};
        bridge.onSoftkeyLongPress = () => {};
      };
    }, [appBar]);

    const sendAppBar = useMemo(() => createDedupedSender(payload => {
      getNativeBridge()?.setSoftkeyBar?.(payload);
    }), []);

    useEffect(() => {
      if (!appBar) return;
      sendAppBar(buildSoftkeyBarPayload({
        pages,
        customKeyMap,
        containers: containers ?? [],
        modifiers,
        activeContainerId: activeContainerId ?? null,
        batchInputOpen: batchInputOpen ?? false,
        hasAlerts: hasAlerts ?? false,
        hidden,
        sessionHotkey,
      }));
    }, [appBar, sendAppBar, pages, customKeyMap, containers, modifiers, activeContainerId, batchInputOpen, hasAlerts, hidden, sessionHotkey]);

    const handleKeyPress = useCallback((keySpec: KeySpec) => {
      runKeyBehavior(keySpec.behavior, keySpec.consumesModifiers);
    }, [runKeyBehavior]);

    const nextPage = useCallback(() => {
      if (pages.length <= 1) return;
      setCurrentPage(prev => (prev + 1) % pages.length);
    }, [pages.length]);

    const renderKey = (keyId: string, idx: number): ReactNode => {
      const keySpec = getKeySpec(keyId, customKeyMap);

      if (keySpec.behavior.kind === 'inline-input' && onBatchSubmit) {
        return (
          <InlineInput
            key={`${keyId}-${idx}`}
            softkeySize={softkeySize}
            autocorrect={autocorrect}
            onAutocorrectToggle={onAutocorrectToggle}
            onSubmit={onBatchSubmit}
            onKeepFocus={onKeepFocus}
          />
        );
      }

      if (keySpec.behavior.kind === 'toggle-modifier') {
        const mod = keySpec.behavior.modifier;
        return (
          <SoftkeyButton
            key={`${keyId}-${idx}`}
            keySpec={keySpec}
            size={softkeySize}
            isModifierActive={modifiers[mod]}
            onPress={() => handleToggleModifier(mod)}
          />
        );
      }

      if (keySpec.behavior.kind === 'batch-input-toggle') {
        return (
          <SoftkeyButton
            key={`${keyId}-${idx}`}
            keySpec={keySpec}
            size={softkeySize}
            isContainerActive={batchInputOpen}
            onPress={() => handleKeyPress(keySpec)}
          />
        );
      }

      const isActiveContainer = keySpec.behavior.kind === 'container-toggle'
        && activeContainerId === keySpec.behavior.containerId;

      return (
        <SoftkeyButton
          key={`${keyId}-${idx}`}
          keySpec={keySpec}
          size={softkeySize}
          isContainerActive={isActiveContainer}
          onPress={() => handleKeyPress(keySpec)}
        />
      );
    };

    const sessionsButton = (
      <button
        type="button"
        className="relative flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0 overflow-visible"
        style={{ width: softkeySize, height: softkeySize }}
        onPointerUp={onSessionsOpen}
        tabIndex={-1}
        aria-label="Sessions"
      >
        <Menu className="size-5" />
        {hasAlerts && (
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-destructive" />
        )}
      </button>
    );

    const keyboardLongPress = usePressLongPress({
      onPress: handleKeyboardToggleTap,
      onLongPress: handleKeyboardToggleLongPress,
      delayMs: 500,
    });
    const { ref: keyboardRef, ...keyboardLongPressEvents } = keyboardLongPress;
    const keyboardActive = keyboardMode === 'terminal';
    const keyboardButton = isNativeApp ? (
      <button
        ref={keyboardRef}
        type="button"
        className={cn(
          'flex items-center justify-center rounded-md transition-colors shrink-0',
          keyboardActive
            ? 'text-foreground bg-accent'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent',
        )}
        style={{ width: softkeySize, height: softkeySize }}
        tabIndex={-1}
        aria-label="Keyboard"
        {...keyboardLongPressEvents}
      >
        <Keyboard className="size-5" />
      </button>
    ) : null;

    if (appBar) return null;

    return (
      <div
        ref={containerRef}
        className={cn(
          'shrink-0 w-full flex items-end gap-1 p-1',
          'bg-[var(--bar-bg)] backdrop-blur-sm',
          'shadow-[var(--bar-shadow)] z-20',
          'touch-none select-none',
        )}
        onContextMenu={(e) => e.preventDefault()}
      >
        {isMobile ? (
          <>
            {sessionsButton}

            {/* Horizontal scroll strip with all keys flat. */}
            <div
              data-softkey-scroll
              className="flex-1 min-w-0 flex items-end gap-1 overflow-x-auto scrollbar-hide"
              style={{ touchAction: 'pan-x', overscrollBehaviorX: 'contain' }}
            >
              {pages.flat().map((keyId, idx) => renderKey(keyId, idx))}
            </div>

            {keyboardButton}
          </>
        ) : (
          // Desktop: paged layout — all buttons in one flex-wrap container so wrapped rows start at the left edge
          <div className="flex-1 flex flex-wrap items-end gap-1">
            {sessionsButton}
            {currentPageKeys.map((keyId, idx) => renderKey(keyId, idx))}
            {pages.length > 1 && (
              <button
                type="button"
                className="flex items-center justify-center px-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                style={{ minWidth: softkeySize, height: softkeySize }}
                onPointerUp={nextPage}
                tabIndex={-1}
                aria-label={`Page ${safePage + 1} of ${pages.length}`}
              >
                {safePage + 1}/{pages.length}
              </button>
            )}
            {keyboardButton}
          </div>
        )}
      </div>
    );
  }
);
