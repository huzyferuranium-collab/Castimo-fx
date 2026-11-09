import { useEffect, useRef } from 'react';

/**
 * Runs `task` once straight away and then every `intervalMs`, but only while the page is visible.
 * A hidden tab makes no requests at all, and refreshes the moment the person comes back to it. That keeps the dashboards
 * live without every open tab asking the server all night.
 *
 * The latest `task` is always the one that runs, so it can use current state without restarting the timer.
 * Pass `enabled: false` to pause it. A task that throws or rejects is ignored: the next tick tries again.
 */
export function usePolling(task: () => void | Promise<unknown>, intervalMs: number, enabled = true): void {
  const latest = useRef(task);
  latest.current = task;

  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try {
        void Promise.resolve(latest.current()).catch(() => undefined);
      } catch {
        // a failing tick is retried on the next one
      }
    };
    run();
    const timer = setInterval(run, intervalMs);
    document.addEventListener('visibilitychange', run);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', run);
    };
  }, [intervalMs, enabled]);
}
