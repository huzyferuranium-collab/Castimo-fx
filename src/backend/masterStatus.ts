/**
 * What GET /api/trade/account-status tells the caller about the master account.
 *
 * The route needs a signed-in user. Everyone signed in sees the connection state and the master's figures the client
 * dashboard shows; only an administrator also gets the master's account number, broker server and Duplikium id,
 * which would help someone impersonate the business or target its clients.
 */
import type { MasterAccountMetrics } from './MT5_CONNECTION_MANAGER';

export function shapeMasterStatus(
  metrics: MasterAccountMetrics,
  connected: boolean,
  activeClientsCount: number,
  isAdmin: boolean,
  nowIso: string
) {
  return {
    success: true,
    connected,
    status: metrics.state,
    connectionStatus: metrics.connectionStatus,
    lastPing: metrics.lastHeartbeat,
    mode: 'LIVE_DUPLIKIUM',
    master: {
      accountId: isAdmin ? metrics.accountId || '' : '',
      login: isAdmin ? metrics.login || '' : '',
      server: isAdmin ? metrics.server || '' : '',
      balance: metrics.balance,
      equity: metrics.equity,
      freeMargin: metrics.freeMargin,
      currency: metrics.currency,
      openPositionsCount: metrics.openPositionsCount,
    },
    activeClientsCount,
    timestamp: nowIso,
  };
}
