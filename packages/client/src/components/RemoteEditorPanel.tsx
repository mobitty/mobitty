import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Save, X, Minimize2, History, SpellCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { autocorrectAttrs } from '@/lib/autocorrect';
import { useShakeToUndoOnFocus } from '@/hooks/use-shake-to-undo-on-focus';
import { useAutocorrectToggle } from '@/hooks/use-autocorrect-toggle';
import { getRemoteEditorDraft, setRemoteEditorDraft, clearRemoteEditorDraft } from '@/remote-editor-storage';
import { getBatchInputDraft, setBatchInputDraft } from '@/batch-input-storage';
import {
  listEditorHistory, pushEditorHistory, deleteEditorHistoryEntry, clearEditorHistory,
  type EditorHistoryEntry, type EditorHistoryOutcome,
} from '@/editor-history';
import { EditorHistoryPanel } from '@/components/EditorHistoryPanel';

export type RemoteEditorMode = 'remote-editor' | 'fullscreen-input';

interface RemoteEditorPanelProps {
  open: boolean;
  mode?: RemoteEditorMode;
  filePath?: string;
  content?: string;
  contentType?: string;
  /** Session title/name recorded alongside history entries, for display. */
  sessionLabel?: string;
  autocorrect: boolean;
  onAutocorrectToggle: () => void;
  /** Fired once the panel is mounted and on screen, with the number of
   *  characters loaded into the textarea. The server uses this to tell "the
   *  user is looking at the editor" from "EDITOR_OPEN went nowhere" — see
   *  `done-design-remote-editor.md`. Must be a stable identity that changes
   *  per edit, otherwise a re-sent EDITOR_OPEN cannot be acked. */
  onOpened?: (draftBytes: number) => void;
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
  sessionLabel = '',
  autocorrect,
  onAutocorrectToggle,
  onOpened,
  onSave,
  onCancel,
}: RemoteEditorPanelProps) {
  const [draft, setDraft] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<EditorHistoryEntry[]>([]);
  /** Identity of the edit whose text is currently in `draft`; null while the
   *  panel is closed or showing an image. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isFullscreenInput = mode === 'fullscreen-input';
  const isImage = !isFullscreenInput && (contentType?.startsWith('image/') ?? false);
  /** History only makes sense for the $EDITOR path: the fullscreen-input draft
   *  already persists forever under its own key, and images are view-only. */
  const historyEnabled = !isFullscreenInput && !isImage;
  /** Reported with the ack, so the log can separate "the panel is up" from
   *  "the panel is up *with the file in it*". Kept in a ref because the ack
   *  effect must not re-fire on every keystroke. */
  const loadedBytesRef = useRef(0);

  // The text is derived during *render*, not assigned by an effect. This
  // component never unmounts (`open` is a prop), so `draft` carries the
  // previous edit's text across opens — and an effect-assigned value lands one
  // or more frames after the commit that `onEditorOpen`'s flushSync put on
  // screen. Every Ctrl+G therefore painted stale (or, on the first open of a
  // page load, empty) text until React got around to flushing passive effects,
  // which is the same scheduler that was observed starving for 12.2 s in a
  // WKWebView — and why tapping any button "fixed" it: React flushes pending
  // passive effects before a discrete event. Deriving it here puts the content
  // in the same commit as the panel, so there is no queue left to starve.
  // See `todo-bug-remote-editor-stale-content.md`.
  const openKey = open && !isImage ? `${mode}\u0000${filePath}` : null;
  if (openKey !== loadedKey) {
    const initial = openKey === null
      ? ''
      : isFullscreenInput
        ? getBatchInputDraft()
        // localStorage draft wins over server content so in-progress edits
        // survive session switch / reconnect.
        : getRemoteEditorDraft(filePath) ?? content;
    loadedBytesRef.current = initial.length;
    setLoadedKey(openKey);
    setDraft(initial);
    // A history list left up when the last edit ended must not be what the
    // next one opens into.
    setHistoryOpen(false);
  }

  useShakeToUndoOnFocus(textareaRef);
  const handleAutocorrectToggle = useAutocorrectToggle(textareaRef, onAutocorrectToggle);

  const imageDataUrl = useMemo(() => {
    if (!isImage || !content) return '';
    return `data:${contentType};base64,${content}`;
  }, [isImage, content, contentType]);

  // Focus is the one part of opening that needs the DOM, so it stays an
  // effect — a layout one, for the same reason the ack is: the passive queue
  // is not something a blocked PTY should wait on. The timeout defers the
  // focus past the commit, which mobile WebKit needs to raise the keyboard.
  useLayoutEffect(() => {
    if (openKey === null) return;
    const id = setTimeout(() => {
      textareaRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(id);
  }, [openKey]);

  // Report that the panel is on screen. Deliberately *not* fired from the
  // WebSocket handler that parsed EDITOR_OPEN — the point of the ack is to
  // prove the overlay rendered, not that the bytes arrived.
  //
  // useLayoutEffect, not useEffect: passive effects are flushed by React's
  // scheduler, which is the thing that stalled for 12.2 s in the WKWebView and
  // swallowed both the commit and the ack. A layout effect runs synchronously
  // inside the commit, so a missing ack now means "React never committed"
  // rather than "the effect queue is backed up".
  useLayoutEffect(() => {
    if (open) onOpened?.(loadedBytesRef.current);
  }, [open, onOpened]);

  // Re-read the ring whenever the panel opens — or when a back-to-back edit
  // swaps the file underneath an already-open panel. A sibling tab or the
  // App-level stale-draft sweep may have added entries since the last render.
  // Deliberately left on the passive queue: this parses up to 1.5 MB of JSON
  // and only decides whether a History button is drawn, which is not worth
  // holding the paint of an overlay a PTY process is blocked on.
  useEffect(() => {
    if (!open || !historyEnabled) return;
    setHistory(listEditorHistory());
  }, [open, historyEnabled, filePath]);

  /** Record `text` so it can be brought back later. `baseline` is the
   *  server-supplied original — text equal to it means nothing was typed. */
  const commitToHistory = useCallback((text: string, outcome: EditorHistoryOutcome, baseline?: string) => {
    if (!historyEnabled) return;
    if (pushEditorHistory({
      text,
      fileName: basename(filePath),
      sessionLabel,
      outcome,
      baseline,
    })) {
      setHistory(listEditorHistory());
    }
  }, [historyEnabled, filePath, sessionLabel]);

  const handleSave = useCallback(() => {
    // Commit *before* clearing the draft: the EDITOR_DONE send can still be
    // queued and later dropped (see flushPendingEditorDone in terminal-core),
    // and without this the content would be gone with nothing to recover from.
    commitToHistory(draft, 'saved', content);
    if (!isFullscreenInput) clearRemoteEditorDraft(filePath);
    onSave(draft);
  }, [draft, content, filePath, isFullscreenInput, commitToHistory, onSave]);

  const handleCancel = useCallback(() => {
    commitToHistory(draft, 'cancelled', content);
    if (!isFullscreenInput && !isImage) clearRemoteEditorDraft(filePath);
    onCancel();
  }, [draft, content, isImage, isFullscreenInput, filePath, commitToHistory, onCancel]);

  const handleRestore = useCallback((entry: EditorHistoryEntry) => {
    // Snapshot what is being overwritten, so a restore is never destructive.
    commitToHistory(draft, 'cancelled', content);
    setDraft(entry.text);
    setRemoteEditorDraft(filePath, entry.text);
    setHistoryOpen(false);
    setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 0);
  }, [draft, content, filePath, commitToHistory]);

  const handleDeleteHistoryEntry = useCallback((id: string) => {
    deleteEditorHistoryEntry(id);
    setHistory(listEditorHistory());
  }, []);

  const handleClearHistory = useCallback(() => {
    clearEditorHistory();
    setHistory([]);
    setHistoryOpen(false);
  }, []);

  // Ctrl/Cmd + S or Enter to save / exit (text modes only). Suspended while the
  // history list is up — the list is a picker, not the editor.
  useEffect(() => {
    if (!open || isImage) return;
    const handler = (e: KeyboardEvent) => {
      if (historyOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setHistoryOpen(false);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'Enter')) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, isImage, historyOpen, handleSave]);

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
        {!isImage && (
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              autocorrect
                ? 'text-foreground bg-accent'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={handleAutocorrectToggle}
            // Keep the textarea focused: the toggle does its own blur/focus
            // dance and a browser-initiated blur here would race it.
            onPointerDown={e => e.preventDefault()}
            tabIndex={-1}
            aria-pressed={autocorrect}
            aria-label={autocorrect ? 'Autocorrect on' : 'Autocorrect off'}
            title={autocorrect ? 'Autocorrect on' : 'Autocorrect off'}
          >
            <SpellCheck className="h-4 w-4" />
          </Button>
        )}
        {historyEnabled && history.length > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Previous drafts (${history.length})`}
            title="Previous drafts"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="h-4 w-4" />
          </Button>
        )}
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
          {...autocorrectAttrs(autocorrect)}
          aria-label={isFullscreenInput ? 'Fullscreen input' : 'Remote editor'}        />
      )}

      {historyEnabled && historyOpen && (
        <EditorHistoryPanel
          entries={history}
          onRestore={handleRestore}
          onDelete={handleDeleteHistoryEntry}
          onClearAll={handleClearHistory}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}
