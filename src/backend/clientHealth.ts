/**
 * Keeps a connected client's link healthy, the same way the master account's link is kept healthy:
 *   1. ask the terminal over RPC            (fast, preferred)
 *   2. if that fails, ask MetaApi over REST (the master's fallback)
 *   3. if the RPC link keeps failing, rebuild it (deploy if needed, reconnect, best-effort sync)
 * and always report a plain connection state, latency and last-heartbeat, like the master does.
 *
 * Pure orchestration with injected I/O, so every branch is unit-tested without MetaApi.
 */

import type { BrokerAccountInfo } from './brokerVerification.ts';

export type ConnectionState = 'CONNECTED' | 'RECONNECTING' | 'ERROR';

export interface HealthState {
  connectionState: ConnectionState;
  /** Consecutive refreshes where NO route (RPC or REST) answered. */
  failures: number;
  /** Consecutive refreshes where the RPC link failed (even if REST answered). */
  rpcFailures: number;
  lastOkAt?: number;
  lastReconnectAt?: number;
  reconnectAttempts: number;
  latencyMs: number;
  /** Which route produced the latest figures. */
  via: 'rpc' | 'rest' | 'none';
}

export function newHealthState(now: number): HealthState {
  return { connectionState: 'CONNECTED', failures: 0, rpcFailures: 0, lastOkAt: now, reconnectAttempts: 0, latencyMs: 0, via: 'rpc' };
}

export interface HealthDeps {
  rpcInfo: () => Promise<BrokerAccountInfo>;
  /** REST fallback; may be absent (no token) or return null (not available). */
  restInfo?: () => Promise<BrokerAccountInfo | null>;
  /** Rebuilds the RPC link. Must throw if it could not. */
  reconnect: () => Promise<void>;
  now?: () => number;
  log?: (level: 'info' | 'warn', msg: string) => void;
}

export interface HealthResult {
  state: HealthState;
  /** Fresh figures, only when a route answered with real numbers. */
  info?: { balance: number; equity: number; freeMargin?: number; leverage?: number; broker?: string; name?: string };
}

const RPC_FAILS_BEFORE_REBUILD = 3;
const MIN_REBUILD_GAP_MS = 30_000;
const MAX_REBUILD_GAP_MS = 5 * 60_000;
const RECONNECTING_AFTER_MS = 30_000;
const ERROR_AFTER_FAILURES = 6;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Accepts an answer only if it carries real, non-negative money figures. */
export function usableInfo(i: BrokerAccountInfo | null | undefined): HealthResult['info'] | undefined {
  if (!i || typeof i !== 'object') return undefined;
  if (!finite(i.balance) || !finite(i.equity) || i.balance < 0 || i.equity < 0) return undefined;
  return {
    balance: i.balance,
    equity: i.equity,
    freeMargin: finite(i.freeMargin) ? i.freeMargin : undefined,
    leverage: finite(i.leverage) && i.leverage > 0 ? i.leverage : undefined,
    broker: typeof i.broker === 'string' && i.broker.trim() ? i.broker.trim() : undefined,
    name: typeof i.name === 'string' && i.name.trim() ? i.name.trim() : undefined,
  };
}

/** One health check. Never throws. */
export async function checkClientHealth(deps: HealthDeps, prev: HealthState): Promise<HealthResult> {
  const now = deps.now ?? Date.now;
  const log = deps.log;
  const state: HealthState = { ...prev };
  const t0 = now();
  let info: HealthResult['info'];

  // 1. RPC
  try {
    info = usableInfo(await deps.rpcInfo());
    if (info) {
      state.via = 'rpc';
      state.rpcFailures = 0;
    }
  } catch {
    info = undefined;
  }

  // 2. REST fallback (the same safety net the master has)
  if (!info) {
    state.rpcFailures = prev.rpcFailures + 1;
    if (deps.restInfo) {
      try {
        info = usableInfo(await deps.restInfo());
        if (info) state.via = 'rest';
      } catch {
        info = undefined;
      }
    }
  }

  if (info) {
    state.failures = 0;
    state.lastOkAt = now();
    state.latencyMs = Math.max(1, now() - t0);
    state.connectionState = 'CONNECTED';
  } else {
    state.failures = prev.failures + 1;
    state.via = 'none';
    const silentFor = now() - (state.lastOkAt ?? 0);
    state.connectionState = state.failures >= ERROR_AFTER_FAILURES ? 'ERROR' : silentFor >= RECONNECTING_AFTER_MS || state.failures >= 2 ? 'RECONNECTING' : prev.connectionState;
  }

  // 3. Rebuild the RPC link when it keeps failing (with a growing pause between attempts)
  if (state.rpcFailures >= RPC_FAILS_BEFORE_REBUILD) {
    const gap = Math.min(MAX_REBUILD_GAP_MS, MIN_REBUILD_GAP_MS * Math.pow(2, Math.min(state.reconnectAttempts, 4)));
    if (state.lastReconnectAt === undefined || now() - state.lastReconnectAt >= gap) {
      state.lastReconnectAt = now();
      state.reconnectAttempts = prev.reconnectAttempts + 1;
      try {
        log?.('info', `RPC link failed ${state.rpcFailures} times; rebuilding (attempt ${state.reconnectAttempts}).`);
        await deps.reconnect();
        state.rpcFailures = 0;
        state.reconnectAttempts = 0;
        log?.('info', 'RPC link rebuilt.');
      } catch (e: any) {
        log?.('warn', `Could not rebuild the RPC link: ${String(e?.message || e).slice(0, 200)}`);
      }
    }
  }

  return { state, info };
}
