// A PRETEND Duplikium (copier service) shared by the tests that need one. It proves our own wiring only; it says nothing
// about the real service.
import { DuplikiumError } from '../../src/backend/duplikiumClient.ts';
import type { CopierApi, DuplikiumAccount, AddAccountParams, DuplikiumSetting, PositionsResult, DuplikiumPosition } from '../../src/backend/duplikiumClient.ts';

export class FakeCopier implements CopierApi {
  accounts = new Map<string, DuplikiumAccount>();
  copier = new Map<string, number>(); // slave id -> copier_status
  calls: string[] = [];
  added: AddAccountParams[] = [];
  updated: Array<{ id: string; changes: any }> = [];
  deleted: string[] = [];
  settingCalls: any[] = [];
  seq = 0;
  failGetAccounts = false;
  failSetSettings = false;
  ignoreStatusChange = false;
  /** What a newly added account looks like once Duplikium has logged in. */
  fresh: Partial<DuplikiumAccount> = { state: 'CONNECTED', balance: 500, equity: 520, freeMargin: 480, currency: 'USD' };
  templateRow: DuplikiumSetting = { idMaster: 'MASTER', idSlave: null, idGroup: 'TEMPLATE', copierStatus: 1, riskFactorType: 11, riskFactorValue: 0.5 };
  openPositions: Record<string, DuplikiumPosition[]> = {};
  closedPositions: Record<string, DuplikiumPosition[]> = {};
  positionCalls = 0;

  constructor() {
    this.accounts.set('MASTER', {
      accountId: 'MASTER', name: 'HFM master', login: '261089492', server: 'HFMarketsGlobal-Live20', broker: 'mt5', type: 'master', enabled: true,
      balance: 10_000, equity: 10_250, freeMargin: 9_000, currency: 'USD', state: 'CONNECTED', lastUpdate: '2026-10-30 10:00:00', groupId: null, subscriptionKey: null, openTrades: 1,
    });
  }

  async addAccount(p: AddAccountParams) {
    this.calls.push('addAccount');
    this.added.push(p);
    const id = `D${++this.seq}`;
    this.accounts.set(id, {
      accountId: id, name: p.name, login: p.login, server: p.server, broker: p.broker, type: 'slave', enabled: p.enabled,
      balance: null, equity: null, freeMargin: null, currency: '', state: 'NONE', lastUpdate: null, groupId: p.group ?? null, subscriptionKey: p.subscription ?? null, openTrades: 0,
      ...this.fresh,
    });
    return { accountId: id };
  }
  async deleteAccount(id: string) {
    this.calls.push('deleteAccount');
    this.deleted.push(id);
    this.accounts.delete(id);
    this.copier.delete(id);
  }
  async updateAccount(id: string, changes: any) {
    this.calls.push('updateAccount');
    this.updated.push({ id, changes });
    const a = this.accounts.get(id);
    if (a && changes.enabled !== undefined) a.enabled = changes.enabled;
  }
  async getAccounts(ids?: string | string[]) {
    this.calls.push('getAccounts');
    if (this.failGetAccounts) throw new DuplikiumError('NETWORK', 'down');
    const list = Array.from(this.accounts.values()).map((a) => ({ ...a }));
    if (!ids) return list;
    const want = new Set(Array.isArray(ids) ? ids : [ids]);
    return list.filter((a) => want.has(a.accountId));
  }
  async getSettings(f: { idMaster?: string; idSlave?: string; idGroup?: string }) {
    this.calls.push('getSettings');
    if (f.idGroup) return [this.templateRow];
    const rows: DuplikiumSetting[] = [];
    for (const [slave, status] of this.copier) {
      if (f.idSlave && f.idSlave !== slave) continue;
      rows.push({ idMaster: 'MASTER', idSlave: slave, idGroup: null, copierStatus: status, riskFactorType: 11, riskFactorValue: 0.5 });
    }
    return rows;
  }
  async setSettings(s: any) {
    this.calls.push('setSettings');
    this.settingCalls.push(s);
    if (this.failSetSettings) throw new DuplikiumError('API', 'settings are down');
    if (s.idSlave && !this.ignoreStatusChange) this.copier.set(s.idSlave, s.copierStatus);
  }
  async getOpenPositions(id: string): Promise<PositionsResult> {
    this.positionCalls++;
    return { positions: this.openPositions[id] ?? [], skipped: 0 };
  }
  async getClosedPositions(id: string): Promise<PositionsResult> {
    return { positions: this.closedPositions[id] ?? [], skipped: 0 };
  }
  /** Makes an account look the way Duplikium would report it after logging in. */
  settle(id: string, over: Partial<DuplikiumAccount> = {}) {
    Object.assign(this.accounts.get(id)!, { state: 'CONNECTED', balance: 500, equity: 520, freeMargin: 480, currency: 'USD', ...over });
  }
}
