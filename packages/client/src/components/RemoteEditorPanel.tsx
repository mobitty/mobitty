import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Save, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RemoteEditorPanelProps {
  open: boolean;
  filePath: string;
  content: string;
  contentType?: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}

function basename(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] ?? filePath;
}

export function RemoteEditorPanel({ open, filePath, content, contentType, onSave, onCancel }: RemoteEditorPanelProps) {
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isImage = contentType?.startsWith('image/') ?? false;

  const imageDataUrl = useMemo(() => {
    if (!isImage || !content) return '';
    return `data:${contentType};base64,${content}`;
  }, [isImage, content, contentType]);

  // Reset draft when opened with new content
  useEffect(() => {
    if (open && !isImage) {
      setDraft(content);
      setTimeout(() => {
        textareaRef.current?.focus({ preventScroll: true });
      }, 0);
    }
  }, [open, content, isImage]);

  const handleSave = useCallback(() => {
    onSave(draft);
  }, [draft, onSave]);

  // Ctrl+S / Cmd+S to save (text mode only)
  useEffect(() => {
    if (!open || isImage) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, isImage, handleSave]);

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
          {isImage ? 'Close' : 'Cancel'}
        </Button>
        {!isImage && (
          <Button
            variant="default"
            size="sm"
            className="gap-1"
            onClick={handleSave}
          >
            <Save className="h-4 w-4" />
            Save
          </Button>
        )}
      </div>

      {/* Body */}
      {isImage ? (
        <div
          className="flex-1 min-h-0 overflow-auto p-3"
          style={{ touchAction: 'pinch-zoom pan-x pan-y' }}
        >
          <img
            src={imageDataUrl}
            alt={basename(filePath)}
            className="max-w-full h-auto mx-auto block"
            draggable={false}
          />
        </div>
      ) : (
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
      )}
    </div>
  );
}
