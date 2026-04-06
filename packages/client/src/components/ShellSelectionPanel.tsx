import { useState, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import type { ShellInfo } from '@/shells';
import { HotkeyHelpOverlay } from '@/components/HotkeyHelpOverlay';

interface ShellSelectionPanelProps {
  shells: ShellInfo[];
  onSelect: (name: string) => void;
}

export function ShellSelectionPanel({ shells, onSelect }: ShellSelectionPanelProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const focusedRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation
  useEffect(() => {
    if (shells.length === 0 || showHelp) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex(i => Math.min(i, shells.length - 2) + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex(i => Math.max(i, 1) - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const shell = shells[focusedIndex];
        if (shell) onSelect(shell.name);
      } else if (e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        setShowHelp(true);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [shells, focusedIndex, onSelect, showHelp]);

  // Scroll focused item into view
  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  return (
    <div className="absolute inset-0 z-50 bg-background text-foreground flex items-center justify-center">
      <div className="w-full max-w-md px-6 space-y-4">
        <h2 className="text-lg font-semibold text-center">Select Shell</h2>
        {shells.map((shell, index) => {
          const isFocused = index === focusedIndex;
          return (
            <div
              key={shell.name}
              ref={isFocused ? focusedRef : undefined}
              className={`flex items-center gap-2 px-3 py-2 rounded-md border border-border cursor-pointer hover:bg-accent ${isFocused ? 'ring-2 ring-primary' : ''}`}
              onClick={() => onSelect(shell.name)}
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
      </div>
      <HotkeyHelpOverlay
        open={showHelp}
        onClose={() => setShowHelp(false)}
        context="shell-selector"
      />
    </div>
  );
}
