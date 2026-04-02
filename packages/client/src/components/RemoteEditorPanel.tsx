import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Save, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RemoteEditorPanelProps {
  open: boolean;
  filePath: string;
  content: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}

function basename(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] ?? filePath;
}

export function RemoteEditorPanel({ open, filePath, content, onSave, onCancel }: RemoteEditorPanelProps) {
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset draft when opened with new content
  useEffect(() => {
    if (open) {
      setDraft(content);
      setTimeout(() => {
        textareaRef.current?.focus({ preventScroll: true });
      }, 0);
    }
  }, [open, content]);

  const handleSave = useCallback(() => {
    onSave(draft);
  }, [draft, onSave]);

  // Ctrl+S / Cmd+S to save
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleSave]);

  if (!open) return null;

  return (
    <div className={cn(
      'absolute inset-0 z-50 bg-background text-foreground flex flex-col',
    )}>
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="flex-1 font-mono text-sm truncate text-muted-foreground" title={filePath}>
          {basename(filePath)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground hover:text-foreground"
          onClick={onCancel}
        >
          <X className="h-4 w-4" />
          Cancel
        </Button>
        <Button
          variant="default"
          size="sm"
          className="gap-1"
          onClick={handleSave}
        >
          <Save className="h-4 w-4" />
          Save
        </Button>
      </div>

      {/* Editor */}
      <textarea
        ref={textareaRef}
        className="flex-1 min-h-0 w-full bg-background text-foreground font-mono text-sm resize-none outline-none p-3"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Remote editor"
      />
    </div>
  );
}
