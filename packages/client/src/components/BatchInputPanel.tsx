import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { X, ArrowUp } from 'lucide-react';
import { getBatchInputDraft, setBatchInputDraft, clearBatchInputDraft } from '@/batch-input-storage';
import { cn } from '@/lib/utils';

interface BatchInputPanelProps {
  open: boolean;
  onSubmit: (text: string) => void;
  onClose: () => void;
}

function autoSize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  const style = getComputedStyle(el);
  const lineHeight = parseInt(style.lineHeight, 10) || 20;
  const maxHeight = lineHeight * 3;
  const clamped = Math.min(el.scrollHeight, maxHeight);
  el.style.height = `${clamped}px`;
  el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

export function BatchInputPanel({ open, onSubmit, onClose }: BatchInputPanelProps) {
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Load from localStorage when opened
  useEffect(() => {
    if (open) {
      const saved = getBatchInputDraft();
      setDraft(saved);
      setTimeout(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.value = saved;
          autoSize(ta);
          ta.focus({ preventScroll: true });
        }
      }, 0);
    }
  }, [open]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setDraft(val);
    setBatchInputDraft(val);
    autoSize(e.target);
  }, []);

  const handleClear = useCallback(() => {
    setDraft('');
    clearBatchInputDraft();
    const ta = textareaRef.current;
    if (ta) {
      ta.value = '';
      autoSize(ta);
      ta.focus({ preventScroll: true });
    }
  }, []);

  const handleSend = useCallback(() => {
    if (draft !== '') onSubmit(draft);
    onClose();
  }, [draft, onSubmit, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        'shrink-0 w-full flex items-end gap-2 px-2 py-1.5',
        'bg-[var(--bar-bg)] backdrop-blur-sm',
        'border-t border-border',
      )}
    >
      <Button
        variant="ghost"
        size="icon-xs"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={handleClear}
        tabIndex={-1}
        aria-label="Clear input"
      >
        <X />
      </Button>

      <textarea
        ref={textareaRef}
        className="flex-1 rounded border border-input bg-background text-foreground font-mono text-sm resize-none outline-none focus:border-ring px-2 py-1"
        rows={1}
        value={draft}
        onChange={handleChange}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Input panel"
      />

      <Button
        variant="ghost"
        size="icon-xs"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={handleSend}
        tabIndex={-1}
        aria-label="Send input"
      >
        <ArrowUp />
      </Button>
    </div>
  );
}
