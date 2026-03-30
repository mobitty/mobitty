import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  fetchSessions,
  renameSession,
  reorderSession,
  deleteSession,
  type SessionInfo,
} from '@/sessions';
import { fetchShells, type ShellInfo } from '@/shells';
import { HotkeyHelpOverlay } from '@/components/HotkeyHelpOverlay';
import { useListDrag } from '@/hooks/use-list-drag';

interface SessionPanelProps {
  open: boolean;
  onClose: () => void;
  currentSessionId?: string;
  alertedSessionIds?: Set<string>;
  onSwitchSession: (sessionId: string) => void;
  onCreateSession: (shell?: string) => void;
  onSettingsOpen: () => void;
  onNoSessionsLeft: () => void;
}

export function SessionPanel({ open, onClose, currentSessionId, alertedSessionIds, onSwitchSession, onCreateSession, onSettingsOpen, onNoSessionsLeft }: SessionPanelProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [status, setStatus] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const focusedRef = useRef<HTMLDivElement>(null);
  const [showShellPicker, setShowShellPicker] = useState(false);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [shellFocusedIndex, setShellFocusedIndex] = useState(0);
  const shellFocusedRef = useRef<HTMLDivElement>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const showStatus = useCallback((msg: string) => {
    setStatus(msg);
    if (msg) setTimeout(() => setStatus(prev => prev === msg ? '' : prev), 3000);
  }, []);

  const refresh = useCallback(async () => {
    const list = await fetchSessions();
    setSessions(list);
    return list;
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
    refresh().then(list => {
      const idx = list.findIndex(s => s.sessionId === currentSessionId);
      setFocusedIndex(idx >= 0 ? idx : 0);
    });
  }, [open, refresh, currentSessionId]);

  // Dismiss active rename when exiting edit mode
  useEffect(() => {
    if (!editMode) setEditingId(null);
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
          if (ok) refresh().then(() => setFocusedIndex(focusedIndex + 1));
        });
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex(i => Math.min(i, sessions.length - 2) + 1);
      } else if (e.key === 'ArrowUp' && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const session = sessions[focusedIndex];
        if (!session || focusedIndex <= 0) return;
        reorderSession(session.sessionId, focusedIndex - 1).then(ok => {
          if (ok) refresh().then(() => setFocusedIndex(focusedIndex - 1));
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex(i => Math.max(i, 1) - 1);
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
  }, [open, sessions, editingId, focusedIndex, currentSessionId, onClose, handleSwitch, showShellPicker, showHelp]);

  // Keyboard navigation for inline shell picker
  useEffect(() => {
    if (!open || !showShellPicker || showHelp || shells.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setShellFocusedIndex(i => Math.min(i, shells.length - 2) + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setShellFocusedIndex(i => Math.max(i, 1) - 1);
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
      await refresh();
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

    const updated = await refresh();
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
    const list = await fetchShells();
    if (list.length <= 1) {
      onCreateSession(list[0]?.name);
      onClose();
      return;
    }
    setShells(list);
    setShellFocusedIndex(0);
    setShowShellPicker(true);
  };

  const { dragIndex, dropIndex, handleProps: listDragHandleProps } = useListDrag({
    itemCount: sessions.length,
    onReorder: (from, to) => {
      const session = sessions[from];
      if (!session) return;
      reorderSession(session.sessionId, to).then(ok => {
        if (ok) refresh().then(() => setFocusedIndex(to));
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
          <Button variant="ghost" size="sm" onClick={onClose}>
            &#215;
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
                    <div className="text-xs text-muted-foreground truncate">{shell.argv.join(' ')}</div>
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
          <Button variant="outline" size="sm" onClick={handleCreate}>
            New Session
          </Button>
          <Button variant="outline" size="sm" onClick={() => { onClose(); onSettingsOpen(); }}>
            &#9881; Settings
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
          const isDragging = dragIndex === index;
          const isDropTarget = dropIndex === index && dragIndex !== null && dragIndex !== index;

          return (
            <div
              key={session.sessionId}
              ref={isFocused ? focusedRef : undefined}
              data-drag-item
              className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
                isCurrent ? 'border-primary bg-primary/10' : 'border-border'
              } ${isFocused ? 'ring-2 ring-primary' : ''} ${!editMode && (session.alive || isCurrent) ? 'cursor-pointer' : ''} ${
                isDragging ? 'opacity-50' : ''
              } ${isDropTarget ? 'border-t-2 border-t-primary' : ''}`}
              onClick={() => {
                if (editMode) return;
                if (isCurrent) { onClose(); return; }
                if (session.alive) handleSwitch(session.sessionId);
              }}
            >
              {/* Drag handle (edit mode only) */}
              {editMode && !isEditing && (
                <span
                  className="flex items-center justify-center w-6 h-6 shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing touch-none"
                  {...listDragHandleProps(index)}
                >
                  &#8801;
                </span>
              )}

              {/* Alert dot */}
              {hasAlert && (
                <span className="w-2 h-2 rounded-full bg-destructive shrink-0" />
              )}

              {/* Name or edit input */}
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <form
                    onSubmit={e => { e.preventDefault(); handleRename(session.sessionId); }}
                    onClick={e => e.stopPropagation()}
                    className="flex gap-1"
                  >
                    <Input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="h-7 text-sm"
                      autoFocus
                      onBlur={() => setEditingId(null)}
                      onKeyDown={e => { if (e.key === 'Escape') setEditingId(null); }}
                    />
                  </form>
                ) : session.title ? (
                  <>
                    <span className="text-sm font-medium truncate block">
                      {session.title}
                    </span>
                    <div className="text-xs text-muted-foreground truncate">{session.name}</div>
                  </>
                ) : (
                  <span className="text-sm font-medium truncate block">
                    {session.name}
                  </span>
                )}
                <div className="text-xs text-muted-foreground">
                  {session.shell} &middot; PID {session.pid} &middot; {session.sessionId.slice(0, 8)}
                </div>
              </div>

              {/* Status badge (died only) */}
              {!session.alive && (
                <Badge variant="destructive" className="shrink-0">died</Badge>
              )}

              {/* Current indicator */}
              {isCurrent && (
                <Badge variant="outline" className="shrink-0">current</Badge>
              )}

              {/* Rename button (edit mode only) */}
              {editMode && !isEditing && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs shrink-0"
                  onClick={e => { e.stopPropagation(); setEditingId(session.sessionId); setEditName(session.name); }}
                >
                  Rename
                </Button>
              )}

              {/* Delete button (edit mode only) */}
              {editMode && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-destructive shrink-0"
                  onClick={e => { e.stopPropagation(); handleDelete(session.sessionId); }}
                >
                  Delete
                </Button>
              )}
            </div>
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
