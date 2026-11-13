import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { rateLimit } from './rateLimit.ts';

/**
 * Scheduled work (billing sweeps, payment reminders) for a host that sleeps between visits, like Google Cloud Run.
 * There the server's own timers would never fire, so Cloud Scheduler calls POST /api/internal/jobs/<job> instead,
 * with the shared secret in the X-Cron-Secret header. Anywhere else the server keeps running its own timers.
 */

export const CRON_SECRET_HEADER = 'x-cron-secret';
const MIN_SECRET_LENGTH = 24;

/** True when SCHEDULED_JOBS=external: the server must not start its own timers and waits for the scheduler instead. */
export function usesExternalScheduler(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.SCHEDULED_JOBS ?? '').trim().toLowerCase() === 'external';
}

/** The scheduler's shared secret, or '' when it is missing or too short to be safe (the job routes then refuse everything). */
export function cronSecret(env: Record<string, string | undefined> = process.env): string {
  const s = String(env.CRON_SECRET ?? '').trim();
  return s.length >= MIN_SECRET_LENGTH ? s : '';
}

/** Compares the header to the secret in constant time. Never true when no usable secret is set. */
export function cronAuthorized(header: unknown, secret: string): boolean {
  if (!secret || typeof header !== 'string') return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface JobsRouterOptions<J extends string> {
  /** The jobs that may be called, by name. Each runs to the end before the answer is sent. */
  jobs: Record<J, () => Promise<void>>;
  /** Resolves once the server has finished starting (connections restored, billing ready). */
  ready: () => Promise<void>;
  secret: string;
  log?: (msg: string) => void;
}

export function createJobsRouter<J extends string>({ jobs, ready, secret, log = console.log }: JobsRouterOptions<J>): Router {
  const router = Router();
  const running = new Set<string>();

  // The scheduler calls about 7 times in 10 minutes; anything far beyond that is someone guessing the secret.
  const limit = rateLimit({ max: 30, windowMs: 10 * 60_000 });

  router.post('/:job', limit, async (req, res) => {
    if (!cronAuthorized(req.get(CRON_SECRET_HEADER), secret)) return res.status(403).json({ error: 'Forbidden' });
    const name = req.params.job;
    if (!Object.prototype.hasOwnProperty.call(jobs, name)) return res.status(404).json({ error: 'Unknown job' });
    if (running.has(name)) return res.status(409).json({ error: 'Already running' });

    running.add(name);
    const started = Date.now();
    try {
      await ready();
      await jobs[name as J]();
      log(`⏱️ [JOBS] ${name} finished in ${Math.round((Date.now() - started) / 1000)} s.`);
      return res.json({ ok: true, job: name });
    } catch (e: any) {
      log(`⚠️ [JOBS] ${name} failed: ${e?.message || e}`);
      return res.status(500).json({ error: 'Job failed' });
    } finally {
      running.delete(name);
    }
  });

  return router;
}
