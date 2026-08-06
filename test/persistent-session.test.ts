/**
 * PersistentSession + SessionStore 测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { PersistentSession } from "../src/agent/persistent-session.js";
import { SessionStore } from "../src/storage/session-store.js";
import { removeFile } from "../src/storage/jsonl.js";

// 使用临时目录隔离测试
function tempDir() {
  const dir = path.join(os.tmpdir(), `my-agent-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("PersistentSession", () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ============================================================
  // 创建和基础属性
  // ============================================================
  it("应该创建新的持久化会话", () => {
    const session = PersistentSession.create(dir);
    expect(session.sessionId).toMatch(/^session-[a-z0-9]{12}$/);
    expect(session.getSessionId()).toBe(session.sessionId);
  });

  it("应该自动生成 session 文件", () => {
    const session = PersistentSession.create(dir);
    const jsonlFile = path.join(dir, `${session.sessionId}.jsonl`);
    const contextFile = path.join(dir, `${session.sessionId}.context.json`);

    expect(fs.existsSync(jsonlFile)).toBe(true);
    expect(fs.existsSync(contextFile)).toBe(true);
  });

  it("应该支持自定义 sessionId", () => {
    const session = new PersistentSession({
      sessionId: "session-my-test-001",
      sessionDir: dir,
    });
    expect(session.sessionId).toBe("session-my-test-001");
  });

  // ============================================================
  // 消息持久化
  // ============================================================
  it("用户消息应该写入 JSONL 文件", async () => {
    const session = PersistentSession.create(dir);
    await session.beginUserTurn([{ type: "text", text: "你好" }]);

    const content = fs.readFileSync(
      path.join(dir, `${session.sessionId}.jsonl`),
      "utf-8",
    );
    expect(content).toContain("你好");
    expect(content).toContain('"role":"user"');
  });

  it("assistant 消息应该写入 JSONL 文件", async () => {
    const session = PersistentSession.create(dir);
    await session.beginUserTurn([{ type: "text", text: "问题" }]);
    await session.addAssistantMessage([{ type: "text", text: "回答" }]);

    const lines = fs
      .readFileSync(path.join(dir, `${session.sessionId}.jsonl`), "utf-8")
      .trim()
      .split("\n");
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("回答");
  });

  it("tool_result 消息应该写入 JSONL 文件", async () => {
    const session = PersistentSession.create(dir);
    await session.beginUserTurn([{ type: "text", text: "计算" }]);
    await session.addAssistantMessage([
      { type: "tool_use", id: "call_1", name: "calculator", input: { expression: "1+1" } },
    ]);
    await session.addToolResult("call_1", "1+1 = 2");

    const lines = fs
      .readFileSync(path.join(dir, `${session.sessionId}.jsonl`), "utf-8")
      .trim()
      .split("\n");
    expect(lines.length).toBe(3);
    expect(lines[2]).toContain("tool_result");
    expect(lines[2]).toContain("call_1");
  });

  // ============================================================
  // 加载和恢复
  // ============================================================
  it("应该从磁盘恢复消息", async () => {
    // 先创建并写入
    const s1 = PersistentSession.create(dir);
    const id = s1.sessionId;
    await s1.beginUserTurn([{ type: "text", text: "第一轮问题" }]);
    await s1.addAssistantMessage([{ type: "text", text: "第一轮回答" }]);
    s1.close();

    // 再加载
    const s2 = PersistentSession.load(id, dir);
    expect(s2).not.toBeNull();
    const messages = s2!.getAllMessages();
    expect(messages.length).toBe(2);
    expect(messages[0].content[0]).toMatchObject({ type: "text", text: "第一轮问题" });
    expect(messages[1].content[0]).toMatchObject({ type: "text", text: "第一轮回答" });
  });

  it("加载不存在的 session 返回 null", () => {
    const s = PersistentSession.load("session-nonexistent", dir);
    expect(s).toBeNull();
  });

  it("应该加载多轮对话", async () => {
    const s1 = PersistentSession.create(dir);
    const id = s1.sessionId;

    // 第 1 轮
    await s1.beginUserTurn([{ type: "text", text: "问题1" }]);
    await s1.addAssistantMessage([{ type: "text", text: "回答1" }]);
    s1.completeActiveTurn();

    // 第 2 轮
    await s1.beginUserTurn([{ type: "text", text: "问题2" }]);
    await s1.addAssistantMessage([{ type: "text", text: "回答2" }]);
    s1.close();

    const s2 = PersistentSession.load(id, dir);
    const msgs = s2!.getAllMessages();
    expect(msgs.length).toBe(4);
    expect(msgs[2].content[0]).toMatchObject({ type: "text", text: "问题2" });
    expect(msgs[3].content[0]).toMatchObject({ type: "text", text: "回答2" });
  });

  // ============================================================
  // 孤儿 tool_use 修复
  // ============================================================
  it("应该修复孤儿 tool_use（用 isError 占位填充）", async () => {
    const session = PersistentSession.create(dir);
    await session.beginUserTurn([{ type: "text", text: "用工具" }]);
    await session.addAssistantMessage([
      { type: "text", text: "好的" },
      { type: "tool_use", id: "orphan_1", name: "calculator", input: { expression: "1+1" } },
    ]);
    // 不添加 tool_result → 孤儿 tool_use
    session.close();

    const loaded = PersistentSession.load(session.sessionId, dir);
    const msgs = loaded!.getAllMessages();

    // 应该有 3 条消息：user + assistant（含 tool_use）+ 合成 tool_result
    const toolResults = msgs.filter((m) =>
      m.content.some((b) => b.type === "tool_result"),
    );
    expect(toolResults.length).toBeGreaterThanOrEqual(1);

    const trContent = toolResults[0].content.find(
      (b) => b.type === "tool_result",
    );
    expect(trContent).toBeDefined();
    if (trContent && trContent.type === "tool_result") {
      expect(trContent.toolUseId).toBe("orphan_1");
      expect(trContent.isError).toBe(true);
      expect(trContent.content).toContain("interrupted");
    }
  });

  // ============================================================
  // 执行计划持久化
  // ============================================================
  it("执行计划应该在 context 文件中持久化", async () => {
    const session = PersistentSession.create(dir);
    await session.beginUserTurn([{ type: "text", text: "做任务" }]);
    session.updateExecutionPlan({
      steps: [
        { step: "步骤1", status: "completed" },
        { step: "步骤2", status: "in_progress" },
      ],
    });

    // 读取 context 文件
    const ctxFile = path.join(dir, `${session.sessionId}.context.json`);
    const ctx = JSON.parse(fs.readFileSync(ctxFile, "utf-8"));
    expect(ctx.executionPlan).toBeDefined();
    expect(ctx.executionPlan.steps.length).toBe(2);
    expect(ctx.executionPlan.steps[0].status).toBe("completed");
  });

  // ============================================================
  // 删除
  // ============================================================
  it("delete 应该删除所有文件", () => {
    const session = PersistentSession.create(dir);
    const id = session.sessionId;
    const jf = path.join(dir, `${id}.jsonl`);
    const cf = path.join(dir, `${id}.context.json`);

    expect(fs.existsSync(jf)).toBe(true);
    expect(fs.existsSync(cf)).toBe(true);

    session.delete();

    expect(fs.existsSync(jf)).toBe(false);
    expect(fs.existsSync(cf)).toBe(false);
  });

  // ============================================================
  // getDisplayName
  // ============================================================
  it("getDisplayName 应返回首条用户消息摘要", async () => {
    const session = PersistentSession.create(dir);
    await session.beginUserTurn([{ type: "text", text: "帮我分析一下这个项目的架构设计" }]);

    const name = session.getDisplayName();
    expect(name).toContain("帮我分析一下这个项目");
  });

  it("无消息时 getDisplayName 返回 sessionId", () => {
    const session = PersistentSession.create(dir);
    expect(session.getDisplayName()).toBe(session.sessionId);
  });
});

// ============================================================
// SessionStore
// ============================================================
describe("SessionStore", () => {
  let dir: string;
  let store: SessionStore;

  beforeEach(() => {
    dir = tempDir();
    store = new SessionStore(dir);
  });

  afterEach(() => {
    store.closeAll();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("create 应该返回新的 PersistentSession", () => {
    const session = store.create();
    expect(session).toBeInstanceOf(PersistentSession);
    expect(session.sessionId).toMatch(/^session-/);
  });

  it("get 应该返回缓存的 session", () => {
    const s1 = store.create();
    const s2 = store.get(s1.sessionId);
    expect(s2).toBe(s1); // 同一个引用（缓存命中）
  });

  it("get 应该从磁盘加载未缓存的 session", async () => {
    const s1 = store.create();
    const id = s1.sessionId;
    await s1.beginUserTurn([{ type: "text", text: "测试" }]);
    s1.close();
    store.closeAll(); // 清空缓存

    const s2 = store.get(id);
    expect(s2).not.toBeNull();
    expect(s2!.getSessionId()).toBe(id);
  });

  it("get 不存在的 session 返回 null", () => {
    expect(store.get("session-nonexistent")).toBeNull();
  });

  it("list 应该列出现有 session", () => {
    store.create();
    store.create();
    const sessions = store.list();
    expect(sessions.length).toBe(2);
    expect(sessions[0]).toHaveProperty("id");
    expect(sessions[0]).toHaveProperty("name");
  });

  it("delete 应该删除文件和缓存", async () => {
    const s = store.create();
    const id = s.sessionId;
    await s.beginUserTurn([{ type: "text", text: "x" }]);

    const deleted = store.delete(id);
    expect(deleted).toBe(true);

    // 缓存中不应该再有
    expect(store.get(id)).toBeNull();
  });
});
