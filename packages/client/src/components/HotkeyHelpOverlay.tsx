import { useEffect } from 'react';

type HelpContext = 'session-panel' | 'shell-selector';

interface HotkeyHelpOverlayProps {
  open: boolean;
  onClose: () => void;
  context: HelpContext;
}

interface HotkeyEntry {
  key: string;
  description: string;
}

const SESSION_HOTKEYS: HotkeyEntry[] = [
  { key: '\u2191 / \u2193', description: 'Navigate sessions' },
  { key: 'Enter', description: 'Switch to session' },
  { key: 'Escape', description: 'Close panel' },
  { key: 'n', description: 'New session' },
  { key: 'r', description: 'Rename session' },
  { key: 'Delete', description: 'Delete session' },
  { key: 'Shift+\u2191', description: 'Move session up' },
  { key: 'Shift+\u2193', description: 'Move session down' },
  { key: '?', description: 'Toggle this help' },
];

const SHELL_HOTKEYS: HotkeyEntry[] = [
  { key: '\u2191 / \u2193', description: 'Navigate shells' },
  { key: 'Enter', description: 'Launch selected shell' },
  { key: 'Escape', description: 'Cancel selection' },
  { key: '?', description: 'Toggle this help' },
];

function helpTitle(context: HelpContext): string {
  if (context === 'session-panel') return 'Session Panel Hotkeys';
  return 'Shell Selector Hotkeys';
}

function helpEntries(context: HelpContext): HotkeyEntry[] {
  if (context === 'session-panel') return SESSION_HOTKEYS;
  return SHELL_HOTKEYS;
}

function HotkeyTable({ entries }: { entries: HotkeyEntry[] }) {
  return (
    <div className="space-y-1">
      {entries.map(entry => (
        <div key={entry.key} className="flex items-center gap-3 text-sm">
          <kbd className="inline-block min-w-[7rem] px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono text-xs text-right">
            {entry.key}
          </kbd>
          <span className="text-foreground">{entry.description}</span>
        </div>
      ))}
    </div>
  );
}

export function HotkeyHelpOverlay({ open, onClose, context }: HotkeyHelpOverlayProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-[60] bg-black/60 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-lg px-6 py-5 max-w-sm w-full mx-4 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-foreground">
          {helpTitle(context)}
        </h3>
        <HotkeyTable entries={helpEntries(context)} />
      </div>
    </div>
  );
}
