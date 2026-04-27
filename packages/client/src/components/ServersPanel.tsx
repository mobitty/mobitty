import { useState, useEffect, useRef } from 'react';
import { Pencil, Trash2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { HotkeyHelpOverlay } from '@/components/HotkeyHelpOverlay';
import { getNativeBridge, type SavedServer } from '@/native-bridge';

interface ServersPanelProps {
  open: boolean;
  onClose: () => void;
}

interface ServerDraft {
  id: string | null;
  name: string;
  url: string;
  notes: string;
}

function urlIsValid(s: string): boolean {
  try {
    const u = new URL(s);
    return u.host !== '';
  } catch {
    return false;
  }
}

export function ServersPanel({ open, onClose }: ServersPanelProps) {
  const [servers, setServers] = useState<SavedServer[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ServerDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const focusedRef = useRef<HTMLDivElement>(null);
  const initialFocusSetRef = useRef(false);

  // Reset transient UI when the panel reopens.
  useEffect(() => {
    if (!open) return;
    setDraft(null);
    setError(null);
    setConfirmDeleteId(null);
    setShowHelp(false);
    initialFocusSetRef.current = false;
  }, [open]);

  // Wire bridge state push + initial state request.
  useEffect(() => {
    if (!open) return;
    const bridge = getNativeBridge();
    if (!bridge) return;
    bridge.onServersStateChanged = (s, a) => {
      setServers(s);
      setActiveServerId(a);
      if (!initialFocusSetRef.current) {
        const idx = s.findIndex(x => x.id === a);
        setFocusedIndex(idx >= 0 ? idx : 0);
        initialFocusSetRef.current = true;
      }
    };
    bridge.requestServersState();
    bridge.requestKeyboardMode('system');
    return () => {
      const b = getNativeBridge();
      if (b) b.onServersStateChanged = () => {};
    };
  }, [open]);

  // Clamp focusedIndex when the list shrinks.
  useEffect(() => {
    if (servers.length > 0 && focusedIndex >= servers.length) {
      setFocusedIndex(servers.length - 1);
    }
  }, [servers.length, focusedIndex]);

  // Scroll focused row into view.
  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  const flush = (next: SavedServer[]) => {
    setServers(next);
    getNativeBridge()?.requestSaveServers(next);
  };

  const startAdd = () => {
    setDraft({ id: null, name: '', url: '', notes: '' });
    setError(null);
  };

  const startEdit = (s: SavedServer) => {
    setDraft({ id: s.id, name: s.name, url: s.url, notes: s.notes ?? '' });
    setError(null);
  };

  const cancelEdit = () => {
    setDraft(null);
    setError(null);
  };

  const saveDraft = () => {
    if (!draft) return;
    const name = draft.name.trim();
    const url = draft.url.trim();
    const notes = draft.notes.trim();
    if (!name) { setError('Name is required'); return; }
    if (!urlIsValid(url)) { setError('Enter a valid URL like https://your-server.example.com'); return; }
    if (draft.id === null) {
      const entry: SavedServer = notes
        ? { id: crypto.randomUUID(), name, url, notes }
        : { id: crypto.randomUUID(), name, url };
      flush([...servers, entry]);
    } else {
      const id = draft.id;
      flush(servers.map(s => {
        if (s.id !== id) return s;
        return notes ? { ...s, name, url, notes } : { id: s.id, name, url };
      }));
    }
    setDraft(null);
    setError(null);
  };

  const handleSwitch = (id: string) => {
    const bridge = getNativeBridge();
    if (!bridge) return;
    bridge.requestSaveServers(servers);
    bridge.requestSwitchServer(id);
  };

  const requestDelete = (id: string) => {
    if (servers.length <= 1) return;
    if (id === activeServerId) return;
    setConfirmDeleteId(id);
  };

  const confirmDelete = () => {
    if (!confirmDeleteId) return;
    flush(servers.filter(s => s.id !== confirmDeleteId));
    setConfirmDeleteId(null);
  };

  const cancelDelete = () => setConfirmDeleteId(null);

  // List-context keyboard handler.
  useEffect(() => {
    if (!open || draft !== null || confirmDeleteId !== null || showHelp || servers.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex(i => Math.min(i + 1, servers.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const s = servers[focusedIndex];
        if (!s) return;
        if (s.id === activeServerId) onClose();
        else handleSwitch(s.id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'n') {
        e.preventDefault();
        e.stopPropagation();
        startAdd();
      } else if (e.key === 'e') {
        e.preventDefault();
        e.stopPropagation();
        const s = servers[focusedIndex];
        if (s) startEdit(s);
      } else if (e.key === 'Delete') {
        e.preventDefault();
        e.stopPropagation();
        const s = servers[focusedIndex];
        if (s) requestDelete(s.id);
      } else if (e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        setShowHelp(true);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, draft, confirmDeleteId, showHelp, servers, focusedIndex, activeServerId, onClose]);

  // Form-context keyboard handler.
  useEffect(() => {
    if (!open || draft === null || showHelp) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelEdit();
      } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
        e.preventDefault();
        e.stopPropagation();
        saveDraft();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft, showHelp]);

  // Delete-confirm-context keyboard handler.
  useEffect(() => {
    if (!open || confirmDeleteId === null || showHelp) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelDelete();
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        e.stopPropagation();
        confirmDelete();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, confirmDeleteId, showHelp]);

  if (!open) return null;

  const isLast = servers.length <= 1;

  return (
    <div className="absolute inset-0 z-50 bg-background text-foreground flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-lg font-semibold">Servers</h2>
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
        {draft === null ? (
          <>
            <div className="flex gap-2 items-center">
              <Button variant="outline" size="sm" onClick={startAdd}>
                <Plus className="size-4" /> Add Server
              </Button>
            </div>

            <Separator />

            {servers.length === 0 && (
              <p className="text-sm text-muted-foreground">No servers yet.</p>
            )}

            {servers.map((s, index) => {
              const isActive = s.id === activeServerId;
              const isFocused = index === focusedIndex;
              const deleteDisabled = isLast || isActive;
              const deleteTitle = isLast
                ? 'Add another server first.'
                : isActive
                  ? 'Switch to another server first.'
                  : 'Delete server';
              if (confirmDeleteId === s.id) {
                return (
                  <div
                    key={s.id}
                    ref={isFocused ? focusedRef : undefined}
                    className="flex items-center gap-2 px-3 py-2 rounded-md border border-destructive bg-destructive/10"
                  >
                    <div className="flex-1 min-w-0 text-sm">
                      Delete <span className="font-medium">{s.name}</span>?
                    </div>
                    <Button variant="outline" size="sm" onClick={cancelDelete}>
                      Cancel
                    </Button>
                    <Button variant="destructive" size="sm" onClick={confirmDelete}>
                      Delete
                    </Button>
                  </div>
                );
              }
              return (
                <div
                  key={s.id}
                  ref={isFocused ? focusedRef : undefined}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer ${
                    isActive ? 'border-primary bg-primary/10' : 'border-border'
                  } ${isFocused ? 'ring-2 ring-primary' : ''}`}
                  onClick={() => {
                    if (isActive) onClose();
                    else handleSwitch(s.id);
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{s.name}</span>
                      {isActive && <Badge className="text-xs">Active</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{s.url}</div>
                    {s.notes && (
                      <div className="text-xs text-muted-foreground truncate">{s.notes}</div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => { e.stopPropagation(); startEdit(s); }}
                    title="Edit"
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={deleteDisabled}
                    title={deleteTitle}
                    onClick={(e) => { e.stopPropagation(); requestDelete(s.id); }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
          </>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="server-name">Name</Label>
              <Input
                id="server-name"
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="My Server"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="server-url">URL</Label>
              <Input
                id="server-url"
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                placeholder="https://your-server.example.com"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="server-notes">Notes (optional)</Label>
              <textarea
                id="server-notes"
                rows={3}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={cancelEdit}>Cancel</Button>
              <Button onClick={saveDraft}>Save</Button>
            </div>
          </div>
        )}
      </div>

      <HotkeyHelpOverlay
        open={showHelp}
        onClose={() => setShowHelp(false)}
        context="servers-panel"
      />
    </div>
  );
}
