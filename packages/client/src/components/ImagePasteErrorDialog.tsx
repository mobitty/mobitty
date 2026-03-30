import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { ImagePasteErrorInfo } from '../terminal-core';

interface ImagePasteErrorDialogProps {
  error: ImagePasteErrorInfo | null;
  onClose: () => void;
}

export function ImagePasteErrorDialog({ error, onClose }: ImagePasteErrorDialogProps) {
  return (
    <Dialog open={error !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Image paste failed</DialogTitle>
          <DialogDescription>
            The image could not be pasted. See details below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {error?.clipboardError && (
            <div>
              <span className="font-medium">System clipboard: </span>
              <code className="text-xs bg-muted px-1 py-0.5 rounded">{error.clipboardError}</code>
            </div>
          )}
          {error?.fileError && (
            <div>
              <span className="font-medium">File save: </span>
              <code className="text-xs bg-muted px-1 py-0.5 rounded">{error.fileError}</code>
            </div>
          )}

          <div className="border-t pt-3 space-y-2">
            <p className="font-medium">To resolve:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>
                Set <code className="text-xs bg-muted px-1 py-0.5 rounded">imagePasteDir</code> in
                your profile (Settings) to a writable relative directory path
                {error?.imagePasteDir && (
                  <span> (attempted: <code className="text-xs bg-muted px-1 py-0.5 rounded">{error.imagePasteDir}</code>)</span>
                )}
              </li>
              <li>
                Ensure the target directory exists and is writable by the shell user
              </li>
              <li>
                Or install a display server and set <code className="text-xs bg-muted px-1 py-0.5 rounded">DISPLAY</code> (Linux),
                or ensure a GUI session is active (macOS)
              </li>
            </ol>
          </div>
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
