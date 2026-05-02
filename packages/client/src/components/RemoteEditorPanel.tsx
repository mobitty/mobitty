import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Save, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useShakeToUndoOnFocus } from '@/hooks/use-shake-to-undo-on-focus';
import { getRemoteEditorDraft, setRemoteEditorDraft, clearRemoteEditorDraft } from '@/remote-editor-storage';

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

  useShakeToUndoOnFocus(textareaRef);

  const imageDataUrl = useMemo(() => {
    if (!isImage || !content) return '';
    return `data:${contentType};base64,${content}`;
  }, [isImage, content, contentType]);

  // localStorage draft wins over server content so in-progress edits
  // survive session switch / reconnect.
  useEffect(() => {
    if (open && !isImage) {
      setDraft(getRemoteEditorDraft(filePath) ?? content);
      setTimeout(() => {
        textareaRef.current?.focus({ preventScroll: true });
      }, 0);
    }
  }, [open, content, isImage, filePath]);

  const handleSave = useCallback(() => {
    clearRemoteEditorDraft(filePath);
    onSave(draft);
  }, [draft, filePath, onSave]);

  const handleCancel = useCallback(() => {
    if (!isImage) clearRemoteEditorDraft(filePath);
    onCancel();
  }, [isImage, filePath, onCancel]);

  // Ctrl/Cmd + S or Enter to save (text mode only)
  useEffect(() => {
    if (!open || isImage) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'Enter')) {
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
          onClick={handleCancel}
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
          onChange={(e) => {
            const val = e.target.value;
            setDraft(val);
            setRemoteEditorDraft(filePath, val);
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Remote editor"
        />
      )}
    </div>
  );
}
