import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';

interface ConnectionSlowOverlayProps {
  open: boolean;
  /** Epoch ms of the next auto-reconnect attempt; null while one is in flight. */
  nextRetryAt: number | null;
  onRetryNow: () => void;
}

/** Whole seconds until `at`, re-rendering every 250ms while a retry is pending. */
function useSecondsUntil(at: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [at]);
  if (at === null) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/// Surfaced when the initial connect or a reconnect attempt has been
/// pending for more than ~2s. Same checklist as the iOS ErrorOverlayView
/// retry screen — the auto-reconnect loop keeps running underneath, so
/// this overlay clears itself the moment the socket reaches OPEN. Shows a
/// countdown to the next attempt and a button to try immediately.
export function ConnectionSlowOverlay({ open, nextRetryAt, onRetryNow }: ConnectionSlowOverlayProps) {
  const secondsLeft = useSecondsUntil(nextRetryAt);
  const status = secondsLeft === null || secondsLeft === 0
    ? 'Trying to connect…'
    : `Next try in ${secondsLeft}s`;
  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Still connecting…</DialogTitle>
          <DialogDescription>
            This is taking longer than usual. We'll keep retrying in the background.
          </DialogDescription>
        </DialogHeader>

        <div className="text-sm text-muted-foreground space-y-2">
          <div className="font-medium text-foreground">Things to check</div>
          <ul className="list-disc pl-5 space-y-1">
            <li>Is the Mobitty server running on your computer?</li>
            <li>Is the computer awake and on the same network?</li>
            <li>If using a VPN or SSH tunnel, is it connected?</li>
          </ul>
        </div>

        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {status}
          </span>
          <Button onClick={onRetryNow}>Retry now</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
