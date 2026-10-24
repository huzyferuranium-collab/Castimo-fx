/**
 * CASTIMOFX - MetaApi Node SDK Loader
 * 
 * Safely resolves the Node-specific ESM build (metaapi.cloud-sdk/esm-node)
 * avoiding web/browser window globals while preserving full TypeScript types.
 */

// @ts-ignore - Node ESM bundle in runtime
import MetaApiDefault, { SynchronizationListener as NodeSyncListener } from 'metaapi.cloud-sdk/esm-node';
import type {
  MetatraderAccount,
  StreamingMetaApiConnectionInstance,
  RpcMetaApiConnectionInstance,
} from 'metaapi.cloud-sdk';
import type {
  MetatraderPosition,
  MetatraderAccountInformation,
} from 'metaapi.cloud-sdk/dist/clients/metaApi/metaApiWebsocket.client';

// Enable Log4js logging on MetaApi SDK to suppress unformatted raw socket/transport errors
try {
  if (typeof (MetaApiDefault as any)?.enableLog4jsLogging === 'function') {
    (MetaApiDefault as any).enableLog4jsLogging();
  }
} catch {
  // Ignored
}

export const MetaApi = (MetaApiDefault as unknown) as typeof import('metaapi.cloud-sdk').default;
export const SynchronizationListener = (NodeSyncListener as unknown) as typeof import('metaapi.cloud-sdk').SynchronizationListener;

export type MetaApiInstance = InstanceType<typeof MetaApi>;

export type {
  MetatraderAccount,
  StreamingMetaApiConnectionInstance,
  RpcMetaApiConnectionInstance,
  MetatraderPosition,
  MetatraderAccountInformation,
};

export default MetaApi;
