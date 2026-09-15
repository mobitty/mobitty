import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, X } from 'lucide-react';
import { formatRelativeTime, type EditorHistoryEntry } from '@/editor-history';

const PREVIEW_CHARS = 240;

interface EditorHistoryPanelProps {
  entries: EditorHistoryEntry[];
  onRestore: (entry: EditorHistoryEntry) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

/** Overlay listing previously-typed editor contents. Mounted *inside* the
 *  editor overlay so its `absolute inset-0` stays scoped to the terminal frame
 *  and below the safe-area band — see `done-bug-overlay-panels-cover-safe-area.md`. */
export function EditorHistoryPanel({
  entries, onRestore, onDelete, onClearAll, onClose,
}: EditorHistoryPanelProps) {
  // Clear-all is the one unrecoverable action here, so it takes two taps.
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);

  return (
    <div className="absolute inset-0 z-10 bg-background text-foreground flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="flex-1 text-sm font-medium truncate">Previous drafts</span>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
          Close
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-2">
        {entries.length === 0 ? (
          <p className="px-1 py-4 text-sm text-muted-foreground">
            Nothing saved yet. Text you type here is kept when you save or cancel.
          </p>
        ) : entries.map(entry => (
          <div
            key={entry.id}
            className="group flex items-start gap-2 px-3 py-2 rounded-md border border-border cursor-pointer hover:bg-accent/50"
            onClick={() => onRestore(entry)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">{formatRelativeTime(entry.savedAt)}</span>
                <Badge variant={entry.outcome === 'saved' ? 'outline' : 'secondary'} className="shrink-0">
                  {entry.outcome === 'saved' ? 'saved' : 'cancelled'}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {[entry.sessionLabel, entry.fileName].filter(Boolean).join(' · ')}
              </div>
              <div className="mt-1 text-sm font-mono whitespace-pre-wrap break-words line-clamp-2">
                {entry.text.slice(0, PREVIEW_CHARS)}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-destructive hover:text-destructive"
              aria-label="Delete draft"
              onClick={e => { e.stopPropagation(); onDelete(entry.id); }}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>

      {entries.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-border">
          {confirmingClearAll ? (
            <>
              <span className="flex-1 text-sm text-muted-foreground truncate">
                Delete all {entries.length} {entries.length === 1 ? 'draft' : 'drafts'}?
              </span>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingClearAll(false)}>
                Keep
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => { setConfirmingClearAll(false); onClearAll(); }}
              >
                Delete all
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto gap-1 text-destructive hover:text-destructive"
              onClick={() => setConfirmingClearAll(true)}
            >
              <Trash2 className="h-4 w-4" />
              Clear all
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
