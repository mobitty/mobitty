import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Save, X, Minimize2, History, SpellCheck, Hash, WandSparkles, LoaderCircle, WrapText } from 'lucide-react';
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
import { MarkdownMirror } from '@/components/MarkdownMirror';
import { looksLikeMarkdown, isMarkdownFileName } from '@/markdown-syntax';
import { formatMarkdown } from '@/markdown-format';

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

/** Offset of the start of line `line` in `text`, clamped to the last line. */
function lineStartOffset(text: string, line: number): number {
  let pos = 0;
  for (let i = 0; i < line; i++) {
    const nl = text.indexOf('\n', pos);
    if (nl === -1) return pos;
    pos = nl + 1;
  }
  return pos;
}

function countNewlines(text: string): number {
  let n = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++;
  return n;
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
  /** Content detection's verdict; re-run on open and on a paste into an empty
   *  editor, never per keystroke. */
  const [mdDetected, setMdDetected] = useState(false);
  /** The header toggle's choice, overriding detection until the next open. */
  const [mdOverride, setMdOverride] = useState<boolean | null>(null);
  const [formatting, setFormatting] = useState(false);
  /** Soft-wrap long lines; back on with every open. */
  const [wrap, setWrap] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** The same element as state, so the mirror's effects run once it is attached:
   *  the mirror renders first, and a ref is not set yet when its effects run. */
  const [textareaEl, setTextareaEl] = useState<HTMLTextAreaElement | null>(null);
  const attachTextarea = useCallback((el: HTMLTextAreaElement | null) => {
    textareaRef.current = el;
    setTextareaEl(el);
  }, []);
  const isFullscreenInput = mode === 'fullscreen-input';
  const isImage = !isFullscreenInput && (contentType?.startsWith('image/') ?? false);
  /** History only makes sense for the $EDITOR path: the fullscreen-input draft
   *  already persists forever under its own key, and images are view-only. */
  const historyEnabled = !isFullscreenInput && !isImage;
  const markdownMode = !isImage && (mdOverride ?? mdDetected);
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
    // Ctrl+G prompt files don't end in .md, so the content decides too.
    setMdDetected(openKey !== null && (isMarkdownFileName(filePath) || looksLikeMarkdown(initial)));
    setMdOverride(null);
    setWrap(true);
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
  // The caret starts at the end of the text, scrolled into view: what gets
  // edited is usually a prompt being appended to.
  useLayoutEffect(() => {
    if (openKey === null) return;
    const id = setTimeout(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus({ preventScroll: true });
      const end = ta.value.length;
      ta.setSelectionRange(end, end);
      ta.scrollTop = ta.scrollHeight;
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
    if (looksLikeMarkdown(entry.text)) setMdDetected(true);
    setHistoryOpen(false);
    setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 0);
  }, [draft, content, filePath, commitToHistory]);

  /** Mirror an edit into React state and the draft store. */
  const applyText = useCallback((val: string) => {
    setDraft(val);
    if (isFullscreenInput) {
      setBatchInputDraft(val);
    } else {
      setRemoteEditorDraft(filePath, val);
    }
  }, [isFullscreenInput, filePath]);

  const handleFormat = useCallback(async () => {
    const ta = textareaRef.current;
    if (!ta || formatting) return;
    const before = ta.value;
    const caretLine = countNewlines(before.slice(0, ta.selectionStart));
    setFormatting(true);
    let formatted: string;
    try {
      formatted = await formatMarkdown(before);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Format failed', { description: msg.split('\n')[0] });
      return;
    } finally {
      setFormatting(false);
    }
    if (ta.value !== before) {
      toast('Text changed while formatting — try again');
      return;
    }
    if (formatted === before) {
      toast('Already formatted');
      return;
    }
    // Replace through the editing pipeline rather than by setting state, so
    // the change lands in WebKit's undo stack: Cmd+Z and iOS shake-to-undo
    // take the document back to its unformatted text in one step.
    ta.focus({ preventScroll: true });
    ta.select();
    const native = document.execCommand('insertText', false, formatted);
    if (!native || ta.value !== formatted) {
      flushSync(() => applyText(formatted));
    }
    const pos = lineStartOffset(formatted, caretLine);
    ta.setSelectionRange(pos, pos);
  }, [formatting, applyText]);

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
        {!isImage && (
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              wrap
                ? 'text-foreground bg-accent'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setWrap(!wrap)}
            onPointerDown={e => e.preventDefault()}
            tabIndex={-1}
            aria-pressed={wrap}
            aria-label={wrap ? 'Wrap on' : 'Wrap off'}
            title={wrap ? 'Wrap on' : 'Wrap off'}
          >
            <WrapText className="h-4 w-4" />
          </Button>
        )}
        {!isImage && (
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              markdownMode
                ? 'text-foreground bg-accent'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setMdOverride(!markdownMode)}
            onPointerDown={e => e.preventDefault()}
            tabIndex={-1}
            aria-pressed={markdownMode}
            aria-label={markdownMode ? 'Markdown on' : 'Markdown off'}
            title={markdownMode ? 'Markdown on' : 'Markdown off'}
          >
            <Hash className="h-4 w-4" />
          </Button>
        )}
        {markdownMode && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => { void handleFormat(); }}
            // Keep the textarea focused (and the iOS keyboard up).
            onPointerDown={e => e.preventDefault()}
            tabIndex={-1}
            disabled={formatting}
            aria-label="Format markdown"
            title="Format markdown"
          >
            {formatting
              ? <LoaderCircle className="h-4 w-4 animate-spin" />
              : <WandSparkles className="h-4 w-4" />}
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
        // The wrapper is always rendered, and the mirror only ever comes and
        // goes *before* the textarea, so toggling markdown mode never remounts
        // the textarea — that would drop its undo history and the focus
        // listeners shake-to-undo hangs off it.
        <div className="relative flex-1 min-h-0">
          {markdownMode && <MarkdownMirror text={draft} textarea={textareaEl} wrap={wrap} />}
          <textarea
            ref={attachTextarea}
            className={cn(
              'md-metrics absolute inset-0 h-full w-full font-mono text-sm resize-none outline-none',
              markdownMode ? 'md-input' : 'bg-background text-foreground',
              !wrap && 'md-nowrap',
            )}
            wrap={wrap ? 'soft' : 'off'}
            value={draft}
            onChange={(e) => applyText(e.target.value)}
            onPaste={(e) => {
              if (mdOverride !== null || mdDetected || e.currentTarget.value !== '') return;
              if (looksLikeMarkdown(e.clipboardData.getData('text/plain'))) setMdDetected(true);
            }}
            {...autocorrectAttrs(autocorrect)}
            aria-label={isFullscreenInput ? 'Fullscreen input' : 'Remote editor'}
          />
        </div>
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
