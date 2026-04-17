import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { useDrag } from '@/hooks/use-drag';
import type { SystemMetrics, SystemMetricsSnapshot } from '@/system-metrics';
import type { TerminalDiagnostics } from '@/terminal-core';

interface SystemMeterPanelProps {
  open: boolean;
  metrics: SystemMetrics;
  onClose: () => void;
  getTerminalDiagnostics?: () => TerminalDiagnostics | undefined;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function formatMs(n: number): string {
  return n > 0 ? `${n}ms` : '-';
}

const emptySnapshot: SystemMetricsSnapshot = {
  rtt: { min1: 0, min5: 0, min10: 0 },
  fps: 0,
  dataIn: { min1: 0, min5: 0, min10: 0 },
  dataOut: { min1: 0, min5: 0, min10: 0 },
};

export function SystemMeterPanel({ open, metrics, onClose, getTerminalDiagnostics }: SystemMeterPanelProps) {
  const [snap, setSnap] = useState<SystemMetricsSnapshot>(emptySnapshot);
  const [diag, setDiag] = useState<TerminalDiagnostics | undefined>(undefined);
  const { x, y, handleProps } = useDrag(window.innerWidth - 260, 16);

  useEffect(() => {
    if (!open) return;
    const tick = () => {
      setSnap(metrics.getSnapshot());
      setDiag(getTerminalDiagnostics?.());
    };
    tick();
    const id = setInterval(() => {
      if (document.hidden) return;
      tick();
    }, 1000);
    return () => clearInterval(id);
  }, [open, metrics, getTerminalDiagnostics]);

  const handleClose = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      className="absolute z-50 min-w-[240px] rounded-lg border border-border bg-[var(--bar-bg)] backdrop-blur-sm shadow-lg font-mono text-xs text-foreground select-none"
      style={{ left: x, top: y }}
    >
      {/* Draggable header */}
      <div
        className="flex items-center justify-between px-2 py-1 cursor-grab active:cursor-grabbing border-b border-border"
        {...handleProps}
      >
        <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">System Meter</span>
        <button
          type="button"
          className="flex items-center justify-center w-5 h-5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          onPointerUp={handleClose}
          tabIndex={-1}
          aria-label="Close meter"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Metrics */}
      <div className="px-2 py-1.5 space-y-1">
        {/* RTT */}
        <div>
          <span className="text-muted-foreground">RTT </span>
          <span>1m:{formatMs(snap.rtt.min1)} 5m:{formatMs(snap.rtt.min5)} 10m:{formatMs(snap.rtt.min10)}</span>
        </div>

        {/* FPS */}
        <div>
          <span className="text-muted-foreground">FPS </span>
          <span>{snap.fps}</span>
        </div>

        {/* Data In */}
        <div>
          <span className="text-muted-foreground">In  </span>
          <span>1m:{formatBytes(snap.dataIn.min1)} 5m:{formatBytes(snap.dataIn.min5)} 10m:{formatBytes(snap.dataIn.min10)}</span>
        </div>

        {/* Data Out */}
        <div>
          <span className="text-muted-foreground">Out </span>
          <span>1m:{formatBytes(snap.dataOut.min1)} 5m:{formatBytes(snap.dataOut.min5)} 10m:{formatBytes(snap.dataOut.min10)}</span>
        </div>

        {diag && (
          <>
            <div>
              <span className="text-muted-foreground">Term </span>
              <span>{diag.renderer} {diag.rows}x{diag.cols}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Buf  </span>
              <span>base:{diag.baseY} vp:{diag.viewportY} len:{diag.bufferLength} cap:{diag.scrollback}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
