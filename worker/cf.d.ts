// Minimal Cloudflare runtime types. Kept local so the backend needs no extra packages.
// Only what this project actually uses is declared here.

interface SqlStorageCursor<T = Record<string, unknown>> {
  toArray(): T[];
  one(): T;
  readonly rowsRead: number;
  readonly rowsWritten: number;
}

interface SqlStorage {
  exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): SqlStorageCursor<T>;
}

interface DurableObjectStorage {
  sql: SqlStorage;
  transactionSync<T>(closure: () => T): T;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

interface DurableObjectId {}

interface DurableObjectStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface Fetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface ScheduledController {
  readonly scheduledTime: number;
  readonly cron: string;
}
