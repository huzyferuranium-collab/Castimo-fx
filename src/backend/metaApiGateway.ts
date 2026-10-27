/**
 * The real MetaApi implementation of the BrokerGateway used by the client bridge and the supervisor.
 * It only forwards calls; all decisions live in clientBridge.ts and terminalPolicy.ts. It takes the API
 * object as an argument (and imports types only), so it can be tested with a fake.
 */

import type { AccountHandle, AccountSummary, BrokerGateway, CreateAccountParams, RpcHandle } from './clientBridge.ts';

/** The few MetaApi calls we use. The real SDK object satisfies this shape. */
export interface MetaApiLike {
  metatraderAccountApi: {
    getAccountsWithInfiniteScrollPagination(): Promise<any[]>;
    getAccount(id: string): Promise<any>;
    createAccount(params: any): Promise<{ id: string }>;
  };
}

/** True when MetaApi says the account does not exist (404). Any other failure is not "gone". */
export function isNotFound(e: any): boolean {
  const status = Number(e?.status ?? e?.statusCode ?? e?.code ?? 0);
  return (
    String(e?.name || '') === 'NotFoundError' ||
    status === 404 ||
    /\b(account|trading account)\b.*\bnot found\b|\bnot found\b.*\baccount\b/i.test(String(e?.message || ''))
  );
}

function wrapRpc(conn: any): RpcHandle {
  return {
    connect: () => conn.connect(),
    waitSynchronized: (seconds: number) => conn.waitSynchronized(seconds),
    getAccountInformation: () => conn.getAccountInformation(),
    close: async () => {
      await conn.close?.();
    },
    raw: conn,
  };
}

function wrapAccount(entity: any): AccountHandle {
  return {
    id: entity.id,
    name: entity.name,
    login: entity.login,
    server: entity.server,
    state: entity.state,
    connectionStatus: entity.connectionStatus,
    // MetaApi's own wait returns at once when the account is already deployed.
    waitDeployed: async (seconds: number) => {
      if (entity.state === 'DEPLOYED') return;
      // A terminal MetaApi left undeployed (or never deployed) must be started, or the wait never ends.
      if (entity.state === 'UNDEPLOYED' || entity.state === 'DRAFT') await entity.deploy();
      await entity.waitDeployed(seconds, 1000);
    },
    deploy: async () => {
      await entity.deploy();
    },
    redeploy: async () => {
      await entity.redeploy();
    },
    snapshot: async () => {
      await entity.reload();
      return { state: entity.state, connectionStatus: entity.connectionStatus };
    },
    rpc: () => wrapRpc(entity.getRPCConnection()),
    raw: entity,
  };
}

export function metaApiGateway(api: MetaApiLike): BrokerGateway {
  const accounts = api.metatraderAccountApi;
  return {
    async listAccounts(): Promise<AccountSummary[]> {
      const all = await accounts.getAccountsWithInfiniteScrollPagination();
      return all.map((a: any) => {
        const s: AccountSummary = { id: a.id, name: a.name, login: a.login, server: a.server };
        if (a.state !== undefined) s.state = a.state;
        if (a.connectionStatus !== undefined) s.connectionStatus = a.connectionStatus;
        return s;
      });
    },
    async createAccount(p: CreateAccountParams) {
      const dto = await accounts.createAccount({
        name: p.name,
        type: 'cloud-g2',
        login: p.login,
        password: p.password,
        server: p.server,
        platform: p.platform,
        magic: p.magic,
        region: p.region,
        reliability: p.reliability,
        manualTrades: false,
      });
      return { id: dto.id };
    },
    async getAccount(id: string) {
      return wrapAccount(await accounts.getAccount(id));
    },
    async findAccount(id: string) {
      try {
        return wrapAccount(await accounts.getAccount(id));
      } catch (e: any) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    async removeAccount(id: string) {
      let entity: any;
      try {
        entity = await accounts.getAccount(id);
      } catch (e: any) {
        if (isNotFound(e)) return; // already gone: nothing to remove
        throw e;
      }
      await entity.remove();
    },
  };
}
