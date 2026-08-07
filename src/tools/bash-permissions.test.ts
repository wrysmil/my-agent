/**
 * Bash 权限模式测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getLocalExecMode,
  isBashAllowed,
  describeMode,
  modeSetupHint,
  type LocalExecMode,
} from "./bash-permissions.js";

// ============================================================
// 环境变量辅助
// ============================================================

const ENV_KEY = "TOOL_EXEC_MODE";

function setEnv(value: string | undefined) {
  if (value === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = value;
  }
}

let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env[ENV_KEY];
});

afterEach(() => {
  setEnv(originalEnv);
});

// ============================================================
// getLocalExecMode
// ============================================================

describe("getLocalExecMode", () => {
  it("未设环境变量 → workspace_only（默认）", () => {
    setEnv(undefined);
    expect(getLocalExecMode()).toBe("workspace_only");
  });

  it("TOOL_EXEC_MODE=disabled → disabled", () => {
    setEnv("disabled");
    expect(getLocalExecMode()).toBe("disabled");
  });

  it("TOOL_EXEC_MODE=DISABLED → disabled（大小写不敏感）", () => {
    setEnv("DISABLED");
    expect(getLocalExecMode()).toBe("disabled");
  });

  it("TOOL_EXEC_MODE=workspace_only → workspace_only", () => {
    setEnv("workspace_only");
    expect(getLocalExecMode()).toBe("workspace_only");
  });

  it("TOOL_EXEC_MODE=unrestricted → unrestricted", () => {
    setEnv("unrestricted");
    expect(getLocalExecMode()).toBe("unrestricted");
  });

  it("TOOL_EXEC_MODE=UNRESTRICTED → unrestricted（大小写不敏感）", () => {
    setEnv("UNRESTRICTED");
    expect(getLocalExecMode()).toBe("unrestricted");
  });

  it("TOOL_EXEC_MODE= 前后空格 → 正常工作", () => {
    setEnv("  unrestricted  ");
    expect(getLocalExecMode()).toBe("unrestricted");
  });

  it("TOOL_EXEC_MODE=非法值 → workspace_only（回退默认）", () => {
    setEnv("garbage_value");
    expect(getLocalExecMode()).toBe("workspace_only");
  });

  it("TOOL_EXEC_MODE=空字符串 → workspace_only", () => {
    setEnv("");
    expect(getLocalExecMode()).toBe("workspace_only");
  });
});

// ============================================================
// isBashAllowed
// ============================================================

describe("isBashAllowed", () => {
  it("disabled 模式 → 拒绝", () => {
    setEnv("disabled");
    const r = isBashAllowed("/home/user/project", "/home/user/project");
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("E_TOOL_EXECUTION_ACCESS_DISABLED");
  });

  it("unrestricted 模式 → 放行", () => {
    setEnv("unrestricted");
    const r = isBashAllowed("/tmp", "/home/user/project");
    expect(r.allowed).toBe(true);
  });

  it("workspace_only 模式 → cwd 在 workingDir 内时放行", () => {
    setEnv("workspace_only");
    const r = isBashAllowed("/home/user/project/src", "/home/user/project");
    expect(r.allowed).toBe(true);
  });

  it("workspace_only 模式 → cwd 等于 workingDir 时放行", () => {
    setEnv("workspace_only");
    const r = isBashAllowed("/home/user/project", "/home/user/project");
    expect(r.allowed).toBe(true);
  });

  it("workspace_only 模式 → cwd 在 workingDir 外时拒绝", () => {
    setEnv("workspace_only");
    const r = isBashAllowed("/tmp", "/home/user/project");
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("E_PATH_OUT_OF_SCOPE");
  });

  it("workspace_only 模式 → 无 workingDir 时放行", () => {
    setEnv("workspace_only");
    const r = isBashAllowed("/any/path", undefined);
    expect(r.allowed).toBe(true);
  });

  it("workspace_only 模式 → Windows 路径分隔符兼容（\\）", () => {
    setEnv("workspace_only");
    // 模拟 Windows 风格路径
    const cwd = "D:\\studyspace\\project\\my-agent\\sub";
    const wd = "D:\\studyspace\\project\\my-agent";
    const r = isBashAllowed(cwd, wd);
    expect(r.allowed).toBe(true);
  });

  it("workspace_only 模式 → Windows 大小写不敏感", () => {
    setEnv("workspace_only");
    const r = isBashAllowed(
      "D:\\STUDYSPACE\\project\\my-agent",
      "d:\\studyspace\\project\\my-agent",
    );
    expect(r.allowed).toBe(true);
  });
});

// ============================================================
// describeMode / modeSetupHint
// ============================================================

describe("describeMode", () => {
  it("disabled", () => {
    expect(describeMode("disabled")).toContain("已禁用");
  });
  it("workspace_only", () => {
    expect(describeMode("workspace_only")).toContain("仅工作区");
  });
  it("unrestricted", () => {
    expect(describeMode("unrestricted")).toContain("无限制");
  });
});

describe("modeSetupHint", () => {
  it("返回切换指导", () => {
    for (const mode of ["disabled", "workspace_only", "unrestricted"] as const) {
      const hint = modeSetupHint(mode);
      expect(hint).toBeTruthy();
      expect(hint).toContain("TOOL_EXEC_MODE");
    }
  });
});
