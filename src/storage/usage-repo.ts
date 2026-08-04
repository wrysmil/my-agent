import { getDb } from "./db.js";
import type { Usage } from "../shared/types.js";

export function logUsage(input: {
  sessionId: string;
  model: string;
  provider: string;
  usage: Usage;
  toolLoops: number;
  durationMs: number;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO usage_logs (session_id, model, provider,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      tool_loops, duration_ms, created_at)
    VALUES (@sessionId, @model, @provider,
      @inputTokens, @outputTokens, @cacheRead, @cacheWrite,
      @toolLoops, @durationMs, @createdAt)
  `).run({
    sessionId: input.sessionId,
    model: input.model,
    provider: input.provider,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cacheRead: input.usage.cacheReadTokens ?? 0,
    cacheWrite: input.usage.cacheWriteTokens ?? 0,
    toolLoops: input.toolLoops,
    durationMs: input.durationMs,
    createdAt: Date.now(),
  });

  db.prepare(`
    UPDATE sessions
    SET input_tokens = input_tokens + @inputTokens,
        output_tokens = output_tokens + @outputTokens
    WHERE id = @sessionId
  `).run({
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    sessionId: input.sessionId,
  });
}

export function dailyUsage(days = 30): Array<{
  date: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const db = getDb();
  return db.prepare(`
    SELECT date(created_at / 1000, 'unixepoch') AS date,
           SUM(input_tokens) AS inputTokens,
           SUM(output_tokens) AS outputTokens
    FROM usage_logs
    WHERE created_at > @since
    GROUP BY date
    ORDER BY date DESC
  `).all({ since: Date.now() - days * 86400_000 }) as any[];
}
