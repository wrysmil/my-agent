import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
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
  userSkillsDir,
  userMarketplaceSkillsDir,
  userSystemSkillsDir,
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

  describe("userSkillsDir", () => {
    it("返回 dataRoot 下的 skills 目录", () => {
      process.env.MY_AGENT_HOME = "/custom/path";
      expect(userSkillsDir()).toBe(path.join("/custom/path", "skills"));
    });
  });

  describe("userMarketplaceSkillsDir", () => {
    it("返回 dataRoot 下的 marketplace/skills 目录", () => {
      process.env.MY_AGENT_HOME = "/custom/path";
      expect(userMarketplaceSkillsDir()).toBe(
        path.join("/custom/path", "marketplace", "skills"),
      );
    });
  });

  describe("userSystemSkillsDir", () => {
    it("返回 dataRoot 下的 system/skills 目录", () => {
      process.env.MY_AGENT_HOME = "/custom/path";
      expect(userSystemSkillsDir()).toBe(path.join("/custom/path", "system", "skills"));
    });
  });

  describe("skill 目录路径随 MY_AGENT_HOME 切换", () => {
    it("切换 MY_AGENT_HOME 并 reset 后，路径跟随新值", () => {
      process.env.MY_AGENT_HOME = "/first/home";
      const firstSkills = userSkillsDir();
      const firstMarketplace = userMarketplaceSkillsDir();

      process.env.MY_AGENT_HOME = "/second/home";
      _resetDataRoot();

      expect(userSkillsDir()).toBe(path.join("/second/home", "skills"));
      expect(userMarketplaceSkillsDir()).toBe(
        path.join("/second/home", "marketplace", "skills"),
      );
      expect(userSystemSkillsDir()).toBe(path.join("/second/home", "system", "skills"));
      expect(userSkillsDir()).not.toBe(firstSkills);
      expect(userMarketplaceSkillsDir()).not.toBe(firstMarketplace);
    });
  });

  describe("ensureDataLayout", () => {
    it("创建 skills 与 marketplace/skills 目录，不建 system/skills", () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-layout-"));
      process.env.MY_AGENT_HOME = home;
      try {
        ensureDataLayout();
        for (const rel of ["skills", path.join("marketplace", "skills")]) {
          const dir = path.join(home, rel);
          expect(fs.existsSync(dir)).toBe(true);
          expect(fs.statSync(dir).isDirectory()).toBe(true);
        }
        expect(fs.existsSync(path.join(home, "system", "skills"))).toBe(false);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
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
