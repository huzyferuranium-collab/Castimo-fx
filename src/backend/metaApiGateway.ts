/**
 * The real MetaApi implementation of the BrokerGateway used by the client bridge.
 * It only forwards calls; all decisions live in clientBridge.ts. It takes the API object as an
 * argument (and imports types only), so it can be tested with a fake.
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

function wrapRpc(conn: any): RpcHandle {
  return {
    connect: () => conn.connect(),
    waitSynchronized: (seconds: number) => conn.waitSynchronized(seconds),
    getAccountInformation: () => conn.getAccountInformation(),
    raw: conn,
  };
}

function wrapAccount(entity: any): AccountHandle {
  return {
    id: entity.id,
    name: entity.name,
    login: entity.login,
    server: entity.server,
    // MetaApi's own wait returns at once when the account is already deployed.
    waitDeployed: async (seconds: number) => {
      if (entity.state !== 'DEPLOYED') await entity.waitDeployed(seconds, 1000);
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
      return all.map((a: any) => ({ id: a.id, name: a.name, login: a.login, server: a.server }));
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
    async removeAccount(id: string) {
      const entity = await accounts.getAccount(id);
      await entity.remove();
    },
  };
}
