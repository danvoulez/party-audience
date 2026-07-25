import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Env } from "../../src/worker/index";

/**
 * D1 de teste sobre SQLite real (node:sqlite), rodando migrations/0001_init.sql.
 *
 * O objetivo é que os testes exercitem o SQL de verdade contra o schema de
 * verdade: um nome de coluna errado ou uma constraint violada falha aqui, e não
 * só em produção. Só o subconjunto do D1 usado por src/worker/db.ts é coberto.
 */

/** D1 aceita boolean/undefined; node:sqlite exige inteiro/null. */
function toSqlite(value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
}

class TestStatement implements D1PreparedStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}

  // D1 devolve um statement novo a cada bind, sem mutar o original.
  bind(...values: unknown[]): D1PreparedStatement {
    return new TestStatement(this.db, this.sql, values.map(toSqlite));
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.values as never[]));
    return (row as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const results = this.db.prepare(this.sql).all(...(this.values as never[])) as T[];
    return { results, success: true, meta: {} };
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const stmt = this.db.prepare(this.sql);
    // SELECT via run() precisa devolver linhas; node:sqlite separa get/all de run.
    if (/^\s*select/i.test(this.sql)) {
      return { results: stmt.all(...(this.values as never[])) as T[], success: true, meta: {} };
    }
    const info = stmt.run(...(this.values as never[]));
    return { results: [], success: true, meta: { changes: Number(info.changes) } };
  }
}

export class TestD1 implements D1Database {
  private readonly db = new DatabaseSync(":memory:");

  constructor(migrationPath = "migrations/0001_init.sql") {
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(readFileSync(migrationPath, "utf-8"));
  }

  prepare(query: string): D1PreparedStatement {
    return new TestStatement(this.db, query);
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const out: D1Result[] = [];
    this.db.exec("BEGIN");
    try {
      for (const stmt of statements) out.push(await stmt.run());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return out;
  }

  /** Atalho de inspeção para asserções sobre o estado persistido. */
  query<T = Record<string, unknown>>(sql: string, ...values: unknown[]): T[] {
    return this.db.prepare(sql).all(...(values.map(toSqlite) as never[])) as T[];
  }
}

export interface RoomCall {
  sessionId: string;
  path: string;
  body: unknown;
}

/**
 * Durable Object de teste: não simula a sala, apenas registra o que o Worker
 * mandou para ela, para que os testes possam afirmar quem foi notificado.
 */
export function makeRooms(): { ns: DurableObjectNamespace; calls: RoomCall[] } {
  const calls: RoomCall[] = [];
  const ns = {
    idFromName: (name: string) => ({ toString: () => name }) as DurableObjectId,
    get: (id: DurableObjectId) => ({
      fetch: async (input: string, init?: RequestInit) => {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        calls.push({ sessionId: id.toString(), path: new URL(input).pathname, body });
        return new Response(null, { status: 204 });
      },
    }),
  } as unknown as DurableObjectNamespace;
  return { ns, calls };
}

export function makeEnv(): Env & { DB: TestD1; roomCalls: RoomCall[] } {
  const DB = new TestD1();
  const { ns, calls } = makeRooms();
  return {
    DB,
    SESSION_ROOMS: ns,
    roomCalls: calls,
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    REALTIMEKIT_APP_ID: "test-app",
    CLOUDFLARE_API_TOKEN: "test-token",
  };
}
