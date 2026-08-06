/**
 * 历史会话渲染（renderSessionHistory）测试。
 *
 * 使用 Session 基类构造消息（无需文件 IO），并额外覆盖 PersistentSession
 * 磁盘恢复场景。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Session } from "../src/agent/session.js";
import { PersistentSession } from "../src/agent/persistent-session.js";
import { renderSessionHistory } from "../src/cli/session-history.js";

// ============================================================
// 构造消息的辅助函数
// ============================================================

async function appendTurn(
  session: Session,
  userText: string,
  assistantText: string,
  opts?: { toolUseBeforeText?: boolean },
): Promise<void> {
  await session.beginUserTurn([{ type: "text", text: userText }]);
  if (opts?.toolUseBeforeText) {
    // assistant 先发工具调用，再发文本
    await session.addAssistantMessage([
      {
        type: "tool_use",
        id: "call_1",
        name: "calculator",
        input: { expression: "1+1" },
      },
    ]);
    await session.addToolResult("call_1", "1+1 = 2");
  }
  await session.addAssistantMessage([{ type: "text", text: assistantText }]);
}

// ============================================================
// 测试
// ============================================================

describe("renderSessionHistory", () => {
  it("空会话返回空串", () => {
    const session = new Session();
    expect(renderSessionHistory(session)).toBe("");
  });

  it("渲染 user → assistant 对话轮次", async () => {
    const session = new Session();
    await appendTurn(session, "你好", "你好！我是 AI 助手。");

    const out = renderSessionHistory(session);
    expect(out).toContain("👤 你好");
    expect(out).toContain("🤖 你好！我是 AI 助手。");
    expect(out).toContain("历史会话");
  });

  it("过滤 tool_use / tool_result / thinking 内部块，只显示文本", async () => {
    const session = new Session();
    await appendTurn(session, "计算一下", "结果是 2。", { toolUseBeforeText: true });

    const out = renderSessionHistory(session);
    expect(out).toContain("👤 计算一下");
    expect(out).toContain("🤖 结果是 2。");
    // 内部块不泄露
    expect(out).not.toContain("tool_use");
    expect(out).not.toContain("calculator");
    expect(out).not.toContain("1+1 = 2");
    expect(out).not.toContain("call_1");
  });

  it("超长文本按 maxTextLength 截断", async () => {
    const session = new Session();
    const long = "x".repeat(500);
    await appendTurn(session, "short", long);

    const out = renderSessionHistory(session, { maxTextLength: 100 });
    expect(out).toContain("…");
    // 截断后长度远小于原文
    const aiLine = out.split("\n").find((l) => l.startsWith("🤖 "))!;
    expect(aiLine.length).toBeLessThan(150);
  });

  it("超过 maxTurns 时只显示最近 N 轮并提示省略", async () => {
    const session = new Session();
    for (let i = 1; i <= 5; i++) {
      await appendTurn(session, `问题${i}`, `回答${i}`);
    }

    const out = renderSessionHistory(session, { maxTurns: 2 });
    expect(out).toContain("共 5 轮");
    expect(out).toContain("问题5");
    expect(out).toContain("问题4");
    expect(out).not.toContain("问题1");
    expect(out).not.toContain("问题2");
  });

  it("多行消息逐行渲染且每行独立前缀", async () => {
    const session = new Session();
    await appendTurn(session, "第一行\n第二行", "回复 A\n回复 B");

    const out = renderSessionHistory(session);
    const lines = out.split("\n");
    expect(lines).toContain("👤 第一行");
    expect(lines).toContain("👤 第二行");
    expect(lines).toContain("🤖 回复 A");
    expect(lines).toContain("🤖 回复 B");
  });
});

describe("renderSessionHistory with PersistentSession（磁盘恢复）", () => {
  let dir: string;

  beforeEach(() => {
    dir = path.join(os.tmpdir(), `my-agent-session-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("从磁盘恢复的会话能渲染历史", async () => {
    const sessionId = "session-history-test-0001";
    const created = new PersistentSession({ sessionId, sessionDir: dir });
    await appendTurn(created, "你好", "你好！有什么可以帮你？");
    await created.close();

    const loaded = PersistentSession.load(sessionId, dir);
    expect(loaded).not.toBeNull();

    const out = renderSessionHistory(loaded!);
    expect(out).toContain("👤 你好");
    expect(out).toContain("🤖 你好！有什么可以帮你？");
  });
});
