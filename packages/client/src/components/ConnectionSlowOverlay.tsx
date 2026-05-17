import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface ConnectionSlowOverlayProps {
  open: boolean;
}

/// Surfaced when the initial connect or a reconnect attempt has been
/// pending for more than ~2s. Same checklist as the iOS ErrorOverlayView
/// retry screen — the auto-reconnect loop keeps running underneath, so
/// this overlay clears itself the moment the socket reaches OPEN.
export function ConnectionSlowOverlay({ open }: ConnectionSlowOverlayProps) {
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
      </DialogContent>
    </Dialog>
  );
}
