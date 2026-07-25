/**
 * Subconjunto mínimo dos tipos do runtime Cloudflare usados pelo Worker.
 * Mantido à mão para conviver com a lib DOM no mesmo tsconfig (os tipos
 * oficiais @cloudflare/workers-types redeclaram os globais de fetch).
 */

interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

interface CfWebSocket extends WebSocket {
  accept(): void;
}

declare const WebSocketPair: new () => { 0: CfWebSocket; 1: CfWebSocket };

interface ResponseInit {
  webSocket?: CfWebSocket;
}

interface Response {
  webSocket?: CfWebSocket | null;
}

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectState {
  waitUntil(promise: Promise<unknown>): void;
}
