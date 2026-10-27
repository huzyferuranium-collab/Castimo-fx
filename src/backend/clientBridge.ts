/**
 * Client bridge: connects a client's broker account so master trades can be copied onto it.
 *
 * This file holds the whole connect pipeline and knows nothing about MetaApi's SDK. It talks to
 * a small `BrokerGateway` interface, so every step (and every failure) can be tested with a fake
 * broker, and the real MetaApi adapter (metaApiGateway.ts) stays thin.
 *
 * Pipeline, each step reported to the client as it happens:
 *   checking  -> master / duplicate / capacity checks
 *   creating  -> the broker is asked to confirm login, password and server
 *   deploying -> the cloud terminal starts
 *   syncing   -> the terminal syncs with the broker
 *   verifying -> account details are read from the broker and the rules are applied
 *
 * Principles:
 *  - Only the broker's own answers are trusted (see brokerVerification.ts).
 *  - A slow broker is not a failure: waits are generous, and a terminal that is still starting is
 *    KEPT so the next try resumes instead of starting from zero.
 *  - Errors say what happened and what to do next. Raw errors only go to the server log / admin view.
 */

import {
  BrokerVerificationError,
  checkConnectEligibility,
  clientAccountName,
  isOwnedBy,
  normalizeBrokerServer,
  pickServerAlias,
  countClientAccounts,
  sameLogin,
  translateBrokerError,
  validateSubmittedCredentials,
  verifyBrokerAccountInfo,
  type BrokerAccountInfo,
  type BrokerErrorCode,
  type VerifiedBrokerAccount,
} from './brokerVerification.ts';

// ---------- broker gateway (implemented by MetaApi in production, by a fake in tests) ----------

export interface RpcHandle {
  connect(): Promise<void>;
  waitSynchronized(seconds: number): Promise<void>;
  getAccountInformation(): Promise<BrokerAccountInfo>;
  /** The underlying SDK object, kept so the copy engine can use it. */
  raw?: unknown;
}

export interface AccountHandle {
  id: string;
  name?: string;
  login: string | number;
  server: string;
  waitDeployed(seconds: number): Promise<void>;
  rpc(): RpcHandle;
  raw?: unknown;
}

export interface AccountSummary {
  id: string;
  name?: string;
  login: string | number;
  server: string;
}

export interface CreateAccountParams {
  name: string;
  login: string;
  password: string;
  server: string;
  platform: 'mt4' | 'mt5';
  magic: number;
  region: string;
  reliability: 'regular' | 'high';
}

export interface BrokerGateway {
  listAccounts(): Promise<AccountSummary[]>;
  createAccount(p: CreateAccountParams): Promise<{ id: string }>;
  getAccount(id: string): Promise<AccountHandle>;
  removeAccount(id: string): Promise<void>;
}

// ---------- stages ----------

export type Stage = 'queued' | 'checking' | 'creating' | 'deploying' | 'syncing' | 'verifying' | 'done' | 'failed';

export const STAGE_INFO: Record<Stage, { percent: number; label: string }> = {
  queued: { percent: 3, label: 'Starting…' },
  checking: { percent: 10, label: 'Checking your details…' },
  creating: { percent: 25, label: 'Asking your broker to confirm the login…' },
  deploying: { percent: 50, label: 'Starting your trading terminal…' },
  syncing: { percent: 75, label: 'Syncing with your broker…' },
  verifying: { percent: 90, label: 'Reading your account from the broker…' },
  done: { percent: 100, label: 'Connected' },
  failed: { percent: 0, label: 'Could not connect' },
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

function withTimeout<T>(promise: Promise<T>, seconds: number, stage: Stage): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new StageTimeoutError(stage)), Math.max(0, seconds) * 1000);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// ---------- settings ----------

export interface BridgeTimeouts {
  listSeconds: number;
  createSeconds: number;
  deploySeconds: number;
  connectSeconds: number;
  syncSeconds: number;
  infoSeconds: number;
}

export const DEFAULT_TIMEOUTS: BridgeTimeouts = {
  listSeconds: 30,
  createSeconds: 120,
  deploySeconds: 180,
  connectSeconds: 60,
  syncSeconds: 120,
  infoSeconds: 30,
};

export interface BridgeLimits {
  maxTotal: number; // 0 = no limit
  maxPerUser: number; // 0 = no limit
  minEquity: number;
}

export interface BridgeDeps {
  gateway: BrokerGateway;
  /** True if this login is the platform's master account. */
  isMaster: (login: string, server: string) => boolean;
  /** True if another user already has this login connected in memory. */
  linkedToOtherUser: (login: string, server: string, userId: string) => boolean;
  limits: BridgeLimits;
  timeouts?: Partial<BridgeTimeouts>;
  /** Server-side diagnostics only; never shown to clients. */
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

export interface ConnectInput {
  userId: string;
  login: string;
  password: string;
  server: string;
  platform?: 'mt4' | 'mt5';
  magic?: number;
  region?: string;
  reliability?: 'regular' | 'high';
}

export interface ConnectResult {
  account: AccountHandle;
  rpc: RpcHandle;
  verified: VerifiedBrokerAccount;
  server: string;
  /** True when an account that already existed for this user was reused. */
  resumed: boolean;
}

/** Friendly "what to do next" line for each error code. */
export function friendlyHint(code: BrokerErrorCode | string): string {
  switch (code) {
    case 'BROKER_AUTH_FAILED':
      return 'Check the account number and use your trading (master) password, not the investor password. The server must match your MT5 login screen.';
    case 'BROKER_SERVER_NOT_FOUND':
      return 'Copy the server name exactly as it appears on your MT5 login screen.';
    case 'BROKER_SLOW':
    case 'BROKER_UNREACHABLE':
      return 'Your broker is slow to answer right now. Nothing is lost: wait a minute, then press Connect again and it will carry on.';
    case 'VERIFICATION_UNAVAILABLE':
      return 'We could not reach our verification service. Please try again in a few minutes.';
    case 'MIN_EQUITY':
      return 'Add funds to your trading account, then connect again.';
    case 'UNSUPPORTED_CURRENCY':
      return 'Open or use an account in US dollars (USD) to connect.';
    case 'TRADING_NOT_ALLOWED':
      return 'Use the trading password. The investor password is read-only and cannot copy trades.';
    case 'ALREADY_LINKED':
      return 'Each broker account can be linked to one CASTIMOFx user only.';
    case 'IS_MASTER_ACCOUNT':
      return 'Please enter your own broker account.';
    case 'CAPACITY':
      return 'Please try again later or contact support.';
    case 'LOGIN_MISMATCH':
      return 'Check the account number you entered.';
    case 'BAD_INPUT':
      return 'Please correct the highlighted details and try again.';
    default:
      return 'Please try again. If it keeps happening, contact support with the reference code.';
  }
}

const STAGE_SLOW_TEXT: Partial<Record<Stage, string>> = {
  checking: 'Our verification service is slow to answer.',
  creating: 'Your broker is taking a long time to confirm the login.',
  deploying: 'Your trading terminal is still starting up.',
  syncing: 'Your terminal started but is still syncing with your broker.',
  verifying: 'Your broker is slow to send your account details.',
};

/** Turns any failure into an error that is safe to show a client. */
export function toClientError(
  err: unknown,
  creds: { login: string; server: string },
  stage: Stage,
  log?: BridgeDeps['log']
): BrokerVerificationError {
  if (err instanceof BrokerVerificationError) return err;
  const anyErr = err as any;

  const isTimeout =
    err instanceof StageTimeoutError ||
    String(anyErr?.name || '') === 'TimeoutError' ||
    /time(d)? ?out/i.test(String(anyErr?.message || ''));
  if (isTimeout) {
    const at: Stage = err instanceof StageTimeoutError ? err.stage : stage;
    const e = new BrokerVerificationError(
      'BROKER_SLOW',
      `${STAGE_SLOW_TEXT[at] || 'The broker is slow to answer.'} Nothing is lost, so press Connect again in a minute and it will continue.`
    );
    e.ref = `TIMEOUT_${at.toUpperCase()}`;
    return e;
  }

  const translated = translateBrokerError(anyErr, creds);
  if (translated.code === 'VERIFICATION_UNAVAILABLE') {
    log?.('error', `MetaApi refused our own credentials/quota: ${String(anyErr?.message || anyErr).slice(0, 200)}`);
  }
  return translated;
}

const rejectsForGood = new Set<BrokerErrorCode | string>([
  'BROKER_AUTH_FAILED',
  'BROKER_SERVER_NOT_FOUND',
  'LOGIN_MISMATCH',
  'TRADING_NOT_ALLOWED',
  'MIN_EQUITY',
  'UNSUPPORTED_CURRENCY',
  'BAD_BROKER_RESPONSE',
]);

/**
 * Runs the whole connect pipeline for one user. Throws a BrokerVerificationError on any failure.
 * `onStage` is called whenever the pipeline moves to a new step.
 */
export async function connectClient(
  deps: BridgeDeps,
  input: ConnectInput,
  onStage: (stage: Stage) => void = () => {}
): Promise<ConnectResult> {
  const t: BridgeTimeouts = { ...DEFAULT_TIMEOUTS, ...(deps.timeouts || {}) };
  const log = deps.log;
  const { userId, platform = 'mt5', region = 'london', reliability = 'high' } = input;
  if (!userId) throw new BrokerVerificationError('BAD_INPUT', 'You must be signed in to connect an account.');

  const checked = validateSubmittedCredentials(input);
  const { login, password } = checked;
  let server = normalizeBrokerServer(checked.server);
  const sameServer = (a?: string) => String(a || '').trim().toLowerCase() === server.toLowerCase();

  let stage: Stage = 'checking';
  const go = (s: Stage) => {
    stage = s;
    onStage(s);
  };

  let createdId: string | undefined;
  try {
    go('checking');

    if (deps.isMaster(login, server)) {
      throw new BrokerVerificationError('IS_MASTER_ACCOUNT', "This is the platform's master account and cannot be connected as a client.");
    }
    if (deps.linkedToOtherUser(login, server, userId)) {
      throw new BrokerVerificationError('ALREADY_LINKED', 'This broker account is already linked to another user.');
    }

    const all = await withTimeout(deps.gateway.listAccounts(), t.listSeconds, 'checking');
    const existing = all.find((a) => sameLogin(a.login, login) && sameServer(a.server));

    if (existing) {
      if (!isOwnedBy(existing.name, userId)) {
        throw new BrokerVerificationError(
          'ALREADY_LINKED',
          'This broker account is already linked to another user or to the platform, so it cannot be connected here.'
        );
      }
    } else {
      // Cost guard: MetaApi charges per account.
      const mine = all.filter((a) => isOwnedBy(a.name, userId));
      if (deps.limits.maxPerUser > 0 && mine.length >= deps.limits.maxPerUser) {
        throw new BrokerVerificationError(
          'CAPACITY',
          'You already have a connected account. Disconnect it first to connect a different one.'
        );
      }
      if (deps.limits.maxTotal > 0 && countClientAccounts(all) >= deps.limits.maxTotal) {
        throw new BrokerVerificationError(
          'CAPACITY',
          'We have reached our limit for new connections right now. Please contact support to be added.'
        );
      }
    }

    // --- create (or resume) the broker account ---
    let accountId: string;
    let resumed = false;
    if (existing) {
      accountId = existing.id;
      resumed = true;
      log?.('info', `Resuming existing terminal for user ${userId} #${login}`);
    } else {
      go('creating');
      const create = (srv: string) =>
        withTimeout(
          deps.gateway.createAccount({
            name: clientAccountName(userId, login),
            login,
            password,
            server: srv,
            platform,
            magic: input.magic || 889900,
            region,
            reliability,
          }),
          t.createSeconds,
          'creating'
        );
      let dto: { id: string };
      try {
        try {
          dto = await create(server);
        } catch (e: any) {
          // Unknown server name: retry once with the spelling MetaApi itself lists, if it lists one.
          const list: string[] = e?.details?.serversByBrokers
            ? (Object.values(e.details.serversByBrokers).flat() as string[])
            : [];
          const alias = pickServerAlias(server, list);
          if (!alias) throw e;
          log?.('info', `Server '${server}' resolved to MetaApi's '${alias}'.`);
          server = alias;
          dto = await create(alias);
        }
      } catch (e) {
        // A slow create may still have gone through on MetaApi's side. If it did, carry on with it.
        if (e instanceof StageTimeoutError) {
          const again = await deps.gateway.listAccounts().catch(() => [] as AccountSummary[]);
          const found = again.find((a) => isOwnedBy(a.name, userId) && sameLogin(a.login, login));
          if (found) {
            dto = { id: found.id };
            log?.('warn', `Create timed out for #${login} but the terminal exists; continuing with it.`);
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }
      createdId = dto.id;
      accountId = dto.id;
    }

    const account = await withTimeout(deps.gateway.getAccount(accountId), t.listSeconds, 'creating');
    if (!sameLogin(account.login, login) || !sameServer(account.server)) {
      throw new BrokerVerificationError('LOGIN_MISMATCH', 'The broker account does not match the details you entered.');
    }

    // --- deploy ---
    go('deploying');
    await withTimeout(account.waitDeployed(t.deploySeconds), t.deploySeconds, 'deploying');

    // --- sync ---
    go('syncing');
    const rpc = account.rpc();
    await withTimeout(rpc.connect(), t.connectSeconds, 'syncing');
    let info: BrokerAccountInfo | undefined;
    try {
      await withTimeout(rpc.waitSynchronized(t.syncSeconds), t.syncSeconds, 'syncing');
    } catch (e) {
      // The "synchronized" signal can lag even when the broker already answers. Ask the broker directly
      // before giving up; if it answers, the account is genuinely reachable and we carry on.
      if (!(e instanceof StageTimeoutError) && String((e as any)?.name || '') !== 'TimeoutError') throw e;
      log?.('warn', `Sync signal timed out for #${login}; asking the broker for the account directly.`);
      try {
        info = await withTimeout(rpc.getAccountInformation(), t.infoSeconds, 'syncing');
      } catch {
        throw e;
      }
    }

    // --- verify ---
    go('verifying');
    if (!info) info = await withTimeout(rpc.getAccountInformation(), t.infoSeconds, 'verifying');
    const verified = verifyBrokerAccountInfo(info, { login, server });
    // Minimum equity applies to NEW connections only; it is never used to disconnect anyone later.
    checkConnectEligibility(verified, deps.limits.minEquity);

    return { account, rpc, verified, server, resumed };
  } catch (error: any) {
    const safe = toClientError(error, { login, server }, stage, log);
    log?.('warn', `Connect failed for #${login} at '${stage}' (${safe.code}); raw: ${String(error?.message || error).slice(0, 300)}`);

    // Remove an account we just created only when the broker rejected it for good.
    // A slow terminal is kept, so the next attempt resumes it (one account per user is enforced).
    if (createdId && rejectsForGood.has(safe.code)) {
      try {
        await deps.gateway.removeAccount(createdId);
      } catch (cleanupErr: any) {
        log?.('warn', `Could not remove unverified account ${createdId}: ${cleanupErr?.message}`);
      }
    }
    safe.stage = stage;
    throw safe;
  }
}

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
  status: 'running' | 'done' | 'failed';
  stage: Stage;
  label: string;
  percent: number;
  startedAt: string;
  updatedAt: string;
  elapsedSeconds: number;
  error?: JobError;
  result?: R;
}

export interface FailureLogEntry {
  at: string;
  user: string; // masked
  login: string;
  server: string;
  stage: Stage;
  code: string;
  ref?: string;
  raw: string;
}

const RETRYABLE = new Set<string>(['BROKER_SLOW', 'BROKER_UNREACHABLE', 'VERIFICATION_UNAVAILABLE']);

interface Job<R> {
  id: string;
  userId: string;
  loginKey: string;
  status: 'running' | 'done' | 'failed';
  stage: Stage;
  startedAt: number;
  updatedAt: number;
  error?: JobError;
  result?: R;
}

export class ConnectJobs<R = unknown> {
  private jobs = new Map<string, Job<R>>();
  private failures: FailureLogEntry[] = [];
  private seq = 0;
  private now: () => number;
  private keepMs: number;
  private maxRunMs: number;

  constructor(opts: { now?: () => number; keepMs?: number; maxRunMs?: number } = {}) {
    this.now = opts.now ?? Date.now;
    this.keepMs = opts.keepMs ?? 10 * 60_000;
    this.maxRunMs = opts.maxRunMs ?? 8 * 60_000;
  }

  private view(j: Job<R>): JobView<R> {
    const info = STAGE_INFO[j.status === 'failed' ? 'failed' : j.status === 'done' ? 'done' : j.stage];
    return {
      jobId: j.id,
      status: j.status,
      stage: j.status === 'running' ? j.stage : j.status === 'done' ? 'done' : 'failed',
      label: info.label,
      percent: j.status === 'failed' ? STAGE_INFO[j.stage]?.percent ?? 0 : info.percent,
      startedAt: new Date(j.startedAt).toISOString(),
      updatedAt: new Date(j.updatedAt).toISOString(),
      elapsedSeconds: Math.max(0, Math.round((this.now() - j.startedAt) / 1000)),
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
      status: 'running',
      stage: 'queued',
      startedAt: t,
      updatedAt: t,
    };
    this.jobs.set(userId, job);

    const report = (s: Stage) => {
      if (job.status !== 'running') return;
      job.stage = s;
      job.updatedAt = this.now();
    };

    const guard = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new StageTimeoutError(job.stage, 'Overall connect time exceeded')), this.maxRunMs);
      (timer as any).unref?.();
    });

    Promise.race([run(report), guard]).then(
      (result) => {
        job.status = 'done';
        job.result = result;
        job.updatedAt = this.now();
      },
      (err: any) => {
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
        for (const s of meta.secrets || []) if (s && s.length >= 3) raw = raw.split(s).join('***');
        this.failures.unshift({
          at: new Date(this.now()).toISOString(),
          user: userId.length > 6 ? `${userId.slice(0, 3)}…${userId.slice(-3)}` : '***',
          login: meta.login,
          server: meta.server,
          stage: (err as any)?.stage || job.stage,
          code,
          ref,
          raw,
        });
        this.failures.length = Math.min(this.failures.length, 50);
      }
    );

    return { job: this.view(job), started: true };
  }

  /** Recent failures with the technical reason, for the administrator. */
  recentFailures(): FailureLogEntry[] {
    return this.failures.slice();
  }
}
