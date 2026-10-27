/**
 * The terminal supervisor: looks after every client terminal that exists in MetaApi but is not (yet) a
 * verified, live connection, and keeps an eye on the live ones.
 *
 * Why it exists. A client's connection used to depend on one browser request staying alive. If the broker
 * or MetaApi was slow, the terminal was left behind, invisible to the client and counted against the
 * account limit. Now every terminal has a remembered record (saved, so a server restart loses nothing) and
 * this loop moves it forward by itself:
 *
 *   - starts a terminal that MetaApi left undeployed,
 *   - restarts one that stays "deployed but disconnected" (what pressing "redeploy" in MetaApi does),
 *   - reads the account from the broker as soon as the terminal is connected, applies the platform's rules
 *     and puts the client into service,
 *   - gives up on one that never connects, tells the client calmly, and tidies it away (only when that is
 *     safe: never a client who was verified before, never one with billing history),
 *   - adopts terminals it finds in MetaApi that nothing is tracking (after a restart, or a failed clean-up),
 *   - restarts the terminal of a live client whose link has been down for a while.
 *
 * The rules are in terminalPolicy.ts (pure and tested); this file does the I/O. Everything MetaApi-specific
 * arrives through the BrokerGateway, so the whole loop is tested with a fake.
 */

import {
  DEFAULT_TIMEOUTS,
  friendlyHint,
  rejectsForGood,
  waitForBroker,
  withTimeout,
  type AccountHandle,
  type BridgeTimeouts,
  type BrokerGateway,
  type RpcHandle,
} from './clientBridge.ts';
import {
  BrokerVerificationError,
  checkConnectEligibility,
  parseClientAccountName,
  verifyBrokerAccountInfo,
  type VerifiedBrokerAccount,
} from './brokerVerification.ts';
import {
  DEFAULT_POLICY,
  clientProgress,
  decideNext,
  failureFor,
  observe,
  type ClientProgress,
  type FailureInfo,
  type PendingAction,
  type PendingConnection,
  type PolicyConfig,
  type TerminalSnapshot,
} from './terminalPolicy.ts';
import type { ConnectionStore } from './connectionStore.ts';

export interface VerifiedClient {
  rec: PendingConnection;
  handle: AccountHandle;
  /** An open link to the terminal, ready to be used by the copy engine. */
  rpc: RpcHandle;
  verified: VerifiedBrokerAccount;
}

/** A client that is in service right now (used to look after links that have gone quiet). */
export interface ActiveLink {
  userId: string;
  accountId: string;
  login: string;
  connectionState?: string;
}

export interface SupervisorDeps {
  gateway: BrokerGateway;
  store: ConnectionStore;
  limits: { minEquity: number };
  /** True if the user already has a live, verified link in service. */
  isActive: (userId: string) => boolean;
  /** True while a connection the client started in the browser is still running for this user. */
  isConnecting: (userId: string) => boolean;
  /**
   * Whether this very terminal was verified for this user in the past:
   * 'yes' if we saved it, 'no' if we are sure we did not, 'unknown' if we cannot tell.
   */
  wasVerified: (userId: string, accountId: string) => Promise<'yes' | 'no' | 'unknown'>;
  hasBillingHistory: (userId: string) => Promise<boolean>;
  /** Puts a freshly verified client into service. Throwing means it could not be done (the check is repeated). */
  onVerified: (c: VerifiedClient) => Promise<void>;
  /** The clients in service, so links that stay down can be restarted. Optional. */
  activeLinks?: () => ActiveLink[];
  now?: () => number;
  policy?: Partial<PolicyConfig>;
  timeouts?: Partial<BridgeTimeouts>;
  /** How many terminals are looked at at once. */
  maxParallel?: number;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

export type StepOutcome = 'verified' | 'waiting' | 'failed' | 'gone' | 'skipped';

export interface TickSummary {
  looked: number;
  verified: number;
  failed: number;
}

export interface PendingView extends ClientProgress {
  login: string;
  server: string;
}

export interface TerminalRow {
  accountId: string;
  userId: string;
  login: string;
  server: string;
  /** MetaApi's own state and broker connection for the terminal. */
  state?: string;
  connectionStatus?: string;
  /** A verified client is using this terminal right now. */
  live: boolean;
  /** What the supervisor is doing with it: still connecting, failed, or nothing. */
  tracked: 'PENDING' | 'FAILED' | null;
  verifiedBefore?: boolean;
  redeploys?: number;
  lastAction?: PendingAction;
  /** ISO time since when the terminal has been deployed but not connected. */
  disconnectedSince?: string;
  minutesLeft?: number;
  error?: FailureInfo;
  /** The tracking record exists but MetaApi no longer has the terminal. */
  missing?: boolean;
}

interface HealState {
  errorSince?: number;
  redeploys: number;
  lastRedeployAt?: number;
}

type VerifyOutcome = { ok: true; rpc: RpcHandle; verified: VerifiedBrokerAccount } | { ok: false; final?: BrokerVerificationError };

/** What changes mean something: a tick that changes none of these writes nothing. */
function signature(r: PendingConnection): string {
  return JSON.stringify([
    r.accountId,
    r.stage,
    r.verifiedBefore,
    r.deadlineAt,
    r.redeploys,
    r.verifyFailures,
    r.lastRedeployAt ?? null,
    r.disconnectedSince ?? null,
    r.lastState ?? null,
    r.lastConnectionStatus ?? null,
    r.lastAction ?? null,
    r.error?.code ?? null,
  ]);
}

const mask = (userId: string) => (userId.length > 6 ? `${userId.slice(0, 3)}…${userId.slice(-3)}` : '***');
const msg = (e: any) => String(e?.message || e).slice(0, 200);

async function runPool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export class TerminalSupervisor {
  private readonly deps: SupervisorDeps;
  private readonly cfg: PolicyConfig;
  private readonly timeouts: BridgeTimeouts;
  private readonly clock: () => number;
  private readonly maxParallel: number;

  private recs = new Map<string, PendingConnection>();
  private inFlight = new Set<string>();
  private ticking = false;
  private prevTickAt = 0;
  private lastLogged = new Map<string, number>();
  private heals = new Map<string, HealState>();
  private timers: Array<ReturnType<typeof setInterval>> = [];

  /** Counters for the admin view. */
  readonly stats = { ticks: 0, lastTickAt: 0, lastDiscoverAt: 0, lastDiscoverAdopted: 0, verified: 0, gaveUp: 0, restarted: 0 };

  constructor(deps: SupervisorDeps) {
    this.deps = deps;
    this.cfg = { ...DEFAULT_POLICY, ...(deps.policy || {}) };
    // The supervisor reads an already-started terminal, so its waits are shorter than a first connect's.
    this.timeouts = { ...DEFAULT_TIMEOUTS, connectSeconds: 20, syncSeconds: 25, infoSeconds: 15, ...(deps.timeouts || {}) };
    this.clock = deps.now ?? Date.now;
    this.maxParallel = deps.maxParallel ?? 4;
  }

  // ---------- small helpers ----------

  private log(level: 'info' | 'warn' | 'error', text: string): void {
    this.deps.log?.(level, text);
  }

  /** Repeats of the same problem are logged once in a while, not every tick. */
  private logOnce(key: string, level: 'info' | 'warn' | 'error', text: string, everyMs = 5 * 60_000): void {
    const t = this.clock();
    const last = this.lastLogged.get(key);
    if (last !== undefined && t - last < everyMs) return;
    this.lastLogged.set(key, t);
    this.log(level, text);
  }

  private async save(rec: PendingConnection): Promise<void> {
    try {
      await this.deps.store.put(rec);
    } catch (e) {
      this.logOnce(`save:${rec.userId}`, 'warn', `Could not save the connection record for ${mask(rec.userId)}: ${msg(e)}`);
    }
  }

  /** Forgets a record (only if it is still the one the caller was working on). */
  private async drop(userId: string, expected?: PendingConnection): Promise<void> {
    if (expected && this.recs.get(userId) !== expected) return;
    this.recs.delete(userId);
    try {
      await this.deps.store.delete(userId);
    } catch (e) {
      this.logOnce(`drop:${userId}`, 'warn', `Could not delete the connection record for ${mask(userId)}: ${msg(e)}`);
    }
  }

  /** A terminal is protected from automatic clean-up if its owner was ever verified on it or has billing history. */
  private async isProtected(userId: string, accountId: string, rec?: PendingConnection): Promise<boolean> {
    if (rec && rec.accountId === accountId && rec.verifiedBefore) return true;
    let known: 'yes' | 'no' | 'unknown' = 'unknown';
    try {
      known = await this.deps.wasVerified(userId, accountId);
    } catch {
      known = 'unknown';
    }
    if (known !== 'no') return true; // 'yes', or cannot tell: keep it
    try {
      return await this.deps.hasBillingHistory(userId);
    } catch {
      return true;
    }
  }

  // ---------- starting and stopping ----------

  /** Reads the saved records (once, at startup). Unfinished connections carry on where they stopped. */
  async load(): Promise<number> {
    let rows: PendingConnection[] = [];
    try {
      rows = await this.deps.store.list();
    } catch (e) {
      this.log('warn', `Could not read saved connections: ${msg(e)}`);
    }
    const now = this.clock();
    for (const r of rows) {
      if (this.recs.has(r.userId)) continue;
      // Nobody was watching while the server was down, so every unfinished connection gets a few minutes of grace.
      const grace = now + 5 * 60_000;
      const rec = r.stage === 'PENDING' && r.deadlineAt > 0 && r.deadlineAt < grace ? { ...r, deadlineAt: grace } : r;
      this.recs.set(r.userId, rec);
    }
    return this.recs.size;
  }

  start(opts: { tickMs?: number; discoverMs?: number } = {}): void {
    this.stop();
    const tickMs = opts.tickMs ?? 15_000;
    const discoverMs = opts.discoverMs ?? 5 * 60_000;
    const a = setInterval(() => void this.tick().catch((e) => this.logOnce('tick', 'warn', `Supervisor tick failed: ${msg(e)}`)), tickMs);
    const b = setInterval(() => void this.discover().catch((e) => this.logOnce('discover', 'warn', `Supervisor discovery failed: ${msg(e)}`)), discoverMs);
    (a as any).unref?.();
    (b as any).unref?.();
    this.timers.push(a, b);
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  // ---------- tracking ----------

  /**
   * Starts looking after a user's terminal (called as soon as it exists). A second call for the same
   * terminal keeps what was learned so far and only renews the time window.
   */
  async track(i: { userId: string; accountId: string; login: string; server: string; verifiedBefore?: boolean }): Promise<PendingConnection> {
    const now = this.clock();
    const prev = this.recs.get(i.userId);
    const verifiedBefore = Boolean(i.verifiedBefore);
    let rec: PendingConnection;
    if (prev && prev.stage === 'PENDING' && prev.accountId === i.accountId) {
      const vb = prev.verifiedBefore || verifiedBefore;
      rec = { ...prev, verifiedBefore: vb, deadlineAt: vb ? 0 : now + this.cfg.windowMs, updatedAt: now };
    } else {
      rec = {
        userId: i.userId,
        accountId: i.accountId,
        login: i.login,
        server: i.server,
        stage: 'PENDING',
        verifiedBefore,
        startedAt: now,
        updatedAt: now,
        deadlineAt: verifiedBefore ? 0 : now + this.cfg.windowMs,
        redeploys: 0,
        verifyFailures: 0,
      };
    }
    this.recs.set(i.userId, rec);
    await this.save(rec);
    return rec;
  }

  /**
   * The browser has stopped waiting but the terminal is still starting: give it a fresh time window.
   * Returns false if there is nothing to look after.
   */
  async handOff(userId: string): Promise<boolean> {
    const rec = this.recs.get(userId);
    if (!rec || rec.stage !== 'PENDING') return false;
    const next: PendingConnection = {
      ...rec,
      deadlineAt: rec.verifiedBefore ? 0 : this.clock() + this.cfg.windowMs,
      lastAction: 'WAIT',
      updatedAt: this.clock(),
    };
    this.recs.set(userId, next);
    await this.save(next);
    return true;
  }

  /** Stops looking after a user's terminal (it connected, or was removed on purpose). */
  async untrack(userId: string, accountId?: string): Promise<void> {
    const rec = this.recs.get(userId);
    if (!rec) return;
    if (accountId && rec.accountId !== accountId) return;
    await this.drop(userId, rec);
  }

  isTracked(userId: string): boolean {
    return this.recs.has(userId);
  }

  /**
   * Forgets the "could not connect" notice of a user who is trying again, so the old message does not
   * linger next to the new attempt. A terminal that is still connecting is never touched.
   */
  async clearFailure(userId: string): Promise<boolean> {
    const rec = this.recs.get(userId);
    if (!rec || rec.stage !== 'FAILED') return false;
    await this.drop(userId, rec);
    return true;
  }

  /** What the client should be told about their own unfinished connection. */
  view(userId: string): PendingView | null {
    const rec = this.recs.get(userId);
    if (!rec) return null;
    return { ...clientProgress(rec, this.clock()), login: rec.login, server: rec.server };
  }

  records(): PendingConnection[] {
    return Array.from(this.recs.values()).map((r) => ({ ...r }));
  }

  // ---------- one terminal ----------

  /** Looks at one user's terminal and moves it forward once. Never throws. */
  async step(userId: string, pauseMs = 0): Promise<StepOutcome> {
    const rec = this.recs.get(userId);
    if (!rec || this.inFlight.has(userId)) return 'skipped';
    this.inFlight.add(userId);
    try {
      return await this.stepInner(rec, pauseMs);
    } catch (e) {
      this.logOnce(`step:${userId}`, 'warn', `Could not look after the terminal of ${mask(userId)}: ${msg(e)}`);
      return 'skipped';
    } finally {
      this.inFlight.delete(userId);
    }
  }

  /** Like step(), but gives up waiting after a while (the work carries on in the background). */
  async stepNow(userId: string, maxWaitMs = 20_000): Promise<StepOutcome | 'timeout'> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), maxWaitMs);
      (timer as any).unref?.();
    });
    try {
      return await Promise.race([this.step(userId), limit]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async stepInner(rec0: PendingConnection, pauseMs: number): Promise<StepOutcome> {
    const { userId } = rec0;
    const now = this.clock();
    let cur = rec0;

    /** Saves a changed record. False means someone replaced it meanwhile, so what we saw is out of date. */
    const commit = async (next: PendingConnection): Promise<boolean> => {
      if (this.recs.get(userId) !== cur) return false;
      if (signature(next) === signature(cur)) return true; // nothing meaningful changed: no write
      const saved: PendingConnection = { ...next, updatedAt: this.clock() };
      this.recs.set(userId, saved);
      cur = saved;
      await this.save(saved);
      return true;
    };

    if (cur.stage === 'FAILED') {
      if (decideNext(cur, {}, now, this.cfg).action === 'FORGET') {
        await this.drop(userId, cur);
        return 'gone';
      }
      return 'skipped';
    }

    // Already in service (or someone else is connecting it right now): nothing for us to do.
    if (this.deps.isActive(userId)) {
      await this.drop(userId, cur);
      return 'verified';
    }
    if (this.deps.isConnecting(userId)) return 'skipped';

    let handle: AccountHandle | null;
    try {
      handle = await withTimeout(this.deps.gateway.findAccount(cur.accountId), this.timeouts.listSeconds, 'checking');
    } catch (e) {
      // MetaApi cannot be reached just now: change nothing, and do not let the clock run out on a terminal
      // that nobody could look at.
      this.logOnce(`look:${userId}`, 'warn', `Could not look at the terminal of ${mask(userId)} (#${cur.login}): ${msg(e)}`);
      if (pauseMs > 0 && cur.deadlineAt > 0) await commit({ ...cur, deadlineAt: cur.deadlineAt + pauseMs });
      return 'skipped';
    }

    const snap: TerminalSnapshot = handle ? { state: handle.state, connectionStatus: handle.connectionStatus } : { missing: true };
    const seen = observe(cur, snap, now);
    const decision = decideNext(seen, snap, now, this.cfg);
    const rec: PendingConnection = { ...seen, lastAction: decision.action };

    switch (decision.action) {
      case 'WAIT':
        await commit(rec);
        return 'waiting';

      case 'DEPLOY': {
        try {
          await withTimeout(handle!.deploy(), 30, 'deploying');
          this.log('info', `Started the terminal of ${mask(userId)} (#${rec.login}); it was ${snap.state}.`);
        } catch (e) {
          this.logOnce(`deploy:${userId}`, 'warn', `Could not start the terminal of ${mask(userId)}: ${msg(e)}`);
        }
        await commit(rec);
        return 'waiting';
      }

      case 'REDEPLOY': {
        try {
          await withTimeout(handle!.redeploy(), 30, 'deploying');
          this.stats.restarted++;
          this.log('info', `Restarted the terminal of ${mask(userId)} (#${rec.login}): ${decision.reason}.`);
        } catch (e) {
          this.logOnce(`redeploy:${userId}`, 'warn', `Could not restart the terminal of ${mask(userId)}: ${msg(e)}`);
        }
        // An attempt counts even if the call failed, so a broken call cannot be repeated every few seconds.
        await commit({ ...rec, redeploys: rec.redeploys + 1, lastRedeployAt: now, disconnectedSince: undefined, verifyFailures: 0 });
        return 'waiting';
      }

      case 'VERIFY': {
        const out = await this.verify(rec, handle!);
        if (out.ok) {
          try {
            await this.deps.onVerified({ rec, handle: handle!, rpc: out.rpc, verified: out.verified });
          } catch (e) {
            try {
              await out.rpc.close?.();
            } catch {
              // nothing to close
            }
            this.logOnce(`adopt:${userId}`, 'warn', `Verified #${rec.login} but could not put it into service: ${msg(e)}`);
            await commit({ ...rec, verifyFailures: rec.verifyFailures + 1 });
            return 'waiting';
          }
          this.stats.verified++;
          this.log('info', `Connected ${mask(userId)} (#${rec.login}) in the background${rec.verifiedBefore ? ' (restored)' : ''}.`);
          await this.drop(userId, cur);
          return 'verified';
        }
        if (out.final) return this.failFor(rec, cur, handle!, out.final);
        await commit({ ...rec, verifyFailures: rec.verifyFailures + 1 });
        return 'waiting';
      }

      case 'GIVE_UP': {
        this.stats.gaveUp++;
        if (decision.code === 'TERMINAL_MISSING') {
          this.log('warn', `The terminal of ${mask(userId)} (#${rec.login}) no longer exists in MetaApi.`);
          await this.markFailed(rec, cur, failureFor('TERMINAL_MISSING', false));
          return 'failed';
        }
        const cleaned = await this.cleanup(rec);
        this.log('warn', `Gave up on the terminal of ${mask(userId)} (#${rec.login}): ${decision.reason}${cleaned ? '; removed it' : ''}.`);
        await this.markFailed(rec, cur, failureFor('TERMINAL_NOT_CONNECTING', cleaned));
        return 'failed';
      }

      default:
        await commit(rec);
        return 'waiting';
    }
  }

  /** Records a permanent failure the client can read, after tidying the terminal away when that is safe. */
  private async markFailed(rec: PendingConnection, cur: PendingConnection, error: FailureInfo): Promise<void> {
    if (this.recs.get(rec.userId) !== cur) return;
    const failed: PendingConnection = { ...rec, stage: 'FAILED', deadlineAt: 0, error, updatedAt: this.clock() };
    this.recs.set(rec.userId, failed);
    await this.save(failed);
  }

  /** The broker's own answer was a final refusal (for example, equity below the minimum). */
  private async failFor(rec: PendingConnection, cur: PendingConnection, handle: AccountHandle, err: BrokerVerificationError): Promise<StepOutcome> {
    const cleaned = await this.cleanup(rec);
    this.log('warn', `Refused ${mask(rec.userId)} (#${rec.login}): ${err.code}${cleaned ? '; removed the terminal' : ''}.`);
    await this.markFailed(rec, cur, { code: err.code, message: err.message, hint: friendlyHint(err.code), ref: err.ref });
    void handle;
    return 'failed';
  }

  /** Removes the terminal if that is safe. Returns true if it was removed. */
  private async cleanup(rec: PendingConnection): Promise<boolean> {
    if (this.deps.isActive(rec.userId)) return false;
    if (await this.isProtected(rec.userId, rec.accountId, rec)) return false;
    try {
      await this.deps.gateway.removeAccount(rec.accountId);
      return true;
    } catch (e) {
      this.log('warn', `Could not remove the terminal ${rec.accountId}: ${msg(e)}`);
      return false;
    }
  }

  private async verify(rec: PendingConnection, handle: AccountHandle): Promise<VerifyOutcome> {
    const t = this.timeouts;
    let rpc: RpcHandle | undefined;
    try {
      rpc = handle.rpc();
      await withTimeout(rpc.connect(), t.connectSeconds, 'syncing');
      let info = await waitForBroker(rpc, t, this.deps.log, rec.login);
      if (!info) info = await withTimeout(rpc.getAccountInformation(), t.infoSeconds, 'verifying');
      const verified = verifyBrokerAccountInfo(info, { login: rec.login, server: String(handle.server || rec.server) });
      // Minimum equity is for NEW connections only; a client verified here before is just being brought back.
      if (!rec.verifiedBefore) checkConnectEligibility(verified, this.deps.limits.minEquity);
      return { ok: true, rpc, verified };
    } catch (e: any) {
      try {
        await rpc?.close?.();
      } catch {
        // nothing to close
      }
      // A half-synced terminal can report empty figures, so that one is retried rather than treated as final.
      if (e instanceof BrokerVerificationError && rejectsForGood.has(e.code) && e.code !== 'BAD_BROKER_RESPONSE') {
        return { ok: false, final: e };
      }
      this.logOnce(`verify:${rec.userId}`, 'warn', `Reading #${rec.login} did not work yet: ${msg(e)}`);
      return { ok: false };
    }
  }

  // ---------- all terminals ----------

  /** One pass over every unfinished connection, and over the links of live clients. */
  async tick(): Promise<TickSummary> {
    const summary: TickSummary = { looked: 0, verified: 0, failed: 0 };
    if (this.ticking) return summary;
    this.ticking = true;
    try {
      const now = this.clock();
      const pause = this.prevTickAt ? Math.min(Math.max(0, now - this.prevTickAt), 120_000) : 0;
      this.prevTickAt = now;
      this.stats.ticks++;
      this.stats.lastTickAt = now;

      const ids = Array.from(this.recs.keys());
      await runPool(ids, this.maxParallel, async (userId) => {
        const out = await this.step(userId, pause);
        if (out === 'skipped') return;
        summary.looked++;
        if (out === 'verified') summary.verified++;
        if (out === 'failed') summary.failed++;
      });

      await this.healActive().catch((e) => this.logOnce('heal', 'warn', `Could not check live links: ${msg(e)}`));
    } finally {
      this.ticking = false;
    }
    return summary;
  }

  /**
   * Looks through MetaApi for client terminals nobody is tracking (after a restart, or a clean-up that
   * failed) and starts looking after them. With `userId`, only that user's terminal is considered.
   */
  async discover(opts: { userId?: string } = {}): Promise<{ adopted: number; seen: number }> {
    const all = await withTimeout(this.deps.gateway.listAccounts(), this.timeouts.listSeconds, 'checking');
    let adopted = 0;
    let seen = 0;
    for (const a of all) {
      const parsed = parseClientAccountName(a.name);
      if (!parsed) continue; // the master and anything created by hand are never touched
      if (opts.userId && parsed.userId !== opts.userId) continue;
      seen++;
      const { userId } = parsed;
      if (this.deps.isActive(userId) || this.deps.isConnecting(userId)) continue;
      const existing = this.recs.get(userId);
      if (existing && existing.accountId === a.id) continue;
      if (existing && existing.stage === 'PENDING') continue; // one terminal per client is being looked after already

      let known: 'yes' | 'no' | 'unknown' = 'unknown';
      try {
        known = await this.deps.wasVerified(userId, a.id);
      } catch {
        known = 'unknown';
      }
      // When we cannot tell, assume the client was connected before: never remove or re-judge anyone in doubt.
      let verifiedBefore = known !== 'no';
      if (!verifiedBefore) {
        // A client with billing history has been in service; a missing saved record must not turn them into a newcomer.
        try {
          verifiedBefore = await this.deps.hasBillingHistory(userId);
        } catch {
          verifiedBefore = true;
        }
      }
      const now = this.clock();
      const rec: PendingConnection = {
        userId,
        accountId: a.id,
        login: parsed.login,
        server: String(a.server ?? ''),
        stage: 'PENDING',
        verifiedBefore,
        startedAt: now,
        updatedAt: now,
        deadlineAt: verifiedBefore ? 0 : now + this.cfg.windowMs,
        redeploys: 0,
        verifyFailures: 0,
        lastState: a.state,
        lastConnectionStatus: a.connectionStatus,
      };
      this.recs.set(userId, rec);
      await this.save(rec);
      adopted++;
      this.log('info', `Found a terminal for ${mask(userId)} (#${parsed.login}) that nobody was looking after${verifiedBefore ? ' (connected before)' : ''}; now watching it.`);
    }
    if (!opts.userId) {
      this.stats.lastDiscoverAt = this.clock();
      this.stats.lastDiscoverAdopted = adopted;
    }
    return { adopted, seen };
  }

  // ---------- live clients ----------

  /**
   * A client in service whose link has been down for a while: if MetaApi says the terminal is stopped or
   * disconnected from the broker, restart it (gently: long pauses and a cap). If MetaApi says it is
   * connected, the problem is only our link, which the manager rebuilds itself.
   */
  async healActive(): Promise<number> {
    const links = this.deps.activeLinks?.() ?? [];
    const now = this.clock();
    let restarted = 0;
    const live = new Set<string>();

    for (const link of links) {
      live.add(link.accountId);
      let h = this.heals.get(link.accountId);
      if (link.connectionState !== 'ERROR') {
        if (h) {
          h.errorSince = undefined;
          // Healthy for a long while: start counting from zero next time.
          if (h.lastRedeployAt !== undefined && now - h.lastRedeployAt > 6 * 60 * 60_000) h.redeploys = 0;
        }
        continue;
      }
      if (!h) {
        h = { redeploys: 0 };
        this.heals.set(link.accountId, h);
      }
      if (h.errorSince === undefined) h.errorSince = now;
      if (now - h.errorSince < this.cfg.redeployAfterMs) continue;
      if (h.redeploys >= this.cfg.restoredMaxRedeploys) continue;
      if (h.lastRedeployAt !== undefined && now - h.lastRedeployAt < this.cfg.restoredRedeployGapMs) continue;

      let handle: AccountHandle | null;
      try {
        handle = await withTimeout(this.deps.gateway.findAccount(link.accountId), this.timeouts.listSeconds, 'checking');
      } catch (e) {
        this.logOnce(`heal-look:${link.accountId}`, 'warn', `Could not look at the live terminal #${link.login}: ${msg(e)}`);
        continue;
      }
      if (!handle) continue;
      try {
        if (handle.state === 'UNDEPLOYED' || handle.state === 'DRAFT') {
          await withTimeout(handle.deploy(), 30, 'deploying');
          this.log('info', `Started the stopped terminal of live client ${mask(link.userId)} (#${link.login}).`);
        } else if (handle.state === 'DEPLOYED' && handle.connectionStatus !== 'CONNECTED') {
          await withTimeout(handle.redeploy(), 30, 'deploying');
          restarted++;
          this.stats.restarted++;
          this.log('info', `Restarted the disconnected terminal of live client ${mask(link.userId)} (#${link.login}).`);
        } else {
          continue; // connected (or changing state): nothing to restart
        }
        h.redeploys++;
        h.lastRedeployAt = now;
        h.errorSince = now; // give the restart time to work before judging again
      } catch (e) {
        h.lastRedeployAt = now;
        this.logOnce(`heal:${link.accountId}`, 'warn', `Could not restart the live terminal #${link.login}: ${msg(e)}`);
      }
    }
    // Forget bookkeeping for terminals that are no longer live.
    for (const id of Array.from(this.heals.keys())) if (!live.has(id)) this.heals.delete(id);
    return restarted;
  }

  // ---------- administrator tools ----------

  /** Every client terminal MetaApi has, with what the supervisor knows about it. The master is never listed. */
  async inventory(): Promise<TerminalRow[]> {
    const all = await withTimeout(this.deps.gateway.listAccounts(), this.timeouts.listSeconds, 'checking');
    const now = this.clock();
    const byAccount = new Map<string, PendingConnection>();
    for (const r of this.recs.values()) byAccount.set(r.accountId, r);
    const rows: TerminalRow[] = [];
    const listed = new Set<string>();

    for (const a of all) {
      const parsed = parseClientAccountName(a.name);
      if (!parsed) continue;
      listed.add(a.id);
      const rec = byAccount.get(a.id);
      rows.push({
        accountId: a.id,
        userId: parsed.userId,
        login: parsed.login,
        server: String(a.server ?? ''),
        state: a.state,
        connectionStatus: a.connectionStatus,
        live: this.deps.isActive(parsed.userId),
        tracked: rec ? rec.stage : null,
        verifiedBefore: rec?.verifiedBefore,
        redeploys: rec?.redeploys,
        lastAction: rec?.lastAction,
        disconnectedSince: rec?.disconnectedSince ? new Date(rec.disconnectedSince).toISOString() : undefined,
        minutesLeft: rec && rec.stage === 'PENDING' ? clientProgress(rec, now).minutesLeft : undefined,
        error: rec?.error,
      });
    }
    for (const r of this.recs.values()) {
      if (listed.has(r.accountId)) continue;
      rows.push({
        accountId: r.accountId,
        userId: r.userId,
        login: r.login,
        server: r.server,
        live: this.deps.isActive(r.userId),
        tracked: r.stage,
        verifiedBefore: r.verifiedBefore,
        redeploys: r.redeploys,
        lastAction: r.lastAction,
        error: r.error,
        missing: true,
      });
    }
    return rows;
  }

  /** Restarts one client terminal now (for the administrator). */
  async redeployTerminal(accountId: string): Promise<{ ok: boolean; reason?: 'NOT_FOUND' | 'NOT_CLIENT' }> {
    const all = await withTimeout(this.deps.gateway.listAccounts(), this.timeouts.listSeconds, 'checking');
    const a = all.find((x) => x.id === accountId);
    if (!a) return { ok: false, reason: 'NOT_FOUND' };
    if (!parseClientAccountName(a.name)) return { ok: false, reason: 'NOT_CLIENT' };
    const handle = await this.deps.gateway.findAccount(accountId);
    if (!handle) return { ok: false, reason: 'NOT_FOUND' };
    if (handle.state === 'UNDEPLOYED' || handle.state === 'DRAFT') await handle.deploy();
    else await handle.redeploy();
    return { ok: true };
  }

  /**
   * Removes one client terminal (for the administrator). A terminal in service is never removed here
   * (use the client's own disconnect); one whose owner was verified or has billing history needs `force`.
   * Only client terminals can be removed this way: the master and anything else are refused.
   */
  async removeTerminal(
    accountId: string,
    opts: { force?: boolean } = {}
  ): Promise<{ ok: boolean; reason?: 'NOT_FOUND' | 'NOT_CLIENT' | 'LIVE' | 'PROTECTED' }> {
    const all = await withTimeout(this.deps.gateway.listAccounts(), this.timeouts.listSeconds, 'checking');
    const a = all.find((x) => x.id === accountId);
    if (!a) {
      // Only an old record is left: clear it.
      const stale = Array.from(this.recs.values()).find((r) => r.accountId === accountId);
      if (stale) {
        await this.drop(stale.userId, stale);
        return { ok: true };
      }
      return { ok: false, reason: 'NOT_FOUND' };
    }
    const parsed = parseClientAccountName(a.name);
    if (!parsed) return { ok: false, reason: 'NOT_CLIENT' };
    if (this.deps.isActive(parsed.userId)) return { ok: false, reason: 'LIVE' };
    const rec = this.recs.get(parsed.userId);
    if (!opts.force && (await this.isProtected(parsed.userId, accountId, rec))) return { ok: false, reason: 'PROTECTED' };
    await this.deps.gateway.removeAccount(accountId);
    if (rec && rec.accountId === accountId) await this.drop(parsed.userId, rec);
    return { ok: true };
  }

  /**
   * Removes every client terminal that is not in service, not protected and not still connecting
   * (failed attempts and forgotten leftovers). Returns the ids removed.
   */
  async cleanupStale(): Promise<{ removed: string[]; kept: number }> {
    const rows = await this.inventory();
    const removed: string[] = [];
    let kept = 0;
    for (const row of rows) {
      if (row.missing) continue;
      if (row.live || row.tracked === 'PENDING') {
        kept++;
        continue;
      }
      const res = await this.removeTerminal(row.accountId).catch(() => ({ ok: false }));
      if (res.ok) removed.push(row.accountId);
      else kept++;
    }
    return { removed, kept };
  }
}
