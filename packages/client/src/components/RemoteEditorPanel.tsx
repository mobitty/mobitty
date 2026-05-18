import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Save, X, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useShakeToUndoOnFocus } from '@/hooks/use-shake-to-undo-on-focus';
import { getRemoteEditorDraft, setRemoteEditorDraft, clearRemoteEditorDraft } from '@/remote-editor-storage';
import { getBatchInputDraft, setBatchInputDraft } from '@/batch-input-storage';

export type RemoteEditorMode = 'remote-editor' | 'fullscreen-input';

interface RemoteEditorPanelProps {
  open: boolean;
  mode?: RemoteEditorMode;
  filePath?: string;
  content?: string;
  contentType?: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}

function basename(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] ?? filePath;
}

export function RemoteEditorPanel({
  open,
  mode = 'remote-editor',
  filePath = '',
  content = '',
  contentType,
  onSave,
  onCancel,
}: RemoteEditorPanelProps) {
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isFullscreenInput = mode === 'fullscreen-input';
  const isImage = !isFullscreenInput && (contentType?.startsWith('image/') ?? false);

  useShakeToUndoOnFocus(textareaRef);

  const imageDataUrl = useMemo(() => {
    if (!isImage || !content) return '';
    return `data:${contentType};base64,${content}`;
  }, [isImage, content, contentType]);

  // localStorage draft wins over server content so in-progress edits
  // survive session switch / reconnect. Fullscreen-input mode shares the
  // mobitty-batch-input key with the inline BatchInputPanel.
  useEffect(() => {
    if (!open || isImage) return;
    if (isFullscreenInput) {
      setDraft(getBatchInputDraft());
    } else {
      setDraft(getRemoteEditorDraft(filePath) ?? content);
    }
    setTimeout(() => {
      textareaRef.current?.focus({ preventScroll: true });
    }, 0);
  }, [open, content, isImage, isFullscreenInput, filePath]);

  const handleSave = useCallback(() => {
    if (!isFullscreenInput) clearRemoteEditorDraft(filePath);
    onSave(draft);
  }, [draft, filePath, isFullscreenInput, onSave]);

  const handleCancel = useCallback(() => {
    if (!isFullscreenInput && !isImage) clearRemoteEditorDraft(filePath);
    onCancel();
  }, [isImage, isFullscreenInput, filePath, onCancel]);

  // Ctrl/Cmd + S or Enter to save / exit (text modes only)
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
        <span className="flex-1 font-mono text-sm truncate text-muted-foreground" title={isFullscreenInput ? 'Input' : filePath}>
          {isFullscreenInput ? 'Input' : basename(filePath)}
        </span>
        {!isFullscreenInput && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-muted-foreground hover:text-foreground"
            onClick={handleCancel}
          >
            <X className="h-4 w-4" />
            {isImage ? 'Close' : 'Cancel'}
          </Button>
        )}
        {isFullscreenInput && (
          <Button
            variant="default"
            size="sm"
            className="gap-1"
            onClick={handleSave}
          >
            <Minimize2 className="h-4 w-4" />
            Exit
          </Button>
        )}
        {!isFullscreenInput && !isImage && (
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
            if (isFullscreenInput) {
              setBatchInputDraft(val);
            } else {
              setRemoteEditorDraft(filePath, val);
            }
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label={isFullscreenInput ? 'Fullscreen input' : 'Remote editor'}
        />
      )}
    </div>
  );
}
