import { useRef, useEffect, useMemo } from 'react';
import type { KeySpec, ModifierFlags, SoftkeyContainerSpec } from '@/softkey-types';
import { getKeySpec } from '@/softkey-types';
import { SoftkeyButton } from '@/components/SoftkeyButton';
import { cn } from '@/lib/utils';

interface ContainerPanelProps {
  containerId: string | null;
  containerSpecs: SoftkeyContainerSpec[];
  customKeyMap: Map<string, KeySpec>;
  softkeySize: number;
  modifiers: ModifierFlags;
  onKeyPress: (keySpec: KeySpec) => void;
  onKeepFocus?: () => void;
}

export function ContainerPanel({
  containerId, containerSpecs, customKeyMap, softkeySize,
  modifiers, onKeyPress, onKeepFocus,
}: ContainerPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const keepFocusRef = useRef(onKeepFocus);
  keepFocusRef.current = onKeepFocus;

  const spec = useMemo(() => {
    if (!containerId) return null;
    return containerSpecs.find(c => c.id === containerId) ?? null;
  }, [containerId, containerSpecs]);

  // Focus prevention — same pattern as SoftkeyBar
  useEffect(() => {
    if (!spec) return;
    const el = panelRef.current;
    if (!el) return;
    const preventFocusSteal = (e: Event) => {
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
  }, [spec]);

  if (!spec) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        'shrink-0 w-full flex items-start gap-1 p-1',
        'bg-[var(--bar-bg)] backdrop-blur-sm',
        'border-t border-border',
        'touch-none select-none',
      )}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex-1 flex flex-wrap gap-1">
        {spec.keys.map((keyId, idx) => {
          const keySpec = getKeySpec(keyId, customKeyMap);

          const isModActive = keySpec.behavior.kind === 'toggle-modifier'
            ? modifiers[keySpec.behavior.modifier]
            : false;

          return (
            <SoftkeyButton
              key={`${keyId}-${idx}`}
              keySpec={keySpec}
              size={softkeySize}
              isModifierActive={isModActive}
              onPress={() => onKeyPress(keySpec)}
            />
          );
        })}
      </div>
    </div>
  );
}
