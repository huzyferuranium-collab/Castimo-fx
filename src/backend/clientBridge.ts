/**
 * Connect progress, shared by the connect flow (MT5_CONNECTION_MANAGER.ts) and the dashboard.
 *
 * This file knows nothing about the copier service. It holds:
 *   - the steps a connection goes through and how each is worded for the client,
 *   - one background job per user that the browser polls (ConnectJobs),
 *   - the limiter that keeps a burst of clients from overloading the copier service (ProvisionGate),
 *   - the calm "what to do next" lines for every failure.
 *
 * Steps, each reported to the client as it happens:
 *   checking  -> master / duplicate / capacity checks
 *   creating  -> the client's account is added and the broker is asked to confirm login, password and server
 *   syncing   -> waiting for the broker's answer through the copier service
 *   verifying -> the account's real figures are read and our rules are applied
 *
 * Principles:
 *  - Only the broker's own answers are trusted (see brokerVerification.ts).
 *  - A slow broker is not a failure: a connection that is still going carries on in the background.
 *  - Errors say what happened and what to do next. Raw errors only go to the server log / admin view.
 */

import { BrokerVerificationError, type BrokerErrorCode } from './brokerVerification.ts';

// ---------- stages ----------

export type Stage =
  | 'queued'
  | 'checking'
  | 'creating'
  | 'deploying'
  | 'syncing'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'background';

export const STAGE_INFO: Record<Stage, { percent: number; label: string }> = {
  queued: { percent: 3, label: 'Starting…' },
  checking: { percent: 10, label: 'Checking your details…' },
  creating: { percent: 25, label: 'Asking your broker to confirm the login…' },
  deploying: { percent: 50, label: 'Setting up your copy link…' },
  syncing: { percent: 75, label: 'Syncing with your broker…' },
  verifying: { percent: 90, label: 'Reading your account from the broker…' },
  done: { percent: 100, label: 'Connected' },
  failed: { percent: 0, label: 'Could not connect' },
  background: { percent: 0, label: 'Still connecting in the background' },
};

/** Raised when one stage runs out of time. The stage tells the client which part was slow. */
export class StageTimeoutError extends Error {
  stage: Stage;
  constructor(stage: Stage, message = `Timed out while ${stage}`) {
    super(message);
    this.name = 'StageTimeoutError';
    this.stage = stage;
  }
}

export function withTimeout<T>(promise: Promise<T>, seconds: number, stage: Stage): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new StageTimeoutError(stage)), Math.max(0, seconds) * 1000);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

/**
 * Keeps a burst of clients from overloading the copier service and from overshooting the account limit.
 *  - `run` lets only `maxParallel` broker-login checks (the slow, rate-limited call) go at once;
 *    the rest wait their turn.
 *  - `reserve` claims one of the limited account slots between "capacity was checked" and "the account
 *    shows up in the copier service's list", so two clients at the limit cannot both get the last slot.
 * One instance is shared by every connection (see the manager).
 */
export class ProvisionGate {
  private running = 0;
  private waiting: Array<() => void> = [];
  private claims = new Map<string, { accountId?: string }>();

  private readonly maxParallel: number;

  constructor(maxParallel: number = 3) {
    this.maxParallel = maxParallel;
  }

  get queued(): number {
    return this.waiting.length;
  }

  async run<T>(fn: () => Promise<T>, onWait?: () => void): Promise<T> {
    if (this.maxParallel > 0 && this.running >= this.maxParallel) {
      onWait?.();
      // The finishing task hands its slot straight to us, so `running` already counts us when we wake.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running++;
    }
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }

  reserve(userId: string): void {
    this.claims.set(userId, {});
  }
  /** Once the account exists it is counted by the copier service's own list, so the claim stops counting twice. */
  attach(userId: string, accountId: string): void {
    const c = this.claims.get(userId);
    if (c) c.accountId = accountId;
  }
  release(userId: string): void {
    this.claims.delete(userId);
  }
  /** Other users' claims that the service's list (`listed`) does not show yet. */
  pendingClaimsOf(userId: string, listed: Array<{ id: string }>): number {
    const ids = new Set(listed.map((a) => a.id));
    let n = 0;
    for (const [uid, c] of this.claims) {
      if (uid === userId) continue;
      if (c.accountId && ids.has(c.accountId)) continue;
      n++;
    }
    return n;
  }
}

/** Friendly "what to do next" line for each error code. */
export function friendlyHint(code: BrokerErrorCode | string): string {
  switch (code) {
    case 'BROKER_AUTH_FAILED':
      return 'Please check the account number and use your trading password (not the investor password). The server should match your MT5 login screen exactly.';
    case 'BROKER_SERVER_NOT_FOUND':
      return 'Please copy the server name exactly as it appears on your MT5 login screen.';
    case 'BROKER_SLOW':
    case 'BROKER_UNREACHABLE':
      return 'Your broker is a little slow right now. Nothing is lost: wait a minute, then press Connect again and it will carry on from where it stopped.';
    case 'VERIFICATION_UNAVAILABLE':
      return 'Nothing is wrong with your account. We had a small hiccup on our side. Your details are still here: please press Connect again in a few minutes.';
    case 'MIN_EQUITY':
      return 'Once your account has the minimum, press Connect again. We will be glad to have you.';
    case 'UNSUPPORTED_CURRENCY':
      return 'You can connect any account held in US dollars (USD).';
    case 'TRADING_NOT_ALLOWED':
      return 'Please use your trading password. The investor password can only view the account, so it cannot copy trades.';
    case 'ALREADY_LINKED':
      return 'Each broker account can be linked to one CASTIMOFx user. If this is your own account, please contact support and we will sort it out.';
    case 'IS_MASTER_ACCOUNT':
      return 'Please enter your own broker account details.';
    case 'CAPACITY':
      return 'Please try again a little later, or contact support and we will help.';
    case 'ALREADY_CONNECTED':
      return 'Open Profile, choose Disconnect MT5, then connect the new account. Your current account is not affected until you do.';
    case 'LOGIN_MISMATCH':
      return 'Please check the account number you entered.';
    case 'BAD_INPUT':
      return 'Please check the details above and try again.';
    default:
      return 'Nothing is lost. Please try again in a minute. If it keeps happening, message support with the reference below and we will take care of it for you.';
  }
}

export const rejectsForGood = new Set<BrokerErrorCode | string>([
  'BROKER_AUTH_FAILED',
  'BROKER_SERVER_NOT_FOUND',
  'LOGIN_MISMATCH',
  'TRADING_NOT_ALLOWED',
  'MIN_EQUITY',
  'UNSUPPORTED_CURRENCY',
  'BAD_BROKER_RESPONSE',
]);

// ---------- connect jobs: one background connection per user, polled by the browser ----------

export interface JobError {
  code: string;
  message: string;
  hint: string;
  retryable: boolean;
  ref?: string;
}

export interface JobView<R = unknown> {
  jobId: string;
  /**
   * 'background' means the browser no longer has to wait: the account exists and the server keeps
   * looking after it. The client is told so calmly, and the dashboard updates by itself when it connects.
   */
  status: 'running' | 'done' | 'failed' | 'background';
  stage: Stage;
  label: string;
  percent: number;
  startedAt: string;
  updatedAt: string;
  elapsedSeconds: number;
  /** A calm explanation of what happens next (when status is 'background'). */
  message?: string;
  error?: JobError;
  result?: R;
}

/** Seconds spent in each step, so the admin can see which one was slow. */
export type StageTimings = Partial<Record<Stage, number>>;

export interface FailureLogEntry {
  at: string;
  user: string; // masked
  login: string;
  server: string;
  stage: Stage;
  code: string;
  ref?: string;
  raw: string;
  timings?: StageTimings;
  /** True when the connection went on in the background instead of failing. */
  background?: boolean;
}

export interface SuccessLogEntry {
  at: string;
  user: string; // masked
  login: string;
  server: string;
  totalSeconds: number;
  timings: StageTimings;
}

/**
 * Thrown from a job's `run` when the foreground attempt is over but the account is still being
 * looked after in the background. The job shows a calm "still connecting" state instead of a failure.
 */
export class HandedOff extends Error {
  readonly code = 'BACKGROUND';
  stage?: Stage;
  ref?: string;
  detail?: string;
  constructor(message: string, opts: { stage?: Stage; ref?: string; detail?: string } = {}) {
    super(message);
    this.name = 'HandedOff';
    this.stage = opts.stage;
    this.ref = opts.ref;
    this.detail = opts.detail;
  }
}

export const BACKGROUND_MESSAGE =
  'Your account is taking a little longer to connect with your broker. You do not need to wait here: we will keep going in the background, and your dashboard will update by itself when it is ready.';

const RETRYABLE = new Set<string>(['BROKER_SLOW', 'BROKER_UNREACHABLE', 'VERIFICATION_UNAVAILABLE']);

interface Job<R> {
  id: string;
  userId: string;
  loginKey: string;
  login: string;
  server: string;
  status: 'running' | 'done' | 'failed' | 'background';
  stage: Stage;
  stageSince: number;
  timings: StageTimings;
  startedAt: number;
  updatedAt: number;
  message?: string;
  error?: JobError;
  result?: R;
}

const maskUser = (userId: string) => (userId.length > 6 ? `${userId.slice(0, 3)}…${userId.slice(-3)}` : '***');

export class ConnectJobs<R = unknown> {
  private jobs = new Map<string, Job<R>>();
  private failures: FailureLogEntry[] = [];
  private successes: SuccessLogEntry[] = [];
  private seq = 0;
  private now: () => number;
  private keepMs: number;
  private maxRunMs: number;
  private canContinue?: (userId: string) => boolean;

  constructor(
    opts: {
      now?: () => number;
      keepMs?: number;
      maxRunMs?: number;
      /** Asked when the overall time limit is reached: true if the user's connection can carry on in the background. */
      canContinueInBackground?: (userId: string) => boolean;
    } = {}
  ) {
    this.now = opts.now ?? Date.now;
    this.keepMs = opts.keepMs ?? 10 * 60_000;
    this.maxRunMs = opts.maxRunMs ?? 9 * 60_000;
    this.canContinue = opts.canContinueInBackground;
  }

  private view(j: Job<R>): JobView<R> {
    const stage: Stage = j.status === 'running' ? j.stage : j.status === 'done' ? 'done' : j.status === 'background' ? 'background' : 'failed';
    const info = STAGE_INFO[stage];
    // A job that failed or moved to the background keeps the progress it had reached.
    const percent = j.status === 'failed' || j.status === 'background' ? STAGE_INFO[j.stage]?.percent ?? 0 : info.percent;
    return {
      jobId: j.id,
      status: j.status,
      stage,
      label: info.label,
      percent,
      startedAt: new Date(j.startedAt).toISOString(),
      updatedAt: new Date(j.updatedAt).toISOString(),
      elapsedSeconds: Math.max(0, Math.round((this.now() - j.startedAt) / 1000)),
      message: j.message,
      error: j.error,
      result: j.result,
    };
  }

  private sweep(): void {
    const cutoff = this.now() - this.keepMs;
    for (const [uid, j] of this.jobs) {
      if (j.status !== 'running' && j.updatedAt < cutoff) this.jobs.delete(uid);
    }
  }

  /** Adds the time spent in the current step to the job's timings. */
  private closeStage(j: Job<R>): void {
    const t = this.now();
    j.timings[j.stage] = (j.timings[j.stage] ?? 0) + Math.max(0, t - j.stageSince) / 1000;
    j.stageSince = t;
  }

  private timingsOf(j: Job<R>): StageTimings {
    const out: StageTimings = {};
    for (const [k, v] of Object.entries(j.timings)) out[k as Stage] = Math.round((v as number) * 10) / 10;
    return out;
  }

  /** The user's latest job (running, finished or failed), or null. */
  get(userId: string): JobView<R> | null {
    this.sweep();
    const j = this.jobs.get(userId);
    return j ? this.view(j) : null;
  }

  /**
   * Starts a connection for the user. If one is already running it is returned instead of
   * starting a second (a double-click or a second tab never makes a duplicate).
   * `secrets` are scrubbed from anything that is logged.
   */
  start(
    userId: string,
    meta: { login: string; server: string; secrets?: string[] },
    run: (report: (s: Stage) => void) => Promise<R>
  ): { job: JobView<R>; started: boolean } {
    this.sweep();
    const running = this.jobs.get(userId);
    if (running && running.status === 'running') return { job: this.view(running), started: false };

    const loginKey = `${meta.login}@${meta.server}`.toLowerCase();
    for (const j of this.jobs.values()) {
      if (j.status === 'running' && j.userId !== userId && j.loginKey === loginKey) {
        throw new BrokerVerificationError('ALREADY_LINKED', 'This broker account is being connected by another user right now.');
      }
    }

    const t = this.now();
    const job: Job<R> = {
      id: `job-${++this.seq}-${t.toString(36)}`,
      userId,
      loginKey,
      login: meta.login,
      server: meta.server,
      status: 'running',
      stage: 'queued',
      stageSince: t,
      timings: {},
      startedAt: t,
      updatedAt: t,
    };
    this.jobs.set(userId, job);

    const report = (s: Stage) => {
      if (job.status !== 'running') return;
      this.closeStage(job);
      job.stage = s;
      job.updatedAt = this.now();
    };

    const scrub = (text: string) => {
      let out = text;
      for (const s of meta.secrets || []) if (s && s.length >= 3) out = out.split(s).join('***');
      return out;
    };

    const logFailure = (entry: Omit<FailureLogEntry, 'at' | 'user' | 'login' | 'server' | 'timings'>) => {
      this.failures.unshift({
        at: new Date(this.now()).toISOString(),
        user: maskUser(userId),
        login: meta.login,
        server: meta.server,
        timings: this.timingsOf(job),
        ...entry,
      });
      this.failures.length = Math.min(this.failures.length, 50);
    };

    const moveToBackground = (info: { stage?: Stage; ref?: string; detail?: string; raw: string }) => {
      this.closeStage(job);
      job.status = 'background';
      job.message = BACKGROUND_MESSAGE;
      job.updatedAt = this.now();
      logFailure({ stage: info.stage || job.stage, code: 'BACKGROUND', ref: info.ref, raw: scrub(info.detail ? `${info.detail} | ${info.raw}` : info.raw), background: true });
    };

    // The overall time limit: the browser is never left waiting forever.
    const timer = setTimeout(() => {
      if (job.status !== 'running') return;
      if (this.canContinue?.(userId)) {
        moveToBackground({ ref: 'TIMEOUT_OVERALL', raw: 'Overall connect time exceeded' });
        return;
      }
      this.closeStage(job);
      job.status = 'failed';
      job.error = {
        code: 'BROKER_SLOW',
        message: 'Connecting is taking longer than expected. Nothing is lost, so press Connect again in a minute.',
        hint: friendlyHint('BROKER_SLOW'),
        retryable: true,
        ref: `TIMEOUT_${job.stage.toUpperCase()}`,
      };
      job.updatedAt = this.now();
      logFailure({ stage: job.stage, code: 'BROKER_SLOW', ref: job.error.ref, raw: 'Overall connect time exceeded' });
    }, this.maxRunMs);
    (timer as any).unref?.();

    run(report).then(
      (result) => {
        clearTimeout(timer);
        // A late success still counts, even after the time limit was reached.
        if (job.status === 'done') return;
        this.closeStage(job);
        job.status = 'done';
        job.result = result;
        job.error = undefined;
        job.message = undefined;
        job.updatedAt = this.now();
        this.successes.unshift({
          at: new Date(this.now()).toISOString(),
          user: maskUser(userId),
          login: meta.login,
          server: meta.server,
          totalSeconds: Math.round(((job.updatedAt - job.startedAt) / 1000) * 10) / 10,
          timings: this.timingsOf(job),
        });
        this.successes.length = Math.min(this.successes.length, 30);
      },
      (err: any) => {
        clearTimeout(timer);
        // The time limit already decided what the client sees; a late error changes nothing.
        if (job.status !== 'running') return;

        if (err instanceof HandedOff) {
          moveToBackground({ stage: err.stage, ref: err.ref, detail: err.detail, raw: String(err.message || '').slice(0, 300) });
          return;
        }

        this.closeStage(job);
        const code = err instanceof BrokerVerificationError ? err.code : err instanceof StageTimeoutError ? 'BROKER_SLOW' : 'UNKNOWN';
        const message =
          err instanceof BrokerVerificationError
            ? err.message
            : err instanceof StageTimeoutError
              ? 'Connecting is taking longer than expected. Nothing is lost, so press Connect again in a minute.'
              : 'Something went wrong on our side while connecting. Please try again.';
        const ref = (err as any)?.ref || (code === 'UNKNOWN' ? String(err?.name || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) : undefined);
        job.status = 'failed';
        job.error = { code, message, hint: friendlyHint(code), retryable: RETRYABLE.has(code) || code === 'UNKNOWN', ref };
        job.updatedAt = this.now();

        let raw = String(err?.message || err || '').slice(0, 300);
        if ((err as any)?.detail) raw = `${(err as any).detail} | ${raw}`;
        logFailure({ stage: (err as any)?.stage || job.stage, code, ref, raw: scrub(raw) });
      }
    );

    return { job: this.view(job), started: true };
  }

  /** Recent failures (and hand-offs to the background) with the technical reason, for the administrator. */
  recentFailures(): FailureLogEntry[] {
    return this.failures.slice();
  }

  /** Recent successful connections with how long each step took, for the administrator. */
  recentSuccesses(): SuccessLogEntry[] {
    return this.successes.slice();
  }
}

/**
 * What a client is told about a connection that has not finished: the one the server is still looking
 * after, or else the connection still running for them. That way a reload in the middle of connecting
 * still shows "connecting" instead of the Connect button.
 */
export function pendingFor<V extends { kind: 'working' | 'failed' }>(
  fromServer: V | null | undefined,
  job: Pick<JobView, 'status' | 'label'> | null | undefined
): V | { kind: 'working'; label: string } | null {
  if (fromServer) return fromServer;
  if (job && job.status === 'running') return { kind: 'working', label: job.label };
  return null;
}
