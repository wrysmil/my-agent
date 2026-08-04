import { getDb } from "./db.js";

export interface SessionMeta {
  id: string;
  name: string;
  model: string;
  provider: string;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: number;
  updatedAt: number;
  isArchived: boolean;
}

export function upsertSession(meta: Omit<SessionMeta, "isArchived">): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO sessions (id, name, model, provider, message_count,
      input_tokens, output_tokens, created_at, updated_at)
    VALUES (@id, @name, @model, @provider, @messageCount,
      @inputTokens, @outputTokens, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      model = excluded.model,
      message_count = excluded.message_count,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      updated_at = excluded.updated_at
  `).run(meta);
}

export function listSessions(opts?: {
  search?: string;
  offset?: number;
  limit?: number;
}): SessionMeta[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (opts?.search) {
    conditions.push("name LIKE @search");
    params.search = `%${opts.search}%`;
  }

  const where = conditions.length > 0
    ? `WHERE ${conditions.join(" AND ")}`
    : "";
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const rows = db.prepare(`
    SELECT id, name, model, provider,
           message_count AS messageCount,
           input_tokens AS inputTokens,
           output_tokens AS outputTokens,
           created_at AS createdAt,
           updated_at AS updatedAt,
           is_archived AS isArchived
    FROM sessions
    ${where}
    ORDER BY updated_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset }) as any[];

  return rows.map((r) => ({ ...r, isArchived: r.isArchived === 1 }));
}

export function getSession(id: string): SessionMeta | undefined {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, name, model, provider,
           message_count AS messageCount,
           input_tokens AS inputTokens,
           output_tokens AS outputTokens,
           created_at AS createdAt,
           updated_at AS updatedAt,
           is_archived AS isArchived
    FROM sessions WHERE id = ?
  `).get(id) as any;
  if (!row) return undefined;
  return { ...row, isArchived: row.isArchived === 1 };
}

export function countSessions(opts?: {
  search?: string;
}): number {
  const db = getDb();
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (opts?.search) {
    conditions.push("name LIKE @search");
    params.search = `%${opts.search}%`;
  }

  const where = conditions.length > 0
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const row = db.prepare(
    `SELECT COUNT(*) as cnt FROM sessions ${where}`
  ).get(params) as { cnt: number };
  return row.cnt;
}

export function deleteSession(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function renameSession(id: string, name: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE sessions SET name = @name, updated_at = @now WHERE id = @id"
  ).run({ id, name, now: Date.now() });
}

export function archiveSession(id: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE sessions SET is_archived = 1, updated_at = @now WHERE id = @id"
  ).run({ id, now: Date.now() });
}

export function unarchiveSession(id: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE sessions SET is_archived = 0, updated_at = @now WHERE id = @id"
  ).run({ id, now: Date.now() });
}
