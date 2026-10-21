/**
 * Client for MetaApi (https://metaapi.cloud): connects clients' MT5 accounts and runs
 * CopyFactory (the trade copier). Only uses the plain REST API, no SDK.
 *
 * Endpoints and field names were taken from MetaApi's published documentation:
 *   provisioning  POST/GET/DELETE /users/current/accounts[/:id]   (+ /deploy, /undeploy)
 *   client API    GET /users/current/accounts/:id/account-information | positions |
 *                     history-deals/time/:start/:end
 *   CopyFactory   POST /users/current/configuration/unused-strategy-id
 *                 PUT  /users/current/configuration/strategies/:id
 *                 PUT  /users/current/configuration/subscribers/:accountId
 *
 * IMPORTANT: this code has been exercised against a mock only. The first real use must
 * be on DEMO accounts (see docs/GO-LIVE.md).
 */

export class MetaApiError extends Error {
  status: number;
  code: string;
  /** Safe to show to the person using the website. */
  userMessage: string;
  constructor(status: number, code: string, userMessage: string) {
    super(`MetaApi ${status} ${code}`);
    this.status = status;
    this.code = code;
    this.userMessage = userMessage;
  }
}

export type CopyRole = 'PROVIDER' | 'SUBSCRIBER';

export interface CreateAccountParams {
  name: string;
  login: string;
  password: string; // passed through to MetaApi, never stored or logged by us
  server: string;
  region?: string;
  transactionId: string;
  roles: CopyRole[];
  keywords?: string[];
}

export type CreateAccountResult =
  | { status: 'created'; id: string }
  | { status: 'pending'; retryAfterSeconds: number };

export interface MetaAccount {
  id: string;
  state: string; // UNDEPLOYED | DEPLOYED | DRAFT ...
  connectionStatus: string; // CONNECTED | DISCONNECTED | DISCONNECTED_FROM_BROKER
  region: string;
  copyFactoryRoles: string[];
}

export interface AccountInfo {
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel?: number;
  leverage?: number;
  currency: string;
  marginMode?: string;
  tradeAllowed?: boolean;
  login?: number | string;
  server?: string;
  broker?: string;
}

export interface Position {
  id: string;
  type: string;
  symbol: string;
  volume: number;
  openPrice: number;
  currentPrice?: number;
  profit: number;
  swap?: number;
  time: string;
  stopLoss?: number;
  takeProfit?: number;
}

export interface MetaDeal {
  id: string;
  type: string;
  entryType?: string;
  profit?: number;
  commission?: number;
  swap?: number;
  symbol?: string;
  volume?: number;
  time: string;
}

export interface SubscriberBody {
  name: string;
  subscriptions: Array<Record<string, unknown>>;
}

export interface MetaApi {
  createAccount(p: CreateAccountParams): Promise<CreateAccountResult>;
  getAccount(id: string): Promise<MetaAccount>;
  deploy(id: string): Promise<void>;
  undeploy(id: string): Promise<void>;
  removeAccount(id: string): Promise<void>;
  accountInformation(id: string, region: string): Promise<AccountInfo>;
  positions(id: string, region: string): Promise<Position[]>;
  deals(id: string, region: string, fromIso: string, toIso: string): Promise<MetaDeal[]>;
  generateStrategyId(region: string): Promise<string>;
  putStrategy(region: string, strategyId: string, body: Record<string, unknown>): Promise<void>;
  putSubscriber(region: string, accountId: string, body: SubscriberBody): Promise<void>;
}

const PROVISIONING_BASE = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
const REGION_RE = /^[a-z0-9-]{2,32}$/;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const DEAL_PAGE = 1000;
const MAX_DEAL_PAGES = 20; // hard stop: 20,000 deals per sync window

export function clientHost(region: string): string {
  assertRegion(region);
  return `https://mt-client-api-v1.${region}.agiliumtrade.ai`;
}

export function copyFactoryHost(region: string): string {
  assertRegion(region);
  return `https://copyfactory-api-v1.${region}.agiliumtrade.ai`;
}

function assertRegion(region: string) {
  // Region ends up in a hostname, so it must never contain anything but plain letters/digits/dashes.
  if (!REGION_RE.test(region)) throw new MetaApiError(400, 'bad_region', 'Invalid server region.');
}

function assertId(id: string) {
  if (!ID_RE.test(id)) throw new MetaApiError(400, 'bad_id', 'Invalid account id.');
}

/** Turns MetaApi's error JSON into something safe to show to a person. */
export function describeError(status: number, body: unknown): MetaApiError {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const details = b.details;
  const code =
    typeof details === 'string'
      ? details
      : details && typeof details === 'object' && typeof (details as Record<string, unknown>).code === 'string'
        ? ((details as Record<string, unknown>).code as string)
        : typeof b.error === 'string'
          ? (b.error as string)
          : 'unknown';

  switch (code) {
    case 'E_AUTH':
      return new MetaApiError(status, code, 'The MT5 login, password or server name is not correct. Please check them and try again.');
    case 'E_SRV_NOT_FOUND':
      return new MetaApiError(status, code, 'That MT5 server name was not found. Copy it exactly as shown in your MT5 terminal (File > Open an Account, or the account details).');
    case 'E_SERVER_TIMEZONE':
      return new MetaApiError(status, code, 'We could not read the broker settings yet. Please try again in a few minutes.');
    case 'E_RESOURCE_SLOTS':
      return new MetaApiError(status, code, 'This account needs extra capacity on the copying service. Please contact support.');
    default:
      break;
  }
  if (status === 401) return new MetaApiError(status, 'metaapi_auth', 'The copying service rejected our credentials. Please contact support.');
  if (status === 403) return new MetaApiError(status, 'metaapi_forbidden', 'The copying service refused this request. Please contact support.');
  if (status === 404) return new MetaApiError(status, 'metaapi_not_found', 'The account was not found on the copying service.');
  if (status === 429) return new MetaApiError(status, 'metaapi_rate_limit', 'The copying service is busy. Please try again in a minute.');
  return new MetaApiError(status, code, 'The copying service had a problem. Please try again shortly.');
}

export interface MetaApiOptions {
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createMetaApi(opts: MetaApiOptions): MetaApi {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  async function call(
    method: string,
    url: string,
    init: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; body: unknown; headers: Headers }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(url, {
        method,
        headers: {
          'auth-token': opts.token,
          accept: 'application/json',
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: ctrl.signal,
      });
      let body: unknown = null;
      const text = await res.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
      return { status: res.status, body, headers: res.headers };
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw new MetaApiError(504, 'timeout', 'The copying service took too long to answer. Please try again.');
      }
      throw new MetaApiError(502, 'network', 'Could not reach the copying service. Please try again.');
    } finally {
      clearTimeout(timer);
    }
  }

  function ok(r: { status: number; body: unknown }, expected: number[] = [200]) {
    if (!expected.includes(r.status)) throw describeError(r.status, r.body);
  }

  return {
    async createAccount(p) {
      const body: Record<string, unknown> = {
        name: p.name,
        login: p.login,
        password: p.password,
        server: p.server,
        platform: 'mt5',
        magic: 0,
        copyFactoryRoles: p.roles,
        reliability: 'high',
      };
      if (p.region) {
        assertRegion(p.region);
        body.region = p.region;
      }
      if (p.keywords && p.keywords.length) body.keywords = p.keywords;
      const r = await call('POST', `${PROVISIONING_BASE}/users/current/accounts`, {
        body,
        headers: { 'transaction-id': p.transactionId },
      });
      if (r.status === 202) {
        const ra = Number(r.headers.get('retry-after'));
        return { status: 'pending', retryAfterSeconds: Number.isFinite(ra) && ra > 0 ? Math.min(ra, 300) : 60 };
      }
      ok(r, [200, 201]);
      const id = (r.body as { id?: string } | null)?.id;
      if (typeof id !== 'string') throw new MetaApiError(502, 'bad_response', 'Unexpected answer from the copying service.');
      return { status: 'created', id };
    },

    async getAccount(id) {
      assertId(id);
      const r = await call('GET', `${PROVISIONING_BASE}/users/current/accounts/${id}`);
      ok(r);
      const b = (r.body ?? {}) as Record<string, unknown>;
      return {
        id: String(b._id ?? b.id ?? id),
        state: String(b.state ?? ''),
        connectionStatus: String(b.connectionStatus ?? ''),
        region: typeof b.region === 'string' ? b.region : '',
        copyFactoryRoles: Array.isArray(b.copyFactoryRoles) ? (b.copyFactoryRoles as string[]) : [],
      };
    },

    async deploy(id) {
      assertId(id);
      ok(await call('POST', `${PROVISIONING_BASE}/users/current/accounts/${id}/deploy`), [204, 200]);
    },

    async undeploy(id) {
      assertId(id);
      ok(await call('POST', `${PROVISIONING_BASE}/users/current/accounts/${id}/undeploy`), [204, 200]);
    },

    async removeAccount(id) {
      assertId(id);
      const r = await call('DELETE', `${PROVISIONING_BASE}/users/current/accounts/${id}`);
      if (r.status === 404) return; // already gone
      ok(r, [204, 200]);
    },

    async accountInformation(id, region) {
      assertId(id);
      const r = await call('GET', `${clientHost(region)}/users/current/accounts/${id}/account-information`);
      ok(r);
      const b = (r.body ?? {}) as Record<string, unknown>;
      const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      return {
        balance: n(b.balance),
        equity: n(b.equity),
        margin: n(b.margin),
        freeMargin: n(b.freeMargin),
        marginLevel: typeof b.marginLevel === 'number' ? b.marginLevel : undefined,
        leverage: typeof b.leverage === 'number' ? b.leverage : undefined,
        currency: typeof b.currency === 'string' ? b.currency : '',
        marginMode: typeof b.marginMode === 'string' ? b.marginMode : undefined,
        tradeAllowed: typeof b.tradeAllowed === 'boolean' ? b.tradeAllowed : undefined,
        login: b.login as number | string | undefined,
        server: typeof b.server === 'string' ? b.server : undefined,
        broker: typeof b.broker === 'string' ? b.broker : undefined,
      };
    },

    async positions(id, region) {
      assertId(id);
      const r = await call('GET', `${clientHost(region)}/users/current/accounts/${id}/positions`);
      ok(r);
      if (!Array.isArray(r.body)) return [];
      return (r.body as Array<Record<string, unknown>>).map((p) => ({
        id: String(p.id ?? ''),
        type: String(p.type ?? ''),
        symbol: String(p.symbol ?? ''),
        volume: Number(p.volume ?? 0),
        openPrice: Number(p.openPrice ?? 0),
        currentPrice: p.currentPrice === undefined ? undefined : Number(p.currentPrice),
        profit: Number(p.profit ?? 0),
        swap: p.swap === undefined ? undefined : Number(p.swap),
        time: String(p.time ?? ''),
        stopLoss: p.stopLoss === undefined ? undefined : Number(p.stopLoss),
        takeProfit: p.takeProfit === undefined ? undefined : Number(p.takeProfit),
      }));
    },

    async deals(id, region, fromIso, toIso) {
      assertId(id);
      const host = clientHost(region);
      const out: MetaDeal[] = [];
      for (let page = 0; page < MAX_DEAL_PAGES; page++) {
        const url =
          `${host}/users/current/accounts/${id}/history-deals/time/` +
          `${encodeURIComponent(fromIso)}/${encodeURIComponent(toIso)}?offset=${page * DEAL_PAGE}&limit=${DEAL_PAGE}`;
        const r = await call('GET', url);
        ok(r);
        const arr = Array.isArray(r.body) ? (r.body as Array<Record<string, unknown>>) : [];
        for (const d of arr) {
          out.push({
            id: String(d.id ?? ''),
            type: String(d.type ?? ''),
            entryType: typeof d.entryType === 'string' ? d.entryType : undefined,
            profit: typeof d.profit === 'number' ? d.profit : 0,
            commission: typeof d.commission === 'number' ? d.commission : 0,
            swap: typeof d.swap === 'number' ? d.swap : 0,
            symbol: typeof d.symbol === 'string' ? d.symbol : undefined,
            volume: typeof d.volume === 'number' ? d.volume : undefined,
            time: String(d.time ?? ''),
          });
        }
        if (arr.length < DEAL_PAGE) return out;
      }
      // Too many deals for one window: refuse rather than silently under-count profit.
      throw new MetaApiError(502, 'too_many_deals', 'Too many trades to read at once. Please contact support.');
    },

    async generateStrategyId(region) {
      const r = await call('POST', `${copyFactoryHost(region)}/users/current/configuration/unused-strategy-id`);
      ok(r, [200, 201]);
      const id = (r.body as { id?: string } | null)?.id;
      if (typeof id !== 'string' || !ID_RE.test(id)) throw new MetaApiError(502, 'bad_response', 'Unexpected answer from the copying service.');
      return id;
    },

    async putStrategy(region, strategyId, body) {
      assertId(strategyId);
      ok(await call('PUT', `${copyFactoryHost(region)}/users/current/configuration/strategies/${strategyId}`, { body }), [204, 200]);
    },

    async putSubscriber(region, accountId, body) {
      assertId(accountId);
      ok(await call('PUT', `${copyFactoryHost(region)}/users/current/configuration/subscribers/${accountId}`, { body }), [204, 200]);
    },
  };
}

// ---------- CopyFactory configuration builders (pure) ----------

export interface SubscriberOptions {
  name: string;
  strategyId: string;
  scalingMode: 'balance' | 'equity';
  paused: boolean;
  symbolMapping?: Array<{ from: string; to: string }>;
  /** 0 disables. Otherwise stop copying and close positions after this % equity loss in a day. */
  dailyLossLimitPct: number;
}

export function buildSubscriberBody(o: SubscriberOptions): SubscriberBody {
  const sub: Record<string, unknown> = {
    strategyId: o.strategyId,
    // Trade size follows the client's balance (or equity) relative to the master account.
    tradeSizeScaling: { mode: o.scalingMode },
  };
  if (o.paused) sub.closeOnly = 'by-position'; // keep managing open trades, open no new ones
  if (o.symbolMapping && o.symbolMapping.length) sub.symbolMapping = o.symbolMapping;
  if (o.dailyLossLimitPct > 0) {
    sub.riskLimits = [
      {
        type: 'day',
        applyTo: 'equity-difference',
        maxRelativeRisk: o.dailyLossLimitPct / 100,
        closePositions: true,
      },
    ];
  }
  return { name: o.name, subscriptions: [sub] };
}
