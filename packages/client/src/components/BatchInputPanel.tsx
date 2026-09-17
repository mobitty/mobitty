import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { X, ArrowUp, Maximize2, SpellCheck } from 'lucide-react';
import { getBatchInputDraft, setBatchInputDraft, clearBatchInputDraft } from '@/batch-input-storage';
import { cn } from '@/lib/utils';
import { autocorrectAttrs } from '@/lib/autocorrect';
import { useShakeToUndoOnFocus } from '@/hooks/use-shake-to-undo-on-focus';
import { useAutocorrectToggle } from '@/hooks/use-autocorrect-toggle';

interface BatchInputPanelProps {
  open: boolean;
  fullscreen: boolean;
  autocorrect: boolean;
  onAutocorrectToggle: () => void;
  onSubmit: (text: string) => void;
  onClose: () => void;
  onFullscreenToggle: () => void;
}

export function BatchInputPanel({ open, fullscreen, autocorrect, onAutocorrectToggle, onSubmit, onClose, onFullscreenToggle }: BatchInputPanelProps) {
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useShakeToUndoOnFocus(textareaRef);
  const handleAutocorrectToggle = useAutocorrectToggle(textareaRef, onAutocorrectToggle);

  // Load from localStorage when the panel opens, and again whenever the
  // fullscreen overlay closes (so edits made there propagate back here).
  useEffect(() => {
    if (open && !fullscreen) {
      const saved = getBatchInputDraft();
      setDraft(saved);
      setTimeout(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.value = saved;
          ta.focus({ preventScroll: true });
        }
      }, 0);
    }
  }, [open, fullscreen]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setDraft(val);
    setBatchInputDraft(val);
  }, []);

  const handleClear = useCallback(() => {
    setDraft('');
    clearBatchInputDraft();
    const ta = textareaRef.current;
    if (ta) {
      ta.value = '';
      ta.focus({ preventScroll: true });
    }
  }, []);

  const handleSend = useCallback(() => {
    if (draft !== '') onSubmit(draft);
    onClose();
  }, [draft, onSubmit, onClose]);

  if (!open || fullscreen) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        'shrink-0 w-full flex items-stretch gap-2 px-2 py-1.5',
        'bg-[var(--bar-bg)] backdrop-blur-sm',
        'border-t border-border',
      )}
    >
      <div className="shrink-0 flex flex-col justify-end">
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn(
            autocorrect
              ? 'text-foreground bg-accent'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={handleAutocorrectToggle}
          // Keep the textarea focused: the toggle does its own blur/focus dance
          // and a browser-initiated blur here would race it.
          onPointerDown={e => e.preventDefault()}
          tabIndex={-1}
          aria-pressed={autocorrect}
          aria-label={autocorrect ? 'Autocorrect on' : 'Autocorrect off'}
          title={autocorrect ? 'Autocorrect on' : 'Autocorrect off'}
        >
          <SpellCheck />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={handleClear}
          tabIndex={-1}
          aria-label="Clear input"
        >
          <X />
        </Button>
      </div>

      <textarea
        ref={textareaRef}
        className="flex-1 rounded border border-input bg-background text-foreground font-mono text-sm resize-none outline-none focus:border-ring px-2 py-1"
        rows={2}
        value={draft}
        onChange={handleChange}
        {...autocorrectAttrs(autocorrect)}
        aria-label="Input panel"
      />

      <div className="shrink-0 flex flex-col gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={handleSend}
          tabIndex={-1}
          aria-label="Send input"
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={onFullscreenToggle}
          tabIndex={-1}
          aria-label="Fullscreen input"
        >
          <Maximize2 />
        </Button>
      </div>
    </div>
  );
}
