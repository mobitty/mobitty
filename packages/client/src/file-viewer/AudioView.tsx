// Audio preview: the browser's own `<audio controls>` player on a blob: URL.
// A data: URL would hold the whole file as one string the media stack
// re-parses on every seek; the CSP allows `media-src blob:` for this.

import { useEffect, useState } from 'react';

interface AudioViewProps {
  /** Base64 file bytes, as sent in VIEWER_FILE. */
  content: string;
  contentType: string;
}

export function AudioView({ content, contentType }: AudioViewProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const bytes = Uint8Array.from(atob(content), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
    setSrc(url);
    setFailed(false);
    return () => URL.revokeObjectURL(url);
  }, [content, contentType]);

  if (failed) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-sm text-muted-foreground text-center">
        This browser cannot play {contentType} audio
      </div>
    );
  }
  return (
    <div className="h-full flex items-center justify-center p-6">
      {src && <audio key={src} src={src} controls preload="metadata" className="w-full max-w-xl" onError={() => setFailed(true)} />}
    </div>
  );
}
