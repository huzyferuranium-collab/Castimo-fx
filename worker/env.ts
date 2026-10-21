/** Bindings and settings the Worker receives from Cloudflare. */
export interface Env {
  /** Serves the built website (dist/). */
  ASSETS: Fetcher;
  /** The single ledger database (Durable Object with SQLite). */
  LEDGER: DurableObjectNamespace;

  /** Firebase project whose sign-in tokens we accept. Public value. */
  FIREBASE_PROJECT_ID: string;
  /** Default MetaApi region (e.g. "new-york"). Public value. */
  METAAPI_REGION?: string;

  /** SECRET. Comma separated e-mail addresses allowed to use the admin console. */
  ADMIN_EMAILS?: string;
  /** SECRET. MetaApi API token (https://app.metaapi.cloud/token). */
  METAAPI_TOKEN?: string;
}
