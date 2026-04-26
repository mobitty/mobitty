import type { ReactNode } from 'react';
import type { KeySpec } from '@/softkey-types';
import { usePressRepeat } from '@/hooks/use-press-repeat';
import { usePressLongPress } from '@/hooks/use-press-long-press';
import { cn } from '@/lib/utils';

export interface SoftkeyButtonProps {
  keySpec: KeySpec;
  size: number;
  isModifierActive?: boolean;
  isContainerActive?: boolean;
  icon?: ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
}

const noop = () => {};

export function SoftkeyButton({ keySpec, size, isModifierActive, isContainerActive, icon, onPress, onLongPress }: SoftkeyButtonProps) {
  const isRepeatable = keySpec.repeat.kind === 'hold';
  const intervalMs = keySpec.repeat.kind === 'hold'
    ? (keySpec.repeat.interval === 'wheel' ? 60 : 120)
    : 120;
  const hasLongPress = onLongPress !== undefined;

  const repeatHandlers = usePressRepeat({
    onPress,
    delayMs: 300,
    intervalMs,
    enabled: isRepeatable,
  });

  const longPressHandlers = usePressLongPress({
    onPress,
    onLongPress: onLongPress ?? noop,
    delayMs: 500,
  });

  const label = keySpec.label;
  const content: ReactNode = icon ?? label;
  const sizeStyle = { height: size, minWidth: size };
  const className = cn(
    'flex items-center justify-center px-2 rounded-md',
    'bg-secondary text-secondary-foreground text-sm',
    'touch-manipulation select-none shrink-0',
    'active:bg-primary active:text-primary-foreground',
    'transition-colors duration-100',
    isModifierActive && 'bg-primary text-primary-foreground',
    isContainerActive && 'bg-primary text-primary-foreground',
  );

  if (isRepeatable) {
    const { ref: repeatRef, ...repeatEvents } = repeatHandlers;
    return (
      <button
        ref={repeatRef}
        type="button"
        className={className}
        style={sizeStyle}
        tabIndex={-1}
        aria-label={label}
        {...repeatEvents}
      >
        {content}
      </button>
    );
  }

  if (hasLongPress) {
    const { ref: longRef, ...longEvents } = longPressHandlers;
    return (
      <button
        ref={longRef}
        type="button"
        className={className}
        style={sizeStyle}
        tabIndex={-1}
        aria-label={label}
        {...longEvents}
      >
        {content}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={className}
      style={sizeStyle}
      tabIndex={-1}
      aria-label={label}
      onPointerUp={() => onPress()}
    >
      {content}
    </button>
  );
}
