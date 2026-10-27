/**
 * The rules for what happens to a client's trading terminal while it is not yet (or no longer) connected.
 *
 * Pure functions only: given what MetaApi says about the terminal and what we remember about it, decide
 * the next step. The supervisor (terminalSupervisor.ts) does the I/O; keeping the rules here means every
 * branch can be unit-tested without MetaApi.
 *
 * The ladder for a terminal that is deployed but not connected:
 *   wait  ->  restart it (the same as pressing "redeploy" in MetaApi)  ->  wait  ->  restart again  ->  give up
 * A terminal that never connects is given up on after a time window, and only then cleaned up.
 * A client who was verified before (restored after a restart) is never given up on or cleaned up.
 */

export interface TerminalSnapshot {
  /** The terminal no longer exists in MetaApi. */
  missing?: boolean;
  state?: string; // DEPLOYED, UNDEPLOYED, DRAFT, DEPLOYING, UNDEPLOYING, DELETING, ...
  connectionStatus?: string; // CONNECTED, DISCONNECTED, DISCONNECTED_FROM_BROKER, ...
}

export type PendingAction = 'WAIT' | 'DEPLOY' | 'REDEPLOY' | 'VERIFY' | 'GIVE_UP' | 'FORGET';

export interface FailureInfo {
  code: string;
  message: string;
  hint: string;
  ref?: string;
}

/** What we remember about a terminal that is still connecting. Saved so a server restart loses nothing. */
export interface PendingConnection {
  userId: string;
  accountId: string;
  login: string;
  server: string;
  stage: 'PENDING' | 'FAILED';
  /** True for a client who was verified before: never given up on, never cleaned up, no minimum-equity re-check. */
  verifiedBefore: boolean;
  startedAt: number;
  updatedAt: number;
  /** When an unverified terminal is given up on. 0 means never. */
  deadlineAt: number;
  redeploys: number;
  verifyFailures: number;
  lastRedeployAt?: number;
  /** Since when the deployed terminal has not been connected. */
  disconnectedSince?: number;
  lastState?: string;
  lastConnectionStatus?: string;
  lastAction?: PendingAction;
  error?: FailureInfo;
}

export interface PolicyConfig {
  /** How long a deployed terminal may stay disconnected before it is restarted. */
  redeployAfterMs: number;
  /** Minimum pause between restarts. */
  redeployGapMs: number;
  maxRedeploys: number;
  /** Connected but the account could not be read this many times in a row: restart it. */
  verifyFailsBeforeRedeploy: number;
  /** How long a new, unverified terminal gets to connect before it is given up on. */
  windowMs: number;
  /** How long a failed record stays so the client can read why. */
  failedKeepMs: number;
  /** Limits for clients who were verified before. */
  restoredMaxRedeploys: number;
  restoredRedeployGapMs: number;
}

export const DEFAULT_POLICY: PolicyConfig = {
  redeployAfterMs: 90_000,
  redeployGapMs: 180_000,
  maxRedeploys: 2,
  verifyFailsBeforeRedeploy: 3,
  windowMs: 15 * 60_000,
  failedKeepMs: 24 * 60 * 60_000,
  restoredMaxRedeploys: 20,
  restoredRedeployGapMs: 10 * 60_000,
};

export interface Decision {
  action: PendingAction;
  reason: string;
  /** Set with GIVE_UP: why. */
  code?: 'TERMINAL_MISSING' | 'TERMINAL_NOT_CONNECTING';
}

const TRANSITIONAL = new Set(['DEPLOYING', 'UNDEPLOYING', 'DELETING']);

function limitsFor(rec: PendingConnection, cfg: PolicyConfig): { max: number; gap: number } {
  return rec.verifiedBefore
    ? { max: cfg.restoredMaxRedeploys, gap: cfg.restoredRedeployGapMs }
    : { max: cfg.maxRedeploys, gap: cfg.redeployGapMs };
}

function canRedeploy(rec: PendingConnection, now: number, cfg: PolicyConfig): boolean {
  const { max, gap } = limitsFor(rec, cfg);
  return rec.redeploys < max && (rec.lastRedeployAt === undefined || now - rec.lastRedeployAt >= gap);
}

/** Decides the next step for one pending terminal. */
export function decideNext(
  rec: PendingConnection,
  snap: TerminalSnapshot,
  now: number,
  cfg: PolicyConfig = DEFAULT_POLICY
): Decision {
  if (rec.stage === 'FAILED') {
    return now - rec.updatedAt >= cfg.failedKeepMs
      ? { action: 'FORGET', reason: 'failed record is old enough to forget' }
      : { action: 'WAIT', reason: 'failed record kept so the client can read why' };
  }

  if (snap.missing) {
    return { action: 'GIVE_UP', code: 'TERMINAL_MISSING', reason: 'the terminal no longer exists in MetaApi' };
  }

  const pastDeadline = rec.deadlineAt > 0 && now >= rec.deadlineAt;
  const deployed = snap.state === 'DEPLOYED';
  const connected = snap.connectionStatus === 'CONNECTED';

  if (pastDeadline) {
    // One last try if it is connected and the account has not repeatedly refused to be read.
    if (deployed && connected && rec.verifyFailures < cfg.verifyFailsBeforeRedeploy) {
      return { action: 'VERIFY', reason: 'past the time window but now connected: one last check' };
    }
    return { action: 'GIVE_UP', code: 'TERMINAL_NOT_CONNECTING', reason: 'did not connect within the time window' };
  }

  if (snap.state === 'UNDEPLOYED' || snap.state === 'DRAFT') {
    return { action: 'DEPLOY', reason: `terminal is ${snap.state}; it must be started` };
  }
  if (snap.state && TRANSITIONAL.has(snap.state)) {
    return { action: 'WAIT', reason: `terminal is ${snap.state}` };
  }

  if (deployed) {
    if (connected) {
      if (rec.verifyFailures >= cfg.verifyFailsBeforeRedeploy && canRedeploy(rec, now, cfg)) {
        return { action: 'REDEPLOY', reason: 'connected, but the account could not be read several times' };
      }
      return { action: 'VERIFY', reason: 'terminal is connected' };
    }
    const since = rec.disconnectedSince ?? now;
    if (now - since >= cfg.redeployAfterMs && canRedeploy(rec, now, cfg)) {
      return { action: 'REDEPLOY', reason: 'deployed but disconnected for too long' };
    }
    return { action: 'WAIT', reason: 'deployed, waiting for the broker to accept the terminal' };
  }

  return { action: 'WAIT', reason: `terminal state is ${snap.state ?? 'unknown'}` };
}

/** Updates the "disconnected since" marker from the latest snapshot (pure). */
export function observe(rec: PendingConnection, snap: TerminalSnapshot, now: number): PendingConnection {
  const connected = snap.state === 'DEPLOYED' && snap.connectionStatus === 'CONNECTED';
  const deployedNotConnected = snap.state === 'DEPLOYED' && !connected;
  return {
    ...rec,
    lastState: snap.state ?? rec.lastState,
    lastConnectionStatus: snap.connectionStatus ?? rec.lastConnectionStatus,
    disconnectedSince: deployedNotConnected ? rec.disconnectedSince ?? now : undefined,
  };
}

// ---------- what the client is told ----------

export interface ClientProgress {
  kind: 'working' | 'failed';
  label: string;
  /** Whole minutes left in the time window (only for terminals that can be given up on). */
  minutesLeft?: number;
  error?: FailureInfo;
}

export function clientProgress(rec: PendingConnection, now: number): ClientProgress {
  if (rec.stage === 'FAILED') {
    return { kind: 'failed', label: 'Could not connect', error: rec.error };
  }
  let label: string;
  switch (rec.lastAction) {
    case 'REDEPLOY':
      label = 'Restarting your terminal to help it connect…';
      break;
    case 'DEPLOY':
      label = 'Starting your trading terminal…';
      break;
    case 'VERIFY':
      label = 'Reading your account from the broker…';
      break;
    default:
      label =
        rec.lastState === 'DEPLOYED' && rec.lastConnectionStatus !== 'CONNECTED'
          ? 'Waiting for your broker to accept the terminal…'
          : 'Getting your terminal ready…';
  }
  const progress: ClientProgress = { kind: 'working', label };
  if (rec.deadlineAt > 0) progress.minutesLeft = Math.max(0, Math.ceil((rec.deadlineAt - now) / 60_000));
  return progress;
}

// ---------- failures shown to the client ----------

export function failureFor(code: 'TERMINAL_MISSING' | 'TERMINAL_NOT_CONNECTING', cleaned: boolean): FailureInfo {
  if (code === 'TERMINAL_MISSING') {
    return {
      code,
      message: 'Your trading terminal is no longer there, so we could not finish connecting your account.',
      hint: 'Please press Connect and enter your account details again. It only takes a moment.',
    };
  }
  return {
    code,
    message: `We tried for a while, but your trading terminal could not connect to your broker${cleaned ? ', so we cleared it to keep things tidy' : ''}.`,
    hint: 'Please check your account number, trading password and server with your broker, then press Connect again. If it keeps happening, contact support and we will look into it with you.',
    ref: 'TERMINAL_NOT_CONNECTING',
  };
}
