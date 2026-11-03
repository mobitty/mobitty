import { useEffect, useId, useRef } from 'react';
import { Button } from '@/components/ui/button';
import type { ConnectionClosedReason } from '../terminal-core';

interface ConnectionClosedDialogProps {
  reason: ConnectionClosedReason | null;
  onReconnect: () => void;
}

/// Shown over the terminal area when the current session's connection closed
/// without auto-reconnect. Deliberately *not* a Radix modal Dialog: the state
/// belongs to one session, so it must block only that session's terminal
/// (it is mounted inside the terminal frame) and leave the session panel,
/// hotkeys and softkey bar usable for switching to another session. A modal
/// would portal to <body>, trap focus, aria-hide and pointer-lock the rest of
/// the app.
export function ConnectionClosedDialog({ reason, onReconnect }: ConnectionClosedDialogProps) {
  const titleId = useId();
  const descId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (reason !== null) buttonRef.current?.focus();
  }, [reason]);

  if (reason === null) return null;
  const isReplaced = reason === 'replaced';

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="absolute inset-0 z-40 flex items-center justify-center bg-background/90 backdrop-blur-sm p-4"
    >
      <div className="grid w-full max-w-lg gap-4 rounded-lg border bg-background p-6 shadow-lg">
        <div className="flex flex-col gap-2 text-center sm:text-left">
          <h2 id={titleId} className="text-lg leading-none font-semibold">
            {isReplaced ? 'Connection Replaced' : 'Connection Closed'}
          </h2>
          <p id={descId} className="text-sm text-muted-foreground">
            {isReplaced
              ? 'Another client has taken over this session.'
              : 'The connection to the server has been closed.'}
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={buttonRef} onClick={onReconnect}>Reconnect</Button>
        </div>
      </div>
    </div>
  );
}
