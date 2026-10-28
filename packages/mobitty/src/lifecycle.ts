import type { Logger } from './logger.ts';

/**
 * Signals that end the server through graceful shutdown. Node's default for
 * SIGHUP (console close on Windows, hangup on POSIX) and SIGBREAK (Ctrl+Break
 * on Windows) is to exit without a word, which leaves no record of the death.
 * SIGBREAK does not exist on POSIX; Node ignores listeners for it there.
 */
export const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const;
export type ShutdownSignal = typeof SHUTDOWN_SIGNALS[number];

type LifecycleLogger = Pick<Logger, 'info' | 'error' | 'close'>;

/**
 * Record every process death the server can observe in the file log:
 * uncaught exceptions and unhandled rejections (with the stack), the exit
 * code of any `process.exit()` or natural exit, and shutdown signals.
 * Log writes are synchronous, so each record lands before the process ends.
 *
 * A death with no `process exit` record was therefore an outside
 * `TerminateProcess` / SIGKILL, which no handler can observe.
 *
 * `uncaughtExceptionMonitor` observes without changing Node's default
 * handling: the stack still goes to stderr and the process still exits 1.
 */
export function installLifecycleLogging(
  logger: LifecycleLogger,
  shutdown: (signal: ShutdownSignal) => void,
  proc: NodeJS.EventEmitter = process,
): void {
  proc.on('uncaughtExceptionMonitor', (err: unknown, origin: string) => {
    logger.error('uncaught exception', {
      origin,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
  });
  proc.on('exit', (code: number) => {
    if (code === 0) logger.info('process exit', { code });
    else logger.error('process exit', { code });
    logger.close();
  });
  for (const signal of SHUTDOWN_SIGNALS) {
    proc.on(signal, () => shutdown(signal));
  }
}
