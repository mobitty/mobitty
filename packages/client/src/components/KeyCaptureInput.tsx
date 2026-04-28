import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { eventToComboString } from '@/platform-detect';

interface ResetButton {
  label: string;
  value: string;
}

interface KeyCaptureInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Formats the value for display. Defaults to value verbatim, or "None" when empty. */
  formatValue?: (value: string) => string;
  /** Optional secondary button — disabled when value already equals resetButton.value.
   *  When listening, Backspace also reverts to this value. */
  resetButton?: ResetButton;
  /** Accessible label prefix, e.g. "Copy hotkey". Used by the screen-reader description. */
  ariaLabel?: string;
}

function defaultFormatValue(v: string): string {
  return v === '' ? 'None' : v;
}

export function KeyCaptureInput({
  value, onChange, formatValue = defaultFormatValue, resetButton, ariaLabel,
}: KeyCaptureInputProps) {
  const [listening, setListening] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const exitListening = () => setListening(false);

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (!listening) {
      // Idle: let the browser's button default action (Enter / Space → click) activate listening.
      return;
    }
    // Listening: trap most keys, but allow Tab navigation out of the field.
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      exitListening();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape' || e.key === 'Enter') {
      exitListening();
      return;
    }
    if (e.key === 'Backspace' && resetButton) {
      onChange(resetButton.value);
      exitListening();
      return;
    }
    const combo = eventToComboString(e);
    if (combo === null) return;
    onChange(combo);
    exitListening();
  };

  const onClick = () => {
    if (!listening) setListening(true);
  };

  const valueLabel = formatValue(value);
  const idleAria = ariaLabel
    ? `${ariaLabel}: ${valueLabel}. Press Enter or Space to rebind.`
    : `Hotkey: ${valueLabel}. Press Enter or Space to rebind.`;
  const listeningAria = resetButton
    ? `Listening for key combination. Press Esc to cancel, Backspace to ${resetButton.label.toLowerCase()}.`
    : 'Listening for key combination. Press Esc to cancel.';

  const idleClass = 'bg-muted/30 hover:bg-muted/50';
  const listeningClass = 'border-primary bg-background ring-2 ring-primary/40';
  const baseClass = 'flex-1 px-3 py-1 text-xs rounded-md border outline-none text-left cursor-pointer';

  return (
    <div className="flex items-center gap-2 flex-1">
      <button
        ref={buttonRef}
        type="button"
        aria-label={listening ? listeningAria : idleAria}
        aria-pressed={listening}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onBlur={exitListening}
        className={`${baseClass} ${listening ? listeningClass : idleClass}`}
      >
        {listening ? (
          <span aria-live="polite">
            Press a key combination… ({resetButton ? `Backspace = ${resetButton.label.toLowerCase()}, ` : ''}Esc = cancel)
          </span>
        ) : (
          valueLabel
        )}
      </button>
      {resetButton && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onChange(resetButton.value)}
          disabled={value === resetButton.value}
        >
          {resetButton.label}
        </Button>
      )}
    </div>
  );
}
