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
  /** Closes the link. Used when a check fails, so no half-open connection is left behind. */
  close?(): Promise<void>;
  /** The underlying SDK object, kept so the copy engine can use it. */
  raw?: unknown;
}

export interface AccountHandle {
  id: string;
  name?: string;
  login: string | number;
  server: string;
  /** What MetaApi said about the terminal at the moment it was fetched. */
  state?: string;
  connectionStatus?: string;
  waitDeployed(seconds: number): Promise<void>;
  /** Starts a terminal that is undeployed. */
  deploy(): Promise<void>;
  /** Restarts the terminal (the same as pressing "redeploy" in MetaApi). */
  redeploy(): Promise<void>;
  rpc(): RpcHandle;
  /** MetaApi's own view of the terminal right now (for the admin log when something is slow). */
  snapshot?(): Promise<{ state?: string; connectionStatus?: string }>;
  raw?: unknown;
}

export interface AccountSummary {
  id: string;
  name?: string;
  login: string | number;
  server: string;
  /** DEPLOYED, UNDEPLOYED, DRAFT, ... (as listed by MetaApi) */
  state?: string;
  /** CONNECTED, DISCONNECTED, DISCONNECTED_FROM_BROKER, ... */
  connectionStatus?: string;
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
  /** Like getAccount, but returns null when the terminal no longer exists (instead of throwing). */
  findAccount(id: string): Promise<AccountHandle | null>;
  /** Removes a terminal. Removing one that is already gone is not an error. */
  removeAccount(id: string): Promise<void>;
}

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
  deploying: { percent: 50, label: 'Starting your trading terminal…' },
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

// ---------- settings ----------

export interface BridgeTimeouts {
  listSeconds: number;
  createSeconds: number;
  deploySeconds: number;
  connectSeconds: number;
  syncSeconds: number;
  infoSeconds: number;
  /** While syncing, how often to ask the broker for the account directly. */
  probeEveryMs: number;
}

/**
 * How long the browser waits on each step. These are deliberately about "a few minutes in all": if a
 * terminal is still starting after that, the connection carries on in the background (the supervisor in
 * terminalSupervisor.ts keeps looking after it) instead of keeping the client waiting at a progress bar.
 */
export const DEFAULT_TIMEOUTS: BridgeTimeouts = {
  listSeconds: 30,
  createSeconds: 120,
  deploySeconds: 120,
  connectSeconds: 45,
  syncSeconds: 90,
  infoSeconds: 30,
  probeEveryMs: 3000,
};

export interface BridgeLimits {
  maxTotal: number; // 0 = no limit
  maxPerUser: number; // 0 = no limit
  minEquity: number;
}

/**
 * Keeps a burst of clients from overloading MetaApi and from overshooting the account limit.
 *  - `run` lets only `maxParallel` broker-login checks (the slow, rate-limited call) go at once;
 *    the rest wait their turn.
 *  - `reserve` claims one of the limited account slots between "capacity was checked" and "the terminal
 *    shows up in MetaApi's list", so two clients at the limit cannot both get the last slot.
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
  /** Once the terminal exists it is counted by MetaApi's own list, so the claim stops counting twice. */
  attach(userId: string, accountId: string): void {
    const c = this.claims.get(userId);
    if (c) c.accountId = accountId;
  }
  release(userId: string): void {
    this.claims.delete(userId);
  }
  /** Other users' claims that MetaApi's list (`listed`) does not show yet. */
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

export interface TerminalEvent {
  userId: string;
  accountId: string;
  login: string;
  server: string;
}

export interface BridgeDeps {
  gateway: BrokerGateway;
  /** True if this login is the platform's master account. */
  isMaster: (login: string, server: string) => boolean;
  /** True if another user already has this login connected in memory. */
  linkedToOtherUser: (login: string, server: string, userId: string) => boolean;
  /** The account this user already has connected and verified (in the live pool), if any. */
  activeAccountOf?: (userId: string) => { login: string; server: string } | null;
  /** True if the user has billing history, so any terminal they own must be kept, never cleaned up. */
  hasBillingHistory?: (userId: string) => Promise<boolean>;
  /**
   * True if this very terminal was verified for this user in the past (it is saved on our side). Such a
   * client is simply being reconnected, so the minimum-equity rule for NEW connections is not applied.
   */
  wasVerified?: (userId: string, accountId: string) => Promise<boolean>;
  /** Called as soon as the user's terminal exists (new or resumed), before it is started. Best effort. */
  onTerminalCreated?: (e: TerminalEvent & { resumed: boolean; previouslyVerified: boolean }) => void | Promise<void>;
  /** Called after a terminal of this user was removed on purpose (cleared or rejected). Best effort. */
  onTerminalRemoved?: (e: { userId: string; accountId: string }) => void | Promise<void>;
  /** Shared limiter and capacity claims. Without it connections simply run unlimited. */
  gate?: ProvisionGate;
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
  /** True when this very terminal was verified for this user before (a reconnect, not a new connection). */
  previouslyVerified: boolean;
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
      return 'We could not reach our verification service just now. Please try again in a few minutes.';
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
      return 'Please try again. If it keeps happening, contact support and quote the reference code, and we will look into it.';
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

export const rejectsForGood = new Set<BrokerErrorCode | string>([
  'BROKER_AUTH_FAILED',
  'BROKER_SERVER_NOT_FOUND',
  'LOGIN_MISMATCH',
  'TRADING_NOT_ALLOWED',
  'MIN_EQUITY',
  'UNSUPPORTED_CURRENCY',
  'BAD_BROKER_RESPONSE',
]);

/**
 * Waits until the broker is reachable. Two things run side by side and the first to succeed wins:
 *  - MetaApi's "synchronized" signal (which can lag), and
 *  - asking the broker for the account directly every few seconds.
 * Returns the account information if the direct ask answered first, or undefined if the sync signal did.
 */
export async function waitForBroker(
  rpc: RpcHandle,
  t: BridgeTimeouts,
  log: BridgeDeps['log'],
  login: string
): Promise<BrokerAccountInfo | undefined> {
  const deadline = Date.now() + t.syncSeconds * 1000;
  let stopped = false;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const probe = (async (): Promise<BrokerAccountInfo> => {
    let last: unknown;
    while (!stopped) {
      const left = (deadline - Date.now()) / 1000;
      if (left <= 0) break;
      try {
        return await withTimeout(rpc.getAccountInformation(), Math.min(t.infoSeconds, left), 'syncing');
      } catch (e) {
        last = e;
        await sleep(t.probeEveryMs);
      }
    }
    throw last ?? new StageTimeoutError('syncing');
  })();
  const signal = withTimeout(rpc.waitSynchronized(t.syncSeconds), t.syncSeconds, 'syncing');

  return await new Promise<BrokerAccountInfo | undefined>((resolve, reject) => {
    let pending = 2;
    const errors: unknown[] = [];
    const lose = (e: unknown) => {
      errors.push(e);
      if (--pending > 0) return;
      stopped = true;
      const timeout = errors.find((x) => x instanceof StageTimeoutError || String((x as any)?.name) === 'TimeoutError');
      reject(timeout ?? errors[0]);
    };
    probe.then(
      (info) => {
        stopped = true;
        log?.('info', `Broker answered directly for #${login}.`);
        resolve(info);
      },
      lose
    );
    signal.then(() => {
      stopped = true;
      resolve(undefined);
    }, lose);
  });
}

/**
 * Runs the whole connect pipeline for one user. Throws a BrokerVerificationError on any failure.
 * `onStage` is called whenever the pipeline moves to a new step.
 *
 * If it fails while the user's terminal exists and is merely slow, the error carries `accountId`
 * (the terminal was kept) so the caller can hand the connection to the supervisor to finish in the
 * background instead of telling the client it failed.
 */
export async function connectClient(
  deps: BridgeDeps,
  input: ConnectInput,
  onStage: (stage: Stage) => void = () => {}
): Promise<ConnectResult> {
  const t: BridgeTimeouts = { ...DEFAULT_TIMEOUTS, ...(deps.timeouts || {}) };
  const log = deps.log;
  const gate = deps.gate;
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

  let claimed = false; // holds one of the limited account slots until this attempt ends
  let createdId: string | undefined; // a terminal created by THIS attempt
  let accountId: string | undefined; // the user's terminal once it exists (new or resumed)
  let handle: AccountHandle | undefined;
  let previouslyVerified = false;

  /** Hooks are conveniences; one that fails must never fail the connection. */
  const hook = async (name: string, fn: () => unknown) => {
    try {
      await fn();
    } catch (e: any) {
      log?.('warn', `${name} hook failed: ${String(e?.message || e).slice(0, 200)}`);
    }
  };

  const assertCapacity = (list: AccountSummary[], justRemoved: number) => {
    if (deps.limits.maxTotal <= 0) return;
    const used = countClientAccounts(list) - justRemoved + (gate?.pendingClaimsOf(userId, list) ?? 0);
    if (used >= deps.limits.maxTotal) {
      throw new BrokerVerificationError(
        'CAPACITY',
        'We have reached our limit for new connections right now. Please contact support to be added.'
      );
    }
  };

  try {
    go('checking');

    if (deps.isMaster(login, server)) {
      throw new BrokerVerificationError('IS_MASTER_ACCOUNT', "This is the platform's master account and cannot be connected as a client.");
    }
    if (deps.linkedToOtherUser(login, server, userId)) {
      throw new BrokerVerificationError('ALREADY_LINKED', 'This broker account is already linked to another user.');
    }

    // One connected account per client keeps profit-share records exact, so a different account
    // can only be connected after the current one is disconnected. Said kindly, and with the way out.
    const active = deps.activeAccountOf?.(userId) ?? null;
    const alreadyConnected = (n: string) =>
      new BrokerVerificationError(
        'ALREADY_CONNECTED',
        `You are already connected with account #${n}, and it keeps copying trades. To use a different account, disconnect this one from your Profile first. That keeps your records accurate.`
      );
    if (active && !(sameLogin(active.login, login) && sameServer(active.server))) throw alreadyConnected(active.login);

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
      let mine = all.filter((a) => isOwnedBy(a.name, userId));
      let cleared = 0;
      if (mine.length) {
        // Terminals from an earlier attempt that never finished connecting are cleared automatically, so a
        // client is never stuck behind an account they cannot even see. A terminal that belongs to a
        // truly connected client (or one with billing history) is never touched.
        if (active || (await deps.hasBillingHistory?.(userId).catch(() => true))) {
          throw alreadyConnected(String(mine[0].login));
        }
        const left: AccountSummary[] = [];
        for (const a of mine) {
          try {
            await deps.gateway.removeAccount(a.id);
            cleared++;
            log?.('info', `Cleared an unfinished terminal #${a.login} for user ${userId} to make room.`);
            await hook('onTerminalRemoved', () => deps.onTerminalRemoved?.({ userId, accountId: a.id }));
          } catch (cleanupErr: any) {
            log?.('warn', `Could not clear unfinished terminal ${a.id}: ${cleanupErr?.message}`);
            left.push(a);
          }
        }
        mine = left;
      }
      if (deps.limits.maxPerUser > 0 && mine.length >= deps.limits.maxPerUser) {
        throw new BrokerVerificationError(
          'CAPACITY',
          'We could not free up your earlier connection attempt just now. Please try again in a minute.'
        );
      }
      assertCapacity(all, cleared);
      // Claim the slot at once (no waiting in between), so two clients at the limit cannot both take the last one.
      if (gate) {
        gate.reserve(userId);
        claimed = true;
      }
    }

    // --- create (or resume) the broker account ---
    let resumed = false;
    if (existing) {
      accountId = existing.id;
      resumed = true;
      try {
        previouslyVerified = Boolean(await deps.wasVerified?.(userId, existing.id));
      } catch {
        previouslyVerified = false;
      }
      log?.('info', `Resuming existing terminal for user ${userId} #${login}${previouslyVerified ? ' (verified before)' : ''}`);
    } else {
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

      const createWithRecovery = async (): Promise<{ id: string }> => {
        go('creating');
        try {
          try {
            return await create(server);
          } catch (e: any) {
            // Unknown server name: retry once with the spelling MetaApi itself lists, if it lists one.
            const list: string[] = e?.details?.serversByBrokers
              ? (Object.values(e.details.serversByBrokers).flat() as string[])
              : [];
            const alias = pickServerAlias(server, list);
            if (!alias) throw e;
            log?.('info', `Server '${server}' resolved to MetaApi's '${alias}'.`);
            server = alias;
            return await create(alias);
          }
        } catch (e) {
          // A slow create may still have gone through on MetaApi's side. If it did, carry on with it.
          if (e instanceof StageTimeoutError) {
            const again = await deps.gateway.listAccounts().catch(() => [] as AccountSummary[]);
            const found = again.find((a) => isOwnedBy(a.name, userId) && sameLogin(a.login, login));
            if (found) {
              log?.('warn', `Create timed out for #${login} but the terminal exists; continuing with it.`);
              return { id: found.id };
            }
          }
          throw e;
        }
      };

      let waited = false;
      const dto = gate
        ? await gate.run(
            async () => {
              if (waited) {
                // We stood in line: other clients may have taken slots meanwhile, so look again.
                assertCapacity(await withTimeout(deps.gateway.listAccounts(), t.listSeconds, 'checking'), 0);
              }
              return createWithRecovery();
            },
            () => {
              waited = true;
              go('queued');
            }
          )
        : await createWithRecovery();
      createdId = dto.id;
      accountId = dto.id;
      gate?.attach(userId, dto.id);
    }

    const terminalId = accountId;
    await hook('onTerminalCreated', () =>
      deps.onTerminalCreated?.({ userId, accountId: terminalId, login, server, resumed, previouslyVerified })
    );

    const account = await withTimeout(deps.gateway.getAccount(terminalId), t.listSeconds, 'creating');
    handle = account;
    if (!sameLogin(account.login, login) || !sameServer(account.server)) {
      throw new BrokerVerificationError('LOGIN_MISMATCH', 'The broker account does not match the details you entered.');
    }

    // --- deploy ---
    go('deploying');
    await withTimeout(account.waitDeployed(t.deploySeconds), t.deploySeconds, 'deploying');

    // --- sync: finish as soon as EITHER the sync signal arrives OR the broker answers directly ---
    go('syncing');
    const rpc = account.rpc();
    await withTimeout(rpc.connect(), t.connectSeconds, 'syncing');
    let info = await waitForBroker(rpc, t, log, login);

    // --- verify ---
    go('verifying');
    if (!info) info = await withTimeout(rpc.getAccountInformation(), t.infoSeconds, 'verifying');
    const verified = verifyBrokerAccountInfo(info, { login, server });
    // Minimum equity applies to NEW connections only. A client who was verified on this very terminal
    // before is just being reconnected, and it is never used to disconnect anyone later either.
    if (!previouslyVerified) checkConnectEligibility(verified, deps.limits.minEquity);

    return { account, rpc, verified, server, resumed, previouslyVerified };
  } catch (error: any) {
    const safe = toClientError(error, { login, server }, stage, log);
    log?.('warn', `Connect failed for #${login} at '${stage}' (${safe.code}); raw: ${String(error?.message || error).slice(0, 300)}`);

    // For the admin log: what MetaApi itself says about the terminal (e.g. DEPLOYED but DISCONNECTED).
    if (handle?.snapshot && !rejectsForGood.has(safe.code)) {
      try {
        const snap = await withTimeout(handle.snapshot(), 5, 'checking');
        safe.detail = `terminal state=${snap.state ?? '?'}, broker connection=${snap.connectionStatus ?? '?'}`;
        log?.('warn', `Terminal for #${login}: ${safe.detail}`);
      } catch {
        // best effort only
      }
    }

    // Remove an account we just created only when the broker rejected it for good.
    // A slow terminal is kept, so the next attempt (or the supervisor) carries on with it.
    if (createdId && rejectsForGood.has(safe.code)) {
      try {
        await deps.gateway.removeAccount(createdId);
        const removedId = createdId;
        if (accountId === removedId) accountId = undefined;
        await hook('onTerminalRemoved', () => deps.onTerminalRemoved?.({ userId, accountId: removedId }));
      } catch (cleanupErr: any) {
        log?.('warn', `Could not remove unverified account ${createdId}: ${cleanupErr?.message}`);
      }
    }

    // A terminal that survives a failure that is not final is the supervisor's to finish.
    if (accountId && !rejectsForGood.has(safe.code)) safe.accountId = accountId;
    safe.stage = stage;
    throw safe;
  } finally {
    if (claimed) gate?.release(userId);
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
  /**
   * 'background' means the browser no longer has to wait: the terminal exists and the supervisor keeps
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
 * Thrown from a job's `run` when the foreground attempt is over but the terminal is still being
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
  'Your trading terminal is taking a little longer to connect with your broker. You do not need to wait here: we will keep going in the background, and your dashboard will update by itself when it is ready.';

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
      /** Asked when the overall time limit is reached: true if the user's terminal can carry on in the background. */
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
 * What a client is told about a connection that has not finished: the terminal the supervisor is looking
 * after, or else the connection still running for them. That way a reload in the middle of connecting
 * still shows "connecting" instead of the Connect button.
 */
export function pendingFor<V extends { kind: 'working' | 'failed' }>(
  fromSupervisor: V | null | undefined,
  job: Pick<JobView, 'status' | 'label'> | null | undefined
): V | { kind: 'working'; label: string } | null {
  if (fromSupervisor) return fromSupervisor;
  if (job && job.status === 'running') return { kind: 'working', label: job.label };
  return null;
}
