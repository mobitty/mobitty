import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ConnectionClosedReason } from '../terminal-core';

interface ConnectionClosedDialogProps {
  reason: ConnectionClosedReason | null;
  onReconnect: () => void;
}

export function ConnectionClosedDialog({ reason, onReconnect }: ConnectionClosedDialogProps) {
  const isReplaced = reason === 'replaced';

  return (
    <Dialog open={reason !== null}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {isReplaced ? 'Connection Replaced' : 'Connection Closed'}
          </DialogTitle>
          <DialogDescription>
            {isReplaced
              ? 'Another client has taken over this session.'
              : 'The connection to the server has been closed.'}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button onClick={onReconnect}>Reconnect</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
