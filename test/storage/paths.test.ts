import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import {
  dataRoot,
  sessionsDir,
  sessionFile,
  contextFile,
  providersFile,
  configFile,
  assertPathSegment,
  ensureDataLayout,
  _resetDataRoot,
} from "../../src/storage/paths.js";

describe("paths", () => {
  const originalHome = process.env.MY_AGENT_HOME;

  beforeEach(() => {
    // 清空 dataRoot() 惰性缓存，防止用例间相互污染
    _resetDataRoot();
  });

  afterEach(() => {
    if (originalHome) process.env.MY_AGENT_HOME = originalHome;
    else delete process.env.MY_AGENT_HOME;
    _resetDataRoot();
  });

  describe("dataRoot", () => {
    it("默认返回 ~/.my-agent", () => {
      delete process.env.MY_AGENT_HOME;
      expect(dataRoot()).toBe(path.join(os.homedir(), ".my-agent"));
    });

    it("MY_AGENT_HOME 环境变量优先", () => {
      process.env.MY_AGENT_HOME = "/custom/path";
      expect(dataRoot()).toBe("/custom/path");
    });
  });

  describe("sessionFile", () => {
    it("返回 sessions/<id>.jsonl 路径", () => {
      const p = sessionFile("gconv-abc123");
      expect(p).toContain("sessions");
      expect(p).toContain("gconv-abc123.jsonl");
    });
  });

  describe("contextFile", () => {
    it("返回 sessions/<id>.context.json", () => {
      const p = contextFile("gconv-abc123");
      expect(p).toContain("gconv-abc123.context.json");
    });
  });

  describe("assertPathSegment", () => {
    it("合法段原样返回", () => {
      expect(assertPathSegment("gconv-abc123", "sessionId")).toBe("gconv-abc123");
    });

    it("含 .. 抛出", () => {
      expect(() => assertPathSegment("gconv-../etc", "sessionId")).toThrow("path");
    });

    it("含 \\ 抛出", () => {
      expect(() => assertPathSegment("gconv-\\windows", "sessionId")).toThrow("path");
    });

    it("含空字节抛出", () => {
      expect(() => assertPathSegment("gconv-\0bad", "sessionId")).toThrow("path");
    });

    it("空字符串抛出", () => {
      expect(() => assertPathSegment("", "sessionId")).toThrow("path");
    });
  });
});
