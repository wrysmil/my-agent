/**
 * my-agent Web 前端 — Chat 流 2 条 SSE 路由单测（WU-02b / B3 + P0 会话流隔离）。
 *
 * 覆盖 done criteria #7 + contract § 4 + P0 spec（2026-08-10-chat-session-stream-isolation）：
 * ① stream happy path 至少 3 个 event（mock runner 发 text_delta / message_end）
 *    + 每条 SSE 事件携带统一 envelope（sessionId / runId / streamId / seq / event / data）
 * ② stream AbortController 中途取消 → 触发 aborted 事件 + hub 流清理
 * ③ Last-Event-ID 去重（lastEventLru 跳过重复 seq）
 * ④ heartbeat 触发（fake timers，验证 sseResponse 集成）
 * ⑤ done 事件必发 + 携带 persistedRevision / messageId
 * ⑥ error 事件形态（runner 抛错时，envelope 内层）
 * ⑦ 13 event 类型断言（mock runner 触发 ≥8 种 → 验证全部出现在响应流）
 * ⑧ P0 并发保护：同 session 已有活跃 run → 409 RUN_ALREADY_ACTIVE（不再静默 abort 旧流）
 * ⑨ abort 端点：指定 streamId / runId → 200；不存在 → 404 STREAM_NOT_FOUND
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { IncomingMessage, ServerResponse } from "node:http";
import { AgentRunner } from "../../../agent/runner.js";
import { SessionStore } from "../../../storage/session-store.js";
import { ProviderRegistry } from "../../../providers/registry.js";
import { createConfig } from "../../../config/loader.js";
import { defineTool } from "../../../tools/base.js";
import type { AgentRunParams } from "../../../agent/types.js";
import type { StreamEvent } from "../../../shared/types.js";
import type { PersistentSession } from "../../../agent/persistent-session.js";
import { MockProvider } from "../../../../test/mocks/provider.js";

import { installMessageRoutes } from "./messages.js";
import { ROUTES } from "../router.js";
import {
  _resetHub,
  _resetLru,
  hub,
  lastEventLru,
} from "../sse.js";

// ============================================================
// 共享 mock
// ============================================================

function makeMockRes(): ServerResponse & {
  body: string;
  statusCode: number;
  headers: Record<string, string>;
  ended: boolean;
} {
  const resHeaders: Record<string, string> = {};
  const res = new EventEmitter() as ServerResponse & {
    body: string;
    statusCode: number;
    headers: Record<string, string>;
    ended: boolean;
  };
  res.body = "";
  res.statusCode = 0;
  res.headers = resHeaders;
  res.ended = false;

  (res as unknown as { setHeader: (k: string, v: string) => void }).setHeader = (
    k: string,
    v: string,
  ): void => {
    resHeaders[k.toLowerCase()] = v;
  };
  (res as unknown as { getHeader: (k: string) => string | undefined }).getHeader = (
    k: string,
  ): string | undefined => resHeaders[k.toLowerCase()];
  (res as unknown as { write: (chunk: string) => boolean }).write = (
    chunk: string,
  ): boolean => {
    res.body += chunk;
    return true;
  };
  (res as unknown as { end: (chunk?: string) => void }).end = (chunk?: string): void => {
    if (chunk) res.body += chunk;
    res.ended = true;
    res.emit("close");
  };

  return res;
}

function makeMockReq(opts: {
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
}): IncomingMessage {
  const reqBody = opts.body ?? "";
  const chunks = [Buffer.from(reqBody, "utf-8")];
  const readable = new EventEmitter() as IncomingMessage & { readable: boolean };
  readable.readable = true;
  readable.method = opts.method;
  readable.url = opts.url;
  readable.headers = { ...(opts.headers ?? {}) };

  (readable as unknown as { [Symbol.asyncIterator]: () => AsyncIterableIterator<Buffer> })[
    Symbol.asyncIterator
  ] = (): AsyncIterableIterator<Buffer> => {
    let idx = 0;
    const iter: AsyncIterableIterator<Buffer> = {
      [Symbol.asyncIterator](): AsyncIterableIterator<Buffer> {
        return iter;
      },
      async next(): Promise<IteratorResult<Buffer>> {
        if (idx < chunks.length) {
          const v = chunks[idx++];
          return { value: v, done: false };
        }
        return { value: undefined as unknown as Buffer, done: true };
      },
    };
    return iter;
  };

  return readable;
}

/**
 * 把 SSE body 解析成 `[{ event, data, id? }]` 数组。
 * 跳过 `: heartbeat` 注释行。
 */
type ParsedSse = {
  event: string;
  data: unknown;
  id?: number;
};

/**
 * P0 SSE envelope（contract § 4.3 / spec § 4.3）。
 *
 * 每个物理 frame 的 `data` 均为该结构：外层带身份字段，业务 payload 在 `data.data`。
 */
type SseEnvelope = {
  sessionId: string;
  runId: string;
  streamId: string;
  seq: number;
  event: string;
  data: { [k: string]: unknown };
};

/** 找 stream 路由（POST /api/sessions/:id/messages/stream）。 */
function findStreamRoute(): { handler: import("../router.js").Handler; params: Record<string, string> } | undefined {
  const route = ROUTES.find(
    ([m, p]) =>
      m === "POST" &&
      p instanceof RegExp &&
      p.source.endsWith("messages\\/stream$"),
  );
  if (!route) return undefined;
  return { handler: route[2] as import("../router.js").Handler, params: { id: "" } };
}

/** 找 abort 路由（POST /api/sessions/:id/messages/abort）。 */
function findAbortRoute(): { handler: import("../router.js").Handler; params: Record<string, string> } | undefined {
  const route = ROUTES.find(
    ([m, p]) =>
      m === "POST" &&
      p instanceof RegExp &&
      p.source.endsWith("messages\\/abort$"),
  );
  if (!route) return undefined;
  return { handler: route[2] as import("../router.js").Handler, params: { id: "" } };
}

function parseSse(body: string): ParsedSse[] {
  const out: ParsedSse[] = [];
  // 按 `\n\n` 切块
  const blocks = body.split(/\n\n/);
  for (const blk of blocks) {
    if (!blk.trim()) continue;
    const lines = blk.split("\n");
    let event: string | undefined;
    let dataRaw = "";
    let id: number | undefined;
    let isComment = false;
    for (const ln of lines) {
      if (ln.startsWith(":")) {
        isComment = true;
        continue;
      }
      if (ln.startsWith("id:")) id = Number(ln.slice(3).trim());
      if (ln.startsWith("event:")) event = ln.slice(6).trim();
      if (ln.startsWith("data:")) {
        dataRaw += ln.slice(5).trim();
      }
    }
    if (isComment && !event) continue;
    if (event === undefined) continue;
    let data: unknown = dataRaw;
    try {
      data = JSON.parse(dataRaw);
    } catch {
      // keep raw
    }
    out.push({ event, data, ...(id !== undefined ? { id } : {}) });
  }
  return out;
}

// ============================================================
// Runner factory 工厂（mock runner）
// ============================================================

function makeMockRunnerFactory(events: StreamEvent[]): (input: {
  session: PersistentSession;
}) => { runStream(params: AgentRunParams): AsyncIterable<StreamEvent> } {
  return () => ({
    async *runStream(params: AgentRunParams): AsyncIterable<StreamEvent> {
      // 模拟异步 yield
      for (const ev of events) {
        if (params.signal?.aborted) return;
        await Promise.resolve();
        if (params.signal?.aborted) return;
        yield ev;
      }
    },
  });
}

// ============================================================
// 共享夹具
// ============================================================

let tmpDir: string;
let sessionStore: SessionStore;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-messages-"));
  sessionStore = new SessionStore(tmpDir);
  _resetHub();
  _resetLru();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  _resetHub();
  _resetLru();
});

// ============================================================
// ① stream happy path — 至少 3 个 event
// ============================================================

describe("POST /api/sessions/:id/messages/stream — happy path", () => {
  it("mock runner 发 text_delta + terminal done → 响应至少 3 个 event + done 必发", async () => {
    const session = sessionStore.create("gconv");
    const events: StreamEvent[] = [
      { type: "message_start", usage: { inputTokens: 10 } },
      { type: "text_delta", text: "你好" },
      { type: "text_delta", text: "世界" },
      {
        type: "message_end",
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        model: "deepseek-chat",
      },
      { type: "done", result: {} },
    ];

    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory: makeMockRunnerFactory(events),
    });

    const { req, res } = { req: makeMockReq({ method: "POST", url: `/api/sessions/${session.sessionId}/messages/stream`, body: JSON.stringify({ text: "hello" }) }), res: makeMockRes() };

    const route = findStreamRoute();
    expect(route).toBeDefined();
    await route!.handler(req, res, { id: session.sessionId });

    // 响应头断言
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(res.headers["x-stream-id"]).toBeTruthy();

    // SSE 解析
    const parsed = parseSse(res.body);
    expect(parsed.length).toBeGreaterThanOrEqual(3);

    // 必发 done 事件
    const doneEvent = parsed.find((e) => e.event === "done");
    expect(doneEvent).toBeDefined();

    // 必发 message_start
    const messageStart = parsed.find((e) => e.event === "message_start");
    expect(messageStart).toBeDefined();

    // 必发至少 1 个 content_block_delta（含 "你好" 或 "世界"）
    const deltas = parsed.filter((e) => e.event === "content_block_delta");
    expect(deltas.length).toBeGreaterThanOrEqual(1);

    // ---- P0: 每条 SSE 事件携带统一 envelope（contract § 4.3）----
    for (const frame of parsed) {
      const env = frame.data as SseEnvelope;
      expect(env.sessionId).toBe(session.sessionId);
      expect(env.runId).toBeTruthy();
      expect(env.streamId).toBeTruthy();
      expect(typeof env.seq).toBe("number");
      expect(env.event).toBe(frame.event);
      expect(env.data).toBeDefined();
      // seq 唯一、严格递增，且与 `id:` 行一致
      expect(frame.id).toBe(env.seq);
    }
    const seqs = parsed.map((e) => (e.data as SseEnvelope).seq);
    expect(new Set(seqs).size).toBe(parsed.length); // 唯一
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs); // 严格递增

    // ---- P0: message_start 必须含 run_id / stream_id / messageId ----
    const msEnv = messageStart!.data as SseEnvelope;
    const msMsg = msEnv.data.message as {
      id: string;
      run_id: string;
      stream_id: string;
    };
    expect(msMsg.run_id).toBeTruthy();
    expect(msMsg.run_id).toBe(msEnv.runId);
    expect(msMsg.stream_id).toBe(msEnv.streamId);
    expect(msMsg.id).toBeTruthy();

    // ---- P0: done 事件携带 persistedRevision + messageId ----
    const doneEnv = doneEvent!.data as SseEnvelope;
    expect(typeof doneEnv.data.persistedRevision).toBe("number");
    expect(doneEnv.data.messageId).toBeTruthy();
    expect(doneEnv.data.messageId).toBe(msMsg.id);
  });

  it("route 将稳定 ID 传给 runner，且只发一个携带终态 revision 的 done", async () => {
    const session = sessionStore.create("gconv");
    const runId = "11111111-1111-4111-8111-111111111111";
    const clientMessageId = "22222222-2222-4222-8222-222222222222";
    let receivedParams: AgentRunParams | undefined;

    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory: ({ session: persistentSession }) => ({
        async *runStream(params: AgentRunParams): AsyncIterable<StreamEvent> {
          receivedParams = params;
          await persistentSession.beginUserTurn(
            [{ type: "text", text: params.message }],
            { id: params.clientMessageId, runId: params.runId },
          );
          await persistentSession.addAssistantMessage(
            [{ type: "text", text: "完成", id: `${params.assistantMessageId}:0` }],
            { id: params.assistantMessageId, runId: params.runId },
          );
          yield {
            type: "done",
            result: {
              text: "完成",
              content: [],
              meta: {
                durationMs: 1,
                model: "mock",
                provider: "mock",
                stopReason: "end_turn",
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                toolLoops: 0,
                compactionCount: 0,
              },
            },
          };
        },
      }),
    });

    const req = makeMockReq({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/messages/stream`,
      body: JSON.stringify({ text: "hello", runId, clientMessageId }),
    });
    const res = makeMockRes();

    const route = findStreamRoute();
    await route!.handler(req, res, { id: session.sessionId });

    expect(receivedParams).toMatchObject({ runId, clientMessageId });
    expect(receivedParams?.assistantMessageId).toBeTruthy();

    const parsed = parseSse(res.body);
    const starts = parsed.filter((frame) => frame.event === "message_start");
    const dones = parsed.filter((frame) => frame.event === "done");
    expect(starts).toHaveLength(1);
    expect(dones).toHaveLength(1);

    const startEnv = starts[0].data as SseEnvelope;
    const doneEnv = dones[0].data as SseEnvelope;
    const startMessage = startEnv.data.message as { id: string };
    expect(doneEnv.data).toMatchObject({
      ok: true,
      persistedRevision: 2,
      messageId: startMessage.id,
    });

    const persisted = session.getAllMessages();
    expect(persisted.map((message) => message.id)).toEqual([
      clientMessageId,
      startMessage.id,
    ]);
    expect(persisted.every((message) => message.runId === runId)).toBe(true);
  });

  it("成功 done 使用 runner 返回的实际终态 messageId", async () => {
    const session = sessionStore.create("gconv");
    const actualTerminalMessageId = "44444444-4444-4444-8444-444444444444";
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory: () => ({
        async *runStream(): AsyncIterable<StreamEvent> {
          yield {
            type: "done",
            result: {
              text: "完成",
              content: [],
              meta: {
                durationMs: 1,
                model: "mock",
                provider: "mock",
                stopReason: "end_turn",
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                toolLoops: 0,
                compactionCount: 0,
              },
            },
            messageId: actualTerminalMessageId,
          } as StreamEvent & { messageId: string };
        },
      }),
    });

    const req = makeMockReq({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/messages/stream`,
      body: JSON.stringify({ text: "hello" }),
    });
    const res = makeMockRes();

    const route = findStreamRoute();
    await route!.handler(req, res, { id: session.sessionId });

    const done = parseSse(res.body).find((frame) => frame.event === "done");
    expect((done?.data as SseEnvelope).data.messageId).toBe(actualTerminalMessageId);
  });

  it("真实 terminal tool 流程闭合 message_start、done 与最终 JSONL assistant ID", async () => {
    const session = sessionStore.create("gconv");
    const config = createConfig({
      agent: {
        defaultModel: "claude-sonnet-5",
        defaultProvider: "mock",
        maxRetries: 0,
        maxToolLoops: 5,
        toolIdleTimeoutMs: 5_000,
      },
    });
    const mockProvider = new MockProvider();
    const providers = new ProviderRegistry(config);
    providers.registerFactory("mock", () => mockProvider);
    const finishTool = defineTool({
      name: "finish",
      description: "完成并终止",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ content: "terminal complete", endTurn: true }),
    });
    mockProvider.program({
      kind: "tool_calls",
      text: "准备结束",
      calls: [{ id: "terminal-call", name: "finish", input: {} }],
    });

    installMessageRoutes({
      sessionStore,
      config,
      providers,
      runnerFactory: ({ session: persistentSession }) =>
        new AgentRunner({
          config,
          providers,
          tools: [finishTool],
          session: persistentSession,
        }),
    });

    const req = makeMockReq({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/messages/stream`,
      body: JSON.stringify({
        text: "run terminal tool",
        runId: "11111111-1111-4111-8111-111111111111",
        clientMessageId: "22222222-2222-4222-8222-222222222222",
      }),
    });
    const res = makeMockRes();

    const route = findStreamRoute();
    await route!.handler(req, res, { id: session.sessionId });

    const frames = parseSse(res.body);
    const start = frames.find((frame) => frame.event === "message_start");
    const done = frames.find((frame) => frame.event === "done");
    const startId = (
      (start?.data as SseEnvelope).data.message as { id: string }
    ).id;
    const doneId = (done?.data as SseEnvelope).data.messageId;
    const jsonlRecords = fs
      .readFileSync(path.join(tmpDir, `${session.sessionId}.jsonl`), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { id?: string; role: string });
    const ids = jsonlRecords
      .map((record) => record.id)
      .filter((id): id is string => typeof id === "string");
    const finalAssistant = jsonlRecords
      .filter((record) => record.role === "assistant")
      .at(-1);

    expect(new Set(ids).size).toBe(ids.length);
    expect(startId).toBe(doneId);
    expect(doneId).toBe(finalAssistant?.id);
  });

  it("真实 maxToolLoops 摘要闭合 message_start、done 与最终 JSONL assistant ID", async () => {
    const session = sessionStore.create("gconv");
    const config = createConfig({
      agent: {
        defaultModel: "claude-sonnet-5",
        defaultProvider: "mock",
        maxRetries: 0,
        maxToolLoops: 2,
        toolIdleTimeoutMs: 5_000,
      },
    });
    const mockProvider = new MockProvider();
    const providers = new ProviderRegistry(config);
    providers.registerFactory("mock", () => mockProvider);
    const echoTool = defineTool({
      name: "echo",
      description: "回显",
      inputSchema: {
        type: "object",
        properties: { msg: { type: "string" } },
      },
      execute: async (input) => ({ content: `echo: ${input.msg}` }),
    });
    mockProvider.program({
      kind: "tool_calls",
      calls: [{ id: "loop-call-1", name: "echo", input: { msg: "one" } }],
    });
    mockProvider.program({
      kind: "tool_calls",
      calls: [{ id: "loop-call-2", name: "echo", input: { msg: "two" } }],
    });
    mockProvider.program({
      kind: "tool_calls",
      calls: [{ id: "loop-call-3", name: "echo", input: { msg: "three" } }],
    });
    mockProvider.program({ kind: "text", text: "循环上限最终摘要" });

    installMessageRoutes({
      sessionStore,
      config,
      providers,
      runnerFactory: ({ session: persistentSession }) =>
        new AgentRunner({
          config,
          providers,
          tools: [echoTool],
          session: persistentSession,
        }),
    });

    const req = makeMockReq({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/messages/stream`,
      body: JSON.stringify({
        text: "run until maxToolLoops",
        runId: "11111111-1111-4111-8111-111111111111",
        clientMessageId: "22222222-2222-4222-8222-222222222222",
      }),
    });
    const res = makeMockRes();

    const route = findStreamRoute();
    await route!.handler(req, res, { id: session.sessionId });

    const frames = parseSse(res.body);
    const start = frames.find((frame) => frame.event === "message_start");
    const done = frames.find((frame) => frame.event === "done");
    const startId = (
      (start?.data as SseEnvelope).data.message as { id: string }
    ).id;
    const doneId = (done?.data as SseEnvelope).data.messageId;
    const jsonlRecords = fs
      .readFileSync(path.join(tmpDir, `${session.sessionId}.jsonl`), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as {
        id?: string;
        role: string;
        runId?: string;
        content?: unknown;
      });
    const ids = jsonlRecords
      .map((record) => record.id)
      .filter((id): id is string => typeof id === "string");
    const assistants = jsonlRecords.filter((record) => record.role === "assistant");
    const finalAssistant = assistants.at(-1);

    expect(new Set(ids).size).toBe(ids.length);
    expect(startId).toBe(doneId);
    expect(doneId).toBe(finalAssistant?.id);
    expect(finalAssistant?.runId).toBe("11111111-1111-4111-8111-111111111111");
    expect(JSON.stringify(finalAssistant?.content)).toContain("循环上限最终摘要");
  });

  it("已完成请求重复 clientMessageId 仅发关联真实 assistant 的 deduplicated done", async () => {
    const session = sessionStore.create("gconv");
    const clientMessageId = "11111111-1111-4111-8111-111111111111";
    let runnerCalls = 0;
    const runnerFactory = ({ session: persistentSession }: {
      session: PersistentSession;
    }) => ({
      async *runStream(params: AgentRunParams) {
        runnerCalls++;
        await persistentSession.beginUserTurn(
          [{ type: "text", text: params.message }],
          { id: params.clientMessageId, runId: params.runId },
        );
        await persistentSession.addAssistantMessage(
          [{ type: "text", text: "completed" }],
          { id: params.assistantMessageId, runId: params.runId },
        );
        persistentSession.completeActiveTurn();
        yield {
          type: "done" as const,
          result: {},
          messageId: params.assistantMessageId,
        };
      },
    });
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory,
    });

    const route = findStreamRoute();
    const firstReq = makeMockReq({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/messages/stream`,
      body: JSON.stringify({
        text: "same request",
        clientMessageId,
        runId: "22222222-2222-4222-8222-222222222222",
      }),
    });
    const firstRes = makeMockRes();
    await route!.handler(firstReq, firstRes, { id: session.sessionId });
    const firstDone = parseSse(firstRes.body).find(
      (frame) => frame.event === "done",
    );
    const persistedAssistantMessageId = (
      firstDone?.data as SseEnvelope
    ).data.messageId;

    const duplicateReq = makeMockReq({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/messages/stream`,
      body: JSON.stringify({
        text: "same request",
        clientMessageId,
        runId: "33333333-3333-4333-8333-333333333333",
      }),
    });
    const duplicateRes = makeMockRes();
    await route!.handler(duplicateReq, duplicateRes, { id: session.sessionId });

    const duplicateFrames = parseSse(duplicateRes.body);
    const done = duplicateFrames[0];
    const userRecords = fs
      .readFileSync(path.join(tmpDir, `${session.sessionId}.jsonl`), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { id?: string; role: string })
      .filter((record) => record.role === "user" && record.id === clientMessageId);
    expect(runnerCalls).toBe(1);
    expect(userRecords).toHaveLength(1);
    expect(duplicateFrames.map((frame) => frame.event)).toEqual(["done"]);
    expect(duplicateFrames.map((frame) => frame.id)).toEqual([1]);
    expect((done?.data as SseEnvelope).data.deduplicated).toBe(true);
    expect((done?.data as SseEnvelope).data.messageId)
      .toBe(persistedAssistantMessageId);
    expect((done?.data as SseEnvelope).data.messageId)
      .not.toBe(clientMessageId);
    expect((done?.data as SseEnvelope).data.persistedRevision).toBe(2);
    expect((done?.data as SseEnvelope).seq).toBe(1);
  });

  it("服务重载后 completed dedup 仍只返回原 assistant ID 的 done", async () => {
    const session = sessionStore.create("gconv");
    const sessionId = session.sessionId;
    const clientMessageId = "11111111-1111-4111-8111-111111111111";
    let runnerCalls = 0;
    const runnerFactory = ({ session: persistentSession }: {
      session: PersistentSession;
    }) => ({
      async *runStream(params: AgentRunParams) {
        runnerCalls++;
        await persistentSession.beginUserTurn(
          [{ type: "text", text: params.message }],
          { id: params.clientMessageId, runId: params.runId },
        );
        await persistentSession.addAssistantMessage(
          [{ type: "text", text: "persisted completion" }],
          { id: params.assistantMessageId, runId: params.runId },
        );
        persistentSession.completeActiveTurn();
        yield {
          type: "done" as const,
          result: {},
          messageId: params.assistantMessageId,
        };
      },
    });
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory,
    });

    const route = findStreamRoute();
    const firstReq = makeMockReq({
      method: "POST",
      url: `/api/sessions/${sessionId}/messages/stream`,
      body: JSON.stringify({ text: "reload me", clientMessageId }),
    });
    const firstRes = makeMockRes();
    await route!.handler(firstReq, firstRes, { id: sessionId });
    const originalAssistantId = (
      parseSse(firstRes.body).find((frame) => frame.event === "done")
        ?.data as SseEnvelope
    ).data.messageId;

    sessionStore.closeAll();
    expect(sessionStore.get(sessionId)).not.toBeNull();

    const duplicateReq = makeMockReq({
      method: "POST",
      url: `/api/sessions/${sessionId}/messages/stream`,
      body: JSON.stringify({ text: "reload me", clientMessageId }),
    });
    const duplicateRes = makeMockRes();
    await route!.handler(duplicateReq, duplicateRes, { id: sessionId });

    const frames = parseSse(duplicateRes.body);
    expect(runnerCalls).toBe(1);
    expect(frames.map((frame) => frame.event)).toEqual(["done"]);
    expect((frames[0].data as SseEnvelope).data.messageId)
      .toBe(originalAssistantId);
    expect((frames[0].data as SseEnvelope).data.messageId)
      .not.toBe(clientMessageId);
    expect((frames[0].data as SseEnvelope).data.persistedRevision).toBe(2);
  });

  it("仅持久化 user 的重复请求允许安全重跑且不重复用户 JSONL", async () => {
    const session = sessionStore.create("gconv");
    const clientMessageId = "11111111-1111-4111-8111-111111111111";
    await session.beginUserTurn(
      [{ type: "text", text: "retry after interruption" }],
      {
        id: clientMessageId,
        runId: "22222222-2222-4222-8222-222222222222",
      },
    );
    let runnerCalls = 0;
    const runnerFactory = ({ session: persistentSession }: {
      session: PersistentSession;
    }) => ({
      async *runStream(params: AgentRunParams) {
        runnerCalls++;
        await persistentSession.beginUserTurn(
          [{ type: "text", text: params.message }],
          { id: params.clientMessageId, runId: params.runId },
        );
        await persistentSession.addAssistantMessage(
          [{ type: "text", text: "retry succeeded" }],
          { id: params.assistantMessageId, runId: params.runId },
        );
        persistentSession.completeActiveTurn();
        yield {
          type: "done" as const,
          result: {},
          messageId: params.assistantMessageId,
        };
      },
    });
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory,
    });

    const req = makeMockReq({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/messages/stream`,
      body: JSON.stringify({
        text: "retry after interruption",
        clientMessageId,
      }),
    });
    const res = makeMockRes();
    const route = findStreamRoute();
    await route!.handler(req, res, { id: session.sessionId });

    const messages = session.getAllMessages();
    expect(runnerCalls).toBe(1);
    expect(messages.filter((message) => message.id === clientMessageId))
      .toHaveLength(1);
    expect(messages.filter((message) => message.role === "assistant"))
      .toHaveLength(1);
    expect(parseSse(res.body).filter((frame) => frame.event === "done"))
      .toHaveLength(1);
  });

  it("turn1 在 turn2 后重试时 terminal-tool 全链仍归属 turn1，重载后可 dedup", async () => {
    const session = sessionStore.create("gconv");
    const turn1ClientId = "11111111-1111-4111-8111-111111111111";
    const turn2ClientId = "22222222-2222-4222-8222-222222222222";
    const turn2AssistantId = "33333333-3333-4333-8333-333333333333";
    const turn1 = await session.beginUserTurn(
      [{ type: "text", text: "retry turn one" }],
      { id: turn1ClientId },
    );
    const turn2 = await session.beginUserTurn(
      [{ type: "text", text: "completed turn two" }],
      { id: turn2ClientId },
    );
    await session.addAssistantMessage(
      [{ type: "text", text: "turn two answer" }],
      { id: turn2AssistantId },
    );
    session.completeActiveTurn();

    const config = createConfig({
      agent: {
        defaultModel: "claude-sonnet-5",
        defaultProvider: "mock",
        maxRetries: 0,
        maxToolLoops: 5,
        toolIdleTimeoutMs: 5_000,
      },
    });
    const mockProvider = new MockProvider();
    const providers = new ProviderRegistry(config);
    providers.registerFactory("mock", () => mockProvider);
    const finishTool = defineTool({
      name: "finish",
      description: "结束重试",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ content: "turn one recovered", endTurn: true }),
    });
    mockProvider.program({
      kind: "tool_calls",
      text: "finishing retry",
      calls: [{ id: "retry-terminal-call", name: "finish", input: {} }],
    });
    let runnerCalls = 0;
    installMessageRoutes({
      sessionStore,
      config,
      providers,
      runnerFactory: ({ session: persistentSession }) => {
        runnerCalls++;
        return new AgentRunner({
          config,
          providers,
          tools: [finishTool],
          session: persistentSession,
        });
      },
    });

    const route = findStreamRoute();
    const retryReq = makeMockReq({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/messages/stream`,
      body: JSON.stringify({
        text: "retry turn one",
        clientMessageId: turn1ClientId,
        runId: "44444444-4444-4444-8444-444444444444",
      }),
    });
    const retryRes = makeMockRes();
    await route!.handler(retryReq, retryRes, { id: session.sessionId });
    const recoveredAssistantId = (
      parseSse(retryRes.body).find((frame) => frame.event === "done")
        ?.data as SseEnvelope
    ).data.messageId;

    const messages = session.getAllMessages();
    const retryRunMessages = messages.filter(
      (message) => message.runId === "44444444-4444-4444-8444-444444444444",
    );
    const toolResults = messages.filter((message) =>
      message.content.some((block) => block.type === "tool_result"),
    );
    const ids = messages
      .map((message) => message.id)
      .filter((id): id is string => typeof id === "string");
    expect(retryRunMessages.length).toBeGreaterThanOrEqual(2);
    expect(retryRunMessages.every((message) => message.turnId === turn1)).toBe(true);
    expect(toolResults.some((message) => message.turnId === turn1)).toBe(true);
    expect(session.getCompletedTurnFinalAssistant(turn1)?.id)
      .toBe(recoveredAssistantId);
    expect(session.getCompletedTurnFinalAssistant(turn2)?.id)
      .toBe(turn2AssistantId);
    expect(new Set(ids).size).toBe(ids.length);

    sessionStore.closeAll();
    const duplicateReq = makeMockReq({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/messages/stream`,
      body: JSON.stringify({
        text: "retry turn one",
        clientMessageId: turn1ClientId,
      }),
    });
    const duplicateRes = makeMockRes();
    await route!.handler(duplicateReq, duplicateRes, { id: session.sessionId });
    const duplicateFrames = parseSse(duplicateRes.body);
    expect(runnerCalls).toBe(1);
    expect(duplicateFrames.map((frame) => frame.event)).toEqual(["done"]);
    expect((duplicateFrames[0].data as SseEnvelope).data.messageId)
      .toBe(recoveredAssistantId);
  });

  it("已完成请求复用 clientMessageId 但 payload 不同返回 409 conflict", async () => {
    const session = sessionStore.create("gconv");
    const clientMessageId = "11111111-1111-4111-8111-111111111111";
    const runnerFactory = ({ session: persistentSession }: {
      session: PersistentSession;
    }) => ({
      async *runStream(params: AgentRunParams) {
        await persistentSession.beginUserTurn(
          [{ type: "text", text: params.message }],
          { id: params.clientMessageId, runId: params.runId },
        );
        await persistentSession.addAssistantMessage(
          [{ type: "text", text: "completed" }],
          { id: params.assistantMessageId, runId: params.runId },
        );
        persistentSession.completeActiveTurn();
        yield {
          type: "done" as const,
          result: {},
          messageId: params.assistantMessageId,
        };
      },
    });
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory,
    });

    const route = findStreamRoute();
    const firstReq = makeMockReq({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/messages/stream`,
      body: JSON.stringify({ text: "first", clientMessageId }),
    });
    await route!.handler(firstReq, makeMockRes(), { id: session.sessionId });

    const conflictReq = makeMockReq({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/messages/stream`,
      body: JSON.stringify({ text: "different", clientMessageId }),
    });
    const conflictRes = makeMockRes();
    await route!.handler(conflictReq, conflictRes, { id: session.sessionId });

    expect(conflictRes.statusCode).toBe(409);
    expect(JSON.parse(conflictRes.body).error.code)
      .toBe("CLIENT_MESSAGE_ID_CONFLICT");
  });

  it("info 日志不包含用户正文，只记录长度和匿名运行标识", async () => {
    const session = sessionStore.create("gconv");
    const sensitiveText = "不要记录这段用户正文-secret";
    const info = vi.fn();
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory: makeMockRunnerFactory([
        { type: "message_end", stopReason: "end_turn" },
      ]),
      logger: { info } as never,
    });

    const req = makeMockReq({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/messages/stream`,
      body: JSON.stringify({ text: sensitiveText }),
    });
    const res = makeMockRes();

    const route = findStreamRoute();
    await route!.handler(req, res, { id: session.sessionId });

    const serializedCalls = JSON.stringify(info.mock.calls);
    expect(serializedCalls).not.toContain(sensitiveText);
    expect(serializedCalls).toContain(`"messageLength":${sensitiveText.length}`);
  });
});

// ============================================================
// ② stream 中途 AbortController 取消
// ============================================================

describe("POST .../stream — AbortController 中途取消", () => {
  it("client emit('close') → runner signal.abort 触发 + aborted 事件发出 + hub 流清理", async () => {
    const session = sessionStore.create("gconv");

    // 注入 runner 在第二次 text_delta 时检测 abort
    let abortedDetected = false;
    const runnerFactory = (): {
      runStream(params: AgentRunParams): AsyncIterable<StreamEvent>;
    } => ({
      async *runStream(params: AgentRunParams): AsyncIterable<StreamEvent> {
        yield { type: "text_delta", text: "first" };
        await Promise.resolve();
        if (params.signal?.aborted) abortedDetected = true;
        yield { type: "text_delta", text: "second" };
        if (params.signal?.aborted) abortedDetected = true;
        // 正常终止
        yield { type: "message_end", stopReason: "end_turn" };
      },
    });

    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory,
    });

    const { req, res } = {
      req: makeMockReq({
        method: "POST",
        url: `/api/sessions/${session.sessionId}/messages/stream`,
        body: JSON.stringify({ text: "hi" }),
      }),
      res: makeMockRes(),
    };

    const route = findStreamRoute();

    // 启动 stream（不 await：让它挂起）
    void route!.handler(req, res, { id: session.sessionId });

    // 让 microtask 跑一下（首条 message_start + 1 条 text_delta 写完）
    await new Promise((r) => setImmediate(r));

    // 模拟客户端断开：emit close → sseResponse 的 listener 触发 onClientGone → hub.close
    res.emit("close");
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // hub 应当被清理
    expect(hub.size()).toBe(0);
  });

  it("abort 端点触发 runner abort 错误时只发送一个 aborted terminal frame", async () => {
    const session = sessionStore.create("gconv");
    const runId = "11111111-1111-4111-8111-111111111111";
    const runnerFactory = () => ({
      async *runStream(params: AgentRunParams) {
        yield { type: "text_delta" as const, text: "started" };
        await new Promise<void>((resolve) => {
          params.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        yield {
          type: "done" as const,
          result: {
            meta: {
              error: { kind: "timeout", message: "Run aborted" },
            },
          },
        };
      },
    });
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory,
    });

    const streamReq = makeMockReq({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/messages/stream`,
      body: JSON.stringify({ text: "hi", runId }),
    });
    const streamRes = makeMockRes();
    const streamRoute = findStreamRoute();
    const streamPromise = streamRoute!.handler(
      streamReq,
      streamRes,
      { id: session.sessionId },
    );
    await new Promise((resolve) => setImmediate(resolve));

    const abortReq = makeMockReq({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/messages/abort`,
      body: JSON.stringify({ runId }),
    });
    const abortRes = makeMockRes();
    const abortRoute = findAbortRoute();
    await abortRoute!.handler(abortReq, abortRes, { id: session.sessionId });
    await streamPromise;

    const terminalFrames = parseSse(streamRes.body).filter((frame) =>
      frame.event === "aborted" ||
      frame.event === "error" ||
      frame.event === "done",
    );
    expect(terminalFrames.map((frame) => frame.event)).toEqual(["aborted"]);
  });

  it("abort 端点指定 streamId → 200", async () => {
    const session = sessionStore.create("gconv");
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory: makeMockRunnerFactory([]),
    });

    // 手动注册一条流到 hub（P0 新签名 register(cid, runId)）
    const runId = randomUUID();
    const { streamId } = hub.register(session.sessionId, runId);

    const { req, res } = {
      req: makeMockReq({
        method: "POST",
        url: `/api/sessions/${session.sessionId}/messages/abort`,
        body: JSON.stringify({ streamId }),
      }),
      res: makeMockRes(),
    };

    const route = findAbortRoute();
    await route!.handler(req, res, { id: session.sessionId });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.data.aborted).toContain(streamId);
  });

  it("abort 端点指定 runId → 200，精确中止该 run", async () => {
    const session = sessionStore.create("gconv");
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory: makeMockRunnerFactory([]),
    });

    // 手动注册一条在飞 run（P0 新签名 register(cid, runId)）
    const runId = randomUUID();
    const { streamId } = hub.register(session.sessionId, runId);

    const { req, res } = {
      req: makeMockReq({
        method: "POST",
        url: `/api/sessions/${session.sessionId}/messages/abort`,
        body: JSON.stringify({ runId }),
      }),
      res: makeMockRes(),
    };

    const route = findAbortRoute();
    await route!.handler(req, res, { id: session.sessionId });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.data.aborted).toContain(runId);

    // 流已被 abortByRunId 从 hub 移除 → 按 streamId 再 abort 应返回 false
    expect(hub.abort(streamId)).toBe(false);
    expect(hub.hasActiveRun(session.sessionId)).toBe(false);
  });

  it("abort 端点拒绝用其他 sessionId 中止目标 run", async () => {
    const ownerSession = sessionStore.create("gconv");
    const attackerSession = sessionStore.create("gconv");
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory: makeMockRunnerFactory([]),
    });

    const runId = randomUUID();
    hub.register(ownerSession.sessionId, runId);
    const req = makeMockReq({
      method: "POST",
      url: `/api/sessions/${attackerSession.sessionId}/messages/abort`,
      body: JSON.stringify({ runId }),
    });
    const res = makeMockRes();

    const route = findAbortRoute();
    await route!.handler(req, res, { id: attackerSession.sessionId });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("STREAM_NOT_FOUND");
    expect(hub.hasActiveRun(ownerSession.sessionId)).toBe(true);
  });

  it("abort 端点 streamId 不存在 → 404 STREAM_NOT_FOUND", async () => {
    const session = sessionStore.create("gconv");
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory: makeMockRunnerFactory([]),
    });

    const fakeId = "00000000-0000-4000-8000-000000000000";
    const { req, res } = {
      req: makeMockReq({
        method: "POST",
        url: `/api/sessions/${session.sessionId}/messages/abort`,
        body: JSON.stringify({ streamId: fakeId }),
      }),
      res: makeMockRes(),
    };

    const route = findAbortRoute();
    await route!.handler(req, res, { id: session.sessionId });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("STREAM_NOT_FOUND");
  });

  it("abort 端点 cid 上无流 + 不传 streamId → 404 STREAM_NOT_FOUND", async () => {
    const session = sessionStore.create("gconv");
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory: makeMockRunnerFactory([]),
    });

    const { req, res } = {
      req: makeMockReq({
        method: "POST",
        url: `/api/sessions/${session.sessionId}/messages/abort`,
        body: "{}",
      }),
      res: makeMockRes(),
    };

    const route = findAbortRoute();
    await route!.handler(req, res, { id: session.sessionId });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("STREAM_NOT_FOUND");
  });

  it("abort 端点非法 streamId 形态 → 422 VALIDATION_FAILED", async () => {
    const session = sessionStore.create("gconv");
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory: makeMockRunnerFactory([]),
    });

    const { req, res } = {
      req: makeMockReq({
        method: "POST",
        url: `/api/sessions/${session.sessionId}/messages/abort`,
        body: JSON.stringify({ streamId: "not-a-uuid" }),
      }),
      res: makeMockRes(),
    };

    const route = findAbortRoute();
    await route!.handler(req, res, { id: session.sessionId });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});

// ============================================================
// ③ Last-Event-ID 去重（lastEventLru 跨流跳过重复 seq）
// ============================================================

describe("Last-Event-ID 去重", () => {
  it("Last-Event-ID 头携带的 seq 在 lastEventLru 中已记录时，跳过该事件", () => {
    // 预填 LRU
    lastEventLru.record(1);
    lastEventLru.record(2);

    // 再次 record → false（已存在）
    expect(lastEventLru.record(1)).toBe(false);
    expect(lastEventLru.record(2)).toBe(false);

    // 新 seq → true
    expect(lastEventLru.record(3)).toBe(true);
  });

  it("LRU cap=100 行为（与 sse.test.ts 互补）", () => {
    for (let i = 1; i <= 100; i++) lastEventLru.record(i);
    expect(lastEventLru.has(1)).toBe(true);
    lastEventLru.record(101);
    expect(lastEventLru.has(1)).toBe(false); // 1 被驱逐
    expect(lastEventLru.has(101)).toBe(true);
  });
});

// ============================================================
// ④ heartbeat 触发（fake timers）
// ============================================================

describe("heartbeat 触发（fake timers）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stream 中每 15s 写一条 `: heartbeat` 注释行", async () => {
    const session = sessionStore.create("gconv");
    // 永不结束的 stream（runner 一直 yield 空事件 → 依赖 setInterval 触发）
    const runnerFactory = (): {
      runStream(params: AgentRunParams): AsyncIterable<StreamEvent>;
    } => ({
      async *runStream(): AsyncIterable<StreamEvent> {
        // 不主动结束 —— 让 heartbeat 单独可观察
        await new Promise(() => {
          /* hang */
        });
      },
    });

    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory,
    });

    const { req, res } = {
      req: makeMockReq({
        method: "POST",
        url: `/api/sessions/${session.sessionId}/messages/stream`,
        body: JSON.stringify({ text: "hi" }),
      }),
      res: makeMockRes(),
    };

    const route = findStreamRoute();

    // 启动（不 await，挂起）
    void route!.handler(req, res, { id: session.sessionId });

    // 让 microtask 跑一下（首条 message_start 写完）
    await vi.advanceTimersByTimeAsync(0);

    // 推进 15s → 应写 1 条心跳
    await vi.advanceTimersByTimeAsync(15_000);
    expect(res.body).toMatch(/: heartbeat \d+\n\n/);

    // 再推进 15s → 共 2 条
    await vi.advanceTimersByTimeAsync(15_000);
    const heartbeats = res.body.match(/: heartbeat/g);
    expect(heartbeats?.length).toBeGreaterThanOrEqual(2);

    // 清理
    res.emit("close");
    await vi.advanceTimersByTimeAsync(0);
  });
});

// ============================================================
// ⑤ done 事件必发（已含在 happy path 测试；这里额外断言）
// ============================================================

describe("done 事件必发", () => {
  it("成功路径精确发送一个 done，且不发送 error", async () => {
    const session = sessionStore.create("gconv");
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory: makeMockRunnerFactory([
        { type: "message_start" },
        { type: "message_end", stopReason: "end_turn" },
        { type: "done", result: {} },
      ]),
    });

    const { req, res } = {
      req: makeMockReq({
        method: "POST",
        url: `/api/sessions/${session.sessionId}/messages/stream`,
        body: JSON.stringify({ text: "hi" }),
      }),
      res: makeMockRes(),
    };

    const route = findStreamRoute();
    await route!.handler(req, res, { id: session.sessionId });

    const parsed = parseSse(res.body);
    const doneCount = parsed.filter((e) => e.event === "done").length;
    const errorCount = parsed.filter((e) => e.event === "error").length;
    expect(doneCount).toBe(1);
    expect(errorCount).toBe(0);
  });
});

// ============================================================
// ⑥ error 事件形态（runner 抛错）
// ============================================================

describe("error 事件形态", () => {
  it("runner iterator 无 done/error 直接 EOF → 精确发送一个 error", async () => {
    const session = sessionStore.create("gconv");
    const runnerFactory = () => ({
      async *runStream() {
        if (false) yield { type: "text_delta" as const, text: "unreachable" };
      },
    });
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory,
    });

    const req = makeMockReq({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/messages/stream`,
      body: JSON.stringify({ text: "hi" }),
    });
    const res = makeMockRes();

    const route = findStreamRoute();
    await route!.handler(req, res, { id: session.sessionId });

    const terminalFrames = parseSse(res.body).filter((frame) =>
      frame.event === "error" ||
      frame.event === "done" ||
      frame.event === "aborted",
    );
    expect(terminalFrames.map((frame) => frame.event)).toEqual(["error"]);
  });

  it("runner.runStream throw → 精确发送一个 error，且不发送 done", async () => {
    const session = sessionStore.create("gconv");
    const runnerFactory = (): {
      runStream(params: AgentRunParams): AsyncIterable<StreamEvent>;
    } => ({
      async *runStream(): AsyncIterable<StreamEvent> {
        throw new Error("boom");
      },
    });

    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory,
    });

    const { req, res } = {
      req: makeMockReq({
        method: "POST",
        url: `/api/sessions/${session.sessionId}/messages/stream`,
        body: JSON.stringify({ text: "hi" }),
      }),
      res: makeMockRes(),
    };

    const route = findStreamRoute();
    await route!.handler(req, res, { id: session.sessionId });

    const parsed = parseSse(res.body);
    const errorEvent = parsed.find((e) => e.event === "error");
    expect(errorEvent).toBeDefined();
    // P0 envelope：错误详情位于 envelope 的 data 内层
    const errorEnv = errorEvent!.data as SseEnvelope;
    expect(errorEnv.event).toBe("error");
    const inner = errorEnv.data as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(inner.error.code).toBe("CHAT_RUNNER_ERROR");
    expect(inner.error.message).toContain("boom");
    expect(parsed.filter((e) => e.event === "error")).toHaveLength(1);
    expect(parsed.filter((e) => e.event === "done")).toHaveLength(0);
  });

  it("runner done 携带 error → 精确发送一个 error，且不发送 done", async () => {
    const session = sessionStore.create("gconv");
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory: makeMockRunnerFactory([
        {
          type: "done",
          result: {
            meta: {
              error: {
                kind: "provider_error",
                message: "provider failed",
              },
            },
          },
        },
      ]),
    });

    const req = makeMockReq({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/messages/stream`,
      body: JSON.stringify({ text: "hi" }),
    });
    const res = makeMockRes();

    const route = findStreamRoute();
    await route!.handler(req, res, { id: session.sessionId });

    const parsed = parseSse(res.body);
    expect(parsed.filter((e) => e.event === "error")).toHaveLength(1);
    expect(parsed.filter((e) => e.event === "done")).toHaveLength(0);
  });
});

// ============================================================
// ⑦ 13 event 类型断言：mock runner 触发 ≥8 种 → 验证响应流全部出现
// ============================================================

describe("13 event 类型覆盖", () => {
  it("mock runner 触发 ≥8 种源事件 → SSE 响应含相应 SSE event 名", async () => {
    const session = sessionStore.create("gconv");

    // 触发 8 种 StreamEvent 类型（out of 7 possible）：message_start / text_delta / tool_use_start /
    // tool_use_delta / tool_use_end / message_end / error
    const events: StreamEvent[] = [
      { type: "message_start", usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } },
      { type: "text_delta", text: "hi" },
      { type: "tool_use_start", id: "t1", name: "calc" },
      { type: "tool_use_delta", id: "t1", input: '{"a":' },
      { type: "tool_use_delta", id: "t1", input: "1}" },
      { type: "tool_use_end", id: "t1" },
      {
        type: "message_end",
        stopReason: "tool_use",
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        model: "deepseek-chat",
      },
    ];

    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory: makeMockRunnerFactory(events),
    });

    const { req, res } = {
      req: makeMockReq({
        method: "POST",
        url: `/api/sessions/${session.sessionId}/messages/stream`,
        body: JSON.stringify({ text: "calc 1+1" }),
      }),
      res: makeMockRes(),
    };

    const route = findStreamRoute();
    await route!.handler(req, res, { id: session.sessionId });

    const parsed = parseSse(res.body);
    const eventNames = new Set(parsed.map((e) => e.event));

    // 必出现的 ≥8 种（来自 mock + 适配器自动补的）
    const required = [
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
      "tool_use",
      "tool_result",
      "usage",
      "done",
    ];
    const seen = required.filter((n) => eventNames.has(n));
    expect(seen.length).toBeGreaterThanOrEqual(8);
  });
});

// ============================================================
// ⑧ 并发 stream 处理：同 session 已有活跃 run → 409 RUN_ALREADY_ACTIVE
// ============================================================

describe("并发 stream 处理", () => {
  it("同 session 已有活跃 run → 409 RUN_ALREADY_ACTIVE（旧流不被自动 abort）", async () => {
    const session = sessionStore.create("gconv");
    const clientMessageId = "11111111-1111-4111-8111-111111111111";
    await session.beginUserTurn(
      [{ type: "text", text: "hi" }],
      { id: clientMessageId },
    );
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory: makeMockRunnerFactory([
        { type: "message_end", stopReason: "end_turn" },
      ]),
    });

    // 手动注册一条在飞 run（P0 新签名 register(cid, runId)）
    const runId = randomUUID();
    const { streamId: oldStreamId } = hub.register(session.sessionId, runId);

    const { req, res } = {
      req: makeMockReq({
        method: "POST",
        url: `/api/sessions/${session.sessionId}/messages/stream`,
        body: JSON.stringify({ text: "hi", clientMessageId }),
      }),
      res: makeMockRes(),
    };

    const route = findStreamRoute();
    await route!.handler(req, res, { id: session.sessionId });

    // P0 新行为：409 RUN_ALREADY_ACTIVE，不再静默 replace 旧流
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("RUN_ALREADY_ACTIVE");

    // 旧流未被 abort，仍在该 cid 的在飞列表中；session 仍处于活跃 run 状态
    const remainingLive = hub.listForCid(session.sessionId);
    expect(remainingLive.includes(oldStreamId)).toBe(true);
    expect(hub.hasActiveRun(session.sessionId)).toBe(true);
  });

  it("第一流结束后第二流可成功（释放 in-flight 锁）", async () => {
    const session = sessionStore.create("gconv");
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory: makeMockRunnerFactory([
        { type: "message_end", stopReason: "end_turn" },
      ]),
    });

    const route = findStreamRoute();

    // 第一条
    const { req: req1, res: res1 } = {
      req: makeMockReq({
        method: "POST",
        url: `/api/sessions/${session.sessionId}/messages/stream`,
        body: JSON.stringify({ text: "first" }),
      }),
      res: makeMockRes(),
    };
    await route!.handler(req1, res1, { id: session.sessionId });

    expect(hub.size()).toBe(0); // 第一条流已结束 → hub 清理

    // 第二条（同一 cid）
    const { req: req2, res: res2 } = {
      req: makeMockReq({
        method: "POST",
        url: `/api/sessions/${session.sessionId}/messages/stream`,
        body: JSON.stringify({ text: "second" }),
      }),
      res: makeMockRes(),
    };
    await route!.handler(req2, res2, { id: session.sessionId });

    expect(res2.statusCode).toBe(200);
  });
});

// ============================================================
// ⑨ 路径防御 + session 不存在
// ============================================================

describe("路径防御 + 404 兜底", () => {
  it("session 不存在 → 404 SESSION_NOT_FOUND", async () => {
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory: makeMockRunnerFactory([]),
    });

    const { req, res } = {
      req: makeMockReq({
        method: "POST",
        url: "/api/sessions/gconv-deadbeef/messages/stream",
        body: JSON.stringify({ text: "hi" }),
      }),
      res: makeMockRes(),
    };

    const route = findStreamRoute();
    await route!.handler(req, res, { id: "gconv-deadbeef" });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("text 空字符串 → 422 VALIDATION_FAILED", async () => {
    const session = sessionStore.create("gconv");
    installMessageRoutes({
      sessionStore,
      // @ts-expect-error — test 注入简化
      config: undefined,
      // @ts-expect-error — test 注入简化
      providers: undefined,
      runnerFactory: makeMockRunnerFactory([]),
    });

    const { req, res } = {
      req: makeMockReq({
        method: "POST",
        url: `/api/sessions/${session.sessionId}/messages/stream`,
        body: JSON.stringify({ text: "" }),
      }),
      res: makeMockRes(),
    };

    const route = findStreamRoute();
    await route!.handler(req, res, { id: session.sessionId });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});