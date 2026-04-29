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
import { useBackdropColorSync } from '@/hooks/use-backdrop-color-sync';
import { usePressLongPress } from '@/hooks/use-press-long-press';
import { ArrowUp, Keyboard, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  onSessionsOpen: () => void;
  onMeterToggle: () => void;
  onAction: (action: KeyBehavior, modifiers: ModifierFlags) => void;
  onPaste: () => void;
  onBatchInputToggle: () => void;
  onBatchSubmit?: (text: string) => void;
  onContainerToggle: (containerId: string) => void;
  onKeepFocus?: () => void;
  onModifiersChange?: (modifiers: ModifierFlags) => void;
}

// --- InlineInput sub-component ---

function autoSizeInline(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  const style = getComputedStyle(el);
  const lineHeight = parseInt(style.lineHeight, 10) || 20;
  const maxHeight = lineHeight * 5;
  const minH = parseFloat(style.minHeight) || 0;
  const clamped = Math.max(minH, Math.min(el.scrollHeight, maxHeight));
  el.style.height = `${clamped}px`;
  el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

interface InlineInputProps {
  softkeySize: number;
  onSubmit: (text: string) => void;
  onKeepFocus?: () => void;
}

function InlineInput({ softkeySize, onSubmit, onKeepFocus }: InlineInputProps) {
  const [draft, setDraft] = useState(() => getBatchInputDraft());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.value = draft;
      autoSizeInline(ta);
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setDraft(val);
    setBatchInputDraft(val);
    autoSizeInline(e.target);
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
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Inline input"
      />
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
  function SoftkeyBar({ pages, customKeys, containers, activeContainerId, batchInputOpen, softkeySize = 44, hasAlerts, isMobile, isNativeApp, onSessionsOpen, onMeterToggle, onAction, onPaste, onBatchInputToggle, onBatchSubmit, onContainerToggle, onKeepFocus, onModifiersChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    useBackdropColorSync(containerRef);
    const [currentPage, setCurrentPage] = useState(0);
    const [modifiers, setModifiers] = useState<ModifierFlags>(emptyModifiers());
    const [keyboardMode, setKeyboardMode] = useState<KeyboardMode>('system');
    const modifiersRef = useRef<ModifierFlags>(emptyModifiers());
    const onModifiersChangeRef = useRef(onModifiersChange);
    onModifiersChangeRef.current = onModifiersChange;

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

    const handleKeyPress = useCallback((keySpec: KeySpec) => {
      if (keySpec.behavior.kind === 'toggle-modifier') {
        handleToggleModifier(keySpec.behavior.modifier);
        return;
      }

      if (keySpec.behavior.kind === 'paste') {
        onPaste();
        return;
      }

      if (keySpec.behavior.kind === 'batch-input-toggle') {
        onBatchInputToggle();
        return;
      }

      if (keySpec.behavior.kind === 'meter-toggle') {
        onMeterToggle();
        return;
      }

      if (keySpec.behavior.kind === 'container-toggle') {
        onContainerToggle(keySpec.behavior.containerId);
        return;
      }

      const mods = keySpec.consumesModifiers ? consumeModifiers() : emptyModifiers();
      onAction(keySpec.behavior, mods);
    }, [consumeModifiers, handleToggleModifier, onAction, onPaste, onBatchInputToggle, onContainerToggle]);

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
