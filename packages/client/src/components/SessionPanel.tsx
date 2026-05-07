import { useState, useEffect, useCallback, useRef } from 'react';
import { GripVertical, Pencil, Server, Settings, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  renameSession,
  reorderSession,
  deleteSession,
  type SessionInfo,
} from '@/sessions';
import { fetchShells, type ShellInfo } from '@/shells';
import { isNativeApp, getNativeBridge } from '@/native-bridge';
import { HotkeyHelpOverlay } from '@/components/HotkeyHelpOverlay';
import { useListDrag } from '@/hooks/use-list-drag';
import { useSwipeActions, type SwipeOpenSide } from '@/hooks/use-swipe-actions';

interface SessionPanelProps {
  open: boolean;
  onClose: () => void;
  sessions: SessionInfo[];
  onRefreshSessions: () => Promise<SessionInfo[]>;
  currentSessionId?: string;
  alertedSessionIds?: Set<string>;
  onSwitchSession: (sessionId: string) => void;
  onCreateSession: (shell?: string) => void;
  onSettingsOpen: () => void;
  onNoSessionsLeft: () => void;
  isMobile: boolean;
}

export function SessionPanel({ open, onClose, sessions, onRefreshSessions, currentSessionId, alertedSessionIds, onSwitchSession, onCreateSession, onSettingsOpen, onNoSessionsLeft, isMobile }: SessionPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [status, setStatus] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const focusedRef = useRef<HTMLDivElement>(null);
  const [showShellPicker, setShowShellPicker] = useState(false);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [shellsLoading, setShellsLoading] = useState(false);
  const [shellFocusedIndex, setShellFocusedIndex] = useState(0);
  const shellFocusedRef = useRef<HTMLDivElement>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [openSwipe, setOpenSwipe] = useState<{ id: string; side: 'left' | 'right' } | null>(null);

  const showStatus = useCallback((msg: string) => {
    setStatus(msg);
    if (msg) setTimeout(() => setStatus(prev => prev === msg ? '' : prev), 3000);
  }, []);

  const handleSwitch = useCallback((sessionId: string) => {
    onSwitchSession(sessionId);
    onClose();
  }, [onSwitchSession, onClose]);

  const handleShellSelect = useCallback((shellName: string) => {
    setShowShellPicker(false);
    onCreateSession(shellName);
    onClose();
  }, [onCreateSession, onClose]);

  useEffect(() => {
    if (!open) return;
    setEditMode(false);
    setOpenSwipe(null);
    // Seed focus synchronously from the prop list so a fast user keypress
    // can never be overwritten by an async setter racing in after the fetch.
    const idx = sessions.findIndex(s => s.sessionId === currentSessionId);
    setFocusedIndex(idx >= 0 ? idx : 0);
    onRefreshSessions().catch(() => {});
    // Prefetch shells so "New Session" is instant on slow networks.
    fetchShells().then(setShells).catch(() => {});
    // Deps intentionally only [open]: re-running on `sessions` change would
    // snap focus back to the current session whenever the background refresh
    // resolves, undoing the user's arrow-key navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset swipe state when entering edit mode (drag handle takes over)
  useEffect(() => {
    if (editMode) setOpenSwipe(null);
  }, [editMode]);

  // Clamp focusedIndex when sessions list shrinks
  useEffect(() => {
    if (sessions.length > 0 && focusedIndex >= sessions.length) {
      setFocusedIndex(sessions.length - 1);
    }
  }, [sessions.length, focusedIndex]);

  // Keyboard navigation for session list
  useEffect(() => {
    if (!open || showShellPicker || showHelp || sessions.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (editingId) return;
      if (e.key === 'ArrowDown' && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const session = sessions[focusedIndex];
        if (!session || focusedIndex >= sessions.length - 1) return;
        reorderSession(session.sessionId, focusedIndex + 1).then(ok => {
          if (ok) onRefreshSessions().then(() => setFocusedIndex(focusedIndex + 1));
        });
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex(i => (i + 1) % sessions.length);
      } else if (e.key === 'ArrowUp' && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const session = sessions[focusedIndex];
        if (!session || focusedIndex <= 0) return;
        reorderSession(session.sessionId, focusedIndex - 1).then(ok => {
          if (ok) onRefreshSessions().then(() => setFocusedIndex(focusedIndex - 1));
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex(i => (i - 1 + sessions.length) % sessions.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const session = sessions[focusedIndex];
        if (!session) return;
        if (session.sessionId === currentSessionId) { onClose(); return; }
        if (session.alive) handleSwitch(session.sessionId);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Delete') {
        e.preventDefault();
        e.stopPropagation();
        const session = sessions[focusedIndex];
        if (!session) return;
        handleDelete(session.sessionId);
      } else if (e.key === 'n') {
        e.preventDefault();
        e.stopPropagation();
        handleCreate();
      } else if (e.key === 'r') {
        e.preventDefault();
        e.stopPropagation();
        const session = sessions[focusedIndex];
        if (!session) return;
        setEditingId(session.sessionId);
        setEditName(session.name);
      } else if (e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        setShowHelp(true);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, sessions, editingId, focusedIndex, currentSessionId, onClose, handleSwitch, showShellPicker, showHelp, onRefreshSessions]);

  // Keyboard navigation for inline shell picker
  useEffect(() => {
    if (!open || !showShellPicker || showHelp || shells.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setShellFocusedIndex(i => (i + 1) % shells.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setShellFocusedIndex(i => (i - 1 + shells.length) % shells.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const shell = shells[shellFocusedIndex];
        if (shell) handleShellSelect(shell.name);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setShowShellPicker(false);
      } else if (e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        setShowHelp(true);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, showShellPicker, showHelp, shells, shellFocusedIndex, handleShellSelect]);

  // Scroll focused row into view
  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  // Scroll focused shell into view
  useEffect(() => {
    shellFocusedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [shellFocusedIndex]);

  const handleRename = async (sessionId: string) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      setEditingId(null);
      return;
    }
    const ok = await renameSession(sessionId, trimmed);
    if (ok) {
      setEditingId(null);
      await onRefreshSessions();
      showStatus('Renamed');
    } else {
      showStatus('Rename failed');
    }
  };

  const handleDelete = async (sessionId: string) => {
    const isCurrent = sessionId === currentSessionId;
    const deletedIndex = sessions.findIndex(s => s.sessionId === sessionId);

    const ok = await deleteSession(sessionId);
    if (!ok) {
      showStatus('Delete failed');
      return;
    }

    const updated = await onRefreshSessions();
    showStatus('Deleted');

    if (isCurrent) {
      if (updated.length === 0) {
        onNoSessionsLeft();
        return;
      }
      const targetIndex = Math.max(0, deletedIndex - 1);
      const target = updated[targetIndex];
      if (target) handleSwitch(target.sessionId);
    }
  };

  const handleCreate = async () => {
    let list = shells;
    if (list.length === 0) {
      setShellsLoading(true);
      try {
        list = await fetchShells();
        setShells(list);
      } finally {
        setShellsLoading(false);
      }
    }
    if (list.length <= 1) {
      onCreateSession(list[0]?.name);
      onClose();
      return;
    }
    setShellFocusedIndex(0);
    setShowShellPicker(true);
  };

  const { dragIndex, dropIndex, handleProps: listDragHandleProps } = useListDrag({
    itemCount: sessions.length,
    onReorder: (from, to) => {
      const session = sessions[from];
      if (!session) return;
      reorderSession(session.sessionId, to).then(ok => {
        if (ok) onRefreshSessions().then(() => setFocusedIndex(to));
      });
    },
  });

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 bg-background text-foreground flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-lg font-semibold">Sessions</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setShowHelp(prev => !prev)}>
            ?
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {showShellPicker ? (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Select Shell</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowShellPicker(false)}>
                Cancel
              </Button>
            </div>
            <Separator />
            {shells.map((shell, index) => {
              const isFocused = index === shellFocusedIndex;
              return (
                <div
                  key={shell.name}
                  ref={isFocused ? shellFocusedRef : undefined}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md border border-border cursor-pointer hover:bg-accent ${isFocused ? 'ring-2 ring-primary' : ''}`}
                  onClick={() => handleShellSelect(shell.name)}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{shell.name}</span>
                    <div className="text-xs text-muted-foreground truncate">{shell.command ?? shell.argv.join(' ')}</div>
                  </div>
                  <Badge variant={shell.source === 'saved' ? 'default' : 'outline'} className="shrink-0 text-xs">
                    {shell.source === 'saved' ? 'saved' : 'auto'}
                  </Badge>
                </div>
              );
            })}
          </>
        ) : (
          <>
        <div className="flex gap-2 items-center">
          {isNativeApp() && (
            <Button variant="outline" size="sm" onClick={() => {
              onClose();
              getNativeBridge()?.requestOpenServersDialog();
            }}>
              <Server className="size-4" /> Servers
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleCreate} disabled={shellsLoading}>
            {shellsLoading ? 'Loading…' : 'New Session'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { onClose(); onSettingsOpen(); }}>
            <Settings className="size-4" /> Settings
          </Button>
          <div className="flex-1" />
          <Button
            variant={editMode ? "default" : "outline"}
            size="sm"
            onClick={() => setEditMode(prev => !prev)}
          >
            Edit
          </Button>
        </div>

        <Separator />

        {sessions.length === 0 && (
          <p className="text-sm text-muted-foreground">No sessions</p>
        )}

        {sessions.map((session, index) => {
          const isCurrent = session.sessionId === currentSessionId;
          const isEditing = editingId === session.sessionId;
          const isFocused = index === focusedIndex;
          const hasAlert = !isCurrent && (alertedSessionIds?.has(session.sessionId) || session.hasAlert);
          const isRowDragging = dragIndex === index;
          const isDropTarget = dropIndex === index && dragIndex !== null && dragIndex !== index;
          const swipeOpenSide: SwipeOpenSide = openSwipe?.id === session.sessionId ? openSwipe.side : null;

          return (
            <SessionRowItem
              key={session.sessionId}
              session={session}
              isCurrent={isCurrent}
              isEditing={isEditing}
              isFocused={isFocused}
              hasAlert={hasAlert}
              isRowDragging={isRowDragging}
              isDropTarget={isDropTarget}
              isMobile={isMobile}
              editMode={editMode}
              editName={editName}
              setEditName={setEditName}
              cancelRename={() => setEditingId(null)}
              submitRename={() => handleRename(session.sessionId)}
              startRename={() => { setEditingId(session.sessionId); setEditName(session.name); }}
              deleteRow={() => handleDelete(session.sessionId)}
              onActivate={() => {
                if (editMode) return;
                if (isCurrent) { onClose(); return; }
                if (session.alive) handleSwitch(session.sessionId);
              }}
              focusedRef={isFocused ? focusedRef : undefined}
              dragHandleProps={listDragHandleProps(index)}
              openSide={swipeOpenSide}
              onOpenChange={(side) => {
                if (side === null) {
                  setOpenSwipe(prev => prev?.id === session.sessionId ? null : prev);
                } else {
                  setOpenSwipe({ id: session.sessionId, side });
                }
              }}
            />
          );
        })}
          </>
        )}
      </div>

      {/* Footer */}
      {status && (
        <div className="px-4 py-2 border-t border-border">
          <span className="text-xs text-primary">{status}</span>
        </div>
      )}

      {/* Help overlay */}
      <HotkeyHelpOverlay
        open={showHelp}
        onClose={() => setShowHelp(false)}
        context={showShellPicker ? 'shell-selector' : 'session-panel'}
      />
    </div>
  );
}

interface SessionRowItemProps {
  session: SessionInfo;
  isCurrent: boolean;
  isEditing: boolean;
  isFocused: boolean;
  hasAlert: boolean;
  isRowDragging: boolean;
  isDropTarget: boolean;
  isMobile: boolean;
  editMode: boolean;
  editName: string;
  setEditName: (name: string) => void;
  cancelRename: () => void;
  submitRename: () => void;
  startRename: () => void;
  deleteRow: () => void;
  onActivate: () => void;
  focusedRef?: React.RefObject<HTMLDivElement | null> | undefined;
  dragHandleProps: { onPointerDown: (e: React.PointerEvent) => void };
  openSide: SwipeOpenSide;
  onOpenChange: (side: SwipeOpenSide) => void;
}

function SessionRowItem({
  session, isCurrent, isEditing, isFocused, hasAlert,
  isRowDragging, isDropTarget, isMobile, editMode,
  editName, setEditName, cancelRename, submitRename, startRename, deleteRow, onActivate,
  focusedRef, dragHandleProps, openSide, onOpenChange,
}: SessionRowItemProps) {
  const swipeEnabled = isMobile && !editMode && !isEditing;
  const swipe = useSwipeActions({
    disabled: !swipeEnabled,
    onRightAction: () => { onOpenChange(null); startRename(); },
    onLeftAction: () => { onOpenChange(null); deleteRow(); },
    openSide,
    onOpenChange,
  });

  const showStackedActions = !isMobile && !isEditing;
  const cwd = session.cwd;

  const rowBody = (
    <div
      className={`group relative flex items-center gap-2 px-3 py-2 rounded-md border ${
        isCurrent ? 'border-primary bg-primary/10' : 'border-border'
      } ${isFocused ? 'ring-2 ring-primary' : ''} ${!editMode && (session.alive || isCurrent) ? 'cursor-pointer' : ''} ${
        isRowDragging ? 'opacity-50' : ''
      } ${isDropTarget ? 'border-t-2 border-t-primary' : ''}`}
      onClick={() => {
        if (swipe.shouldSuppressClick()) return;
        if (openSide !== null) { onOpenChange(null); return; }
        onActivate();
      }}
    >
      {editMode && !isEditing && (
        <span
          className="flex items-center justify-center w-6 h-6 shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing touch-none"
          {...dragHandleProps}
          aria-label="Drag to reorder"
        >
          <GripVertical className="size-4" />
        </span>
      )}

      {hasAlert && (
        <span className="w-2 h-2 rounded-full bg-destructive shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        {isEditing ? (
          <form
            onSubmit={e => { e.preventDefault(); submitRename(); }}
            onClick={e => e.stopPropagation()}
            className="flex gap-1"
          >
            <Input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="h-7 text-sm"
              autoFocus
              onBlur={cancelRename}
              onKeyDown={e => { if (e.key === 'Escape') cancelRename(); }}
            />
          </form>
        ) : session.title ? (
          <>
            <span className="text-sm font-medium truncate block">{session.title}</span>
            <div className="text-xs text-muted-foreground truncate">{session.name}</div>
          </>
        ) : (
          <span className="text-sm font-medium truncate block">{session.name}</span>
        )}
        {cwd && (
          <div className="text-xs text-muted-foreground font-mono break-all">{cwd}</div>
        )}
        <div className="text-xs text-muted-foreground truncate">
          {session.shell} · pid {session.pid}
        </div>
      </div>

      {!session.alive && (
        <Badge variant="destructive" className="shrink-0">died</Badge>
      )}

      {isCurrent && (
        <Badge variant="outline" className="shrink-0">current</Badge>
      )}

      {showStackedActions && (
        <div className="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Rename"
            onClick={e => { e.stopPropagation(); startRename(); }}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-destructive hover:text-destructive"
            aria-label="Delete"
            onClick={e => { e.stopPropagation(); deleteRow(); }}
          >
            <Trash2 />
          </Button>
        </div>
      )}
    </div>
  );

  if (!swipeEnabled) {
    return (
      <div ref={focusedRef} data-drag-item>
        {rowBody}
      </div>
    );
  }

  const leftActive = swipe.deltaX > 0;
  const rightActive = swipe.deltaX < 0;
  const leftWidth = leftActive ? swipe.deltaX : 0;
  const rightWidth = rightActive ? -swipe.deltaX : 0;
  const layerTransition = swipe.isDragging ? 'none' : 'width 150ms ease-out, opacity 150ms ease-out';
  const transformStyle = {
    transform: `translateX(${swipe.deltaX}px)`,
    transition: swipe.isDragging ? 'none' : 'transform 150ms ease-out',
    touchAction: 'pan-y' as const,
  };

  return (
    <div
      ref={focusedRef}
      data-drag-item
      className="relative overflow-hidden rounded-md"
    >
      {/* Left action — grows from the left as the user swipes right */}
      {leftActive && (
        <div
          className="absolute inset-y-0 left-0 overflow-hidden flex items-center justify-start pl-4 bg-primary text-primary-foreground rounded-md"
          style={{ width: leftWidth, opacity: swipe.progress, transition: layerTransition }}
        >
          <button
            type="button"
            className="flex items-center gap-2 text-sm font-medium whitespace-nowrap"
            onClick={e => { e.stopPropagation(); onOpenChange(null); startRename(); }}
          >
            <Pencil className="size-4 shrink-0" />
            <span>Rename</span>
          </button>
        </div>
      )}

      {/* Right action — grows from the right as the user swipes left */}
      {rightActive && (
        <div
          className="absolute inset-y-0 right-0 overflow-hidden flex items-center justify-end pr-4 bg-destructive text-destructive-foreground rounded-md"
          style={{ width: rightWidth, opacity: swipe.progress, transition: layerTransition }}
        >
          <button
            type="button"
            className="flex items-center gap-2 text-sm font-medium whitespace-nowrap"
            onClick={e => { e.stopPropagation(); onOpenChange(null); deleteRow(); }}
          >
            <Trash2 className="size-4 shrink-0" />
            <span>Delete</span>
          </button>
        </div>
      )}

      {/* Foreground content — translates with finger */}
      <div style={transformStyle} {...swipe.handlers}>
        {rowBody}
      </div>
    </div>
  );
}
