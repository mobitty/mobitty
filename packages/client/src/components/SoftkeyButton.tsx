import type { KeySpec } from '@/softkey-types';
import { usePressRepeat } from '@/hooks/use-press-repeat';
import { cn } from '@/lib/utils';

export interface SoftkeyButtonProps {
  keySpec: KeySpec;
  size: number;
  isModifierActive?: boolean;
  isContainerActive?: boolean;
  onPress: () => void;
}

export function SoftkeyButton({ keySpec, size, isModifierActive, isContainerActive, onPress }: SoftkeyButtonProps) {
  const isRepeatable = keySpec.repeat.kind === 'hold';
  const intervalMs = keySpec.repeat.kind === 'hold'
    ? (keySpec.repeat.interval === 'wheel' ? 60 : 120)
    : 120;

  const repeatHandlers = usePressRepeat({
    onPress,
    delayMs: 300,
    intervalMs,
    enabled: isRepeatable,
  });

  const label = keySpec.label;
  const sizeStyle = { height: size, minWidth: size };

  const { ref: repeatRef, ...repeatEvents } = repeatHandlers;

  if (isRepeatable) {
    return (
      <button
        ref={repeatRef}
        type="button"
        className={cn(
          'flex items-center justify-center px-2 rounded-md',
          'bg-secondary text-secondary-foreground text-sm',
          'touch-manipulation select-none shrink-0',
          'active:bg-primary active:text-primary-foreground',
          'transition-colors duration-100',
          isModifierActive && 'bg-primary text-primary-foreground',
          isContainerActive && 'bg-primary text-primary-foreground',
        )}
        style={sizeStyle}
        tabIndex={-1}
        aria-label={label}
        {...repeatEvents}
      >
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        'flex items-center justify-center px-2 rounded-md',
        'bg-secondary text-secondary-foreground text-sm',
        'touch-manipulation select-none shrink-0',
        'active:bg-primary active:text-primary-foreground',
        'transition-colors duration-100',
        isModifierActive && 'bg-primary text-primary-foreground',
        isContainerActive && 'bg-primary text-primary-foreground',
      )}
      style={sizeStyle}
      tabIndex={-1}
      aria-label={label}
      onPointerUp={() => onPress()}
    >
      {label}
    </button>
  );
}
