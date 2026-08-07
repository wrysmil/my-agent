/**
 * Bash 权限模式
 *
 * 为 bash 工具提供可配置的执行权限控制（CLI 学习项目简化版）。
 *
 * 三模式：
 * - `disabled` — 完全禁止 bash 执行
 * - `workspace_only` — 仅允许工作目录内的命令（默认）
 * - `unrestricted` — 不做路径限制
 *
 * 模式来源：环境变量 TOOL_EXEC_MODE（CLI 项目，环境变量足够，不引入配置文件复杂度）。
 * 每次 execute() 调用时重读，即时生效。
 */

import * as path from "node:path";

// ============================================================
// 类型
// ============================================================

export type LocalExecMode = "disabled" | "workspace_only" | "unrestricted";

// ============================================================
// 常量
// ============================================================

const DENY_MESSAGE =
  "E_TOOL_EXECUTION_ACCESS_DISABLED: Tool execution access is disabled. " +
  'Set TOOL_EXEC_MODE=workspace_only or TOOL_EXEC_MODE=unrestricted to enable.';

const ENV_KEY = "TOOL_EXEC_MODE";

// ============================================================
// 模式解析
// ============================================================

/**
 * 读取当前 Bash 执行模式。
 *
 * 优先级：环境变量 TOOL_EXEC_MODE > 默认 `workspace_only`
 */
export function getLocalExecMode(): LocalExecMode {
  const raw = process.env[ENV_KEY];
  if (!raw) return "workspace_only";
  const v = raw.toLowerCase().trim();
  if (v === "disabled") return "disabled";
  if (v === "unrestricted") return "unrestricted";
  // 其他非法值 → 回退默认
  return "workspace_only";
}

// ============================================================
// 门控
// ============================================================

export interface BashPermissionResult {
  allowed: boolean;
  reason?: string;
}

/**
 * 检查 bash 命令是否允许在当前上下文中执行。
 *
 * @param cwd — 命令执行的工作目录（绝对路径）
 * @param workingDir — Agent 工作目录（绝对路径），workspace_only 模式下的允许根
 * @returns 门控结果
 */
export function isBashAllowed(
  cwd: string,
  workingDir?: string,
): BashPermissionResult {
  const mode = getLocalExecMode();

  if (mode === "disabled") {
    return { allowed: false, reason: DENY_MESSAGE };
  }

  if (mode === "unrestricted") {
    return { allowed: true };
  }

  // workspace_only：cwd 必须在 workingDir 内
  if (!workingDir) {
    return { allowed: true };
  }

  const normalizedCwd = path.resolve(cwd);
  const normalizedWd = path.resolve(workingDir);

  // Windows 兼容：比较时处理大小写
  const cwdLower = normalizedCwd.toLowerCase();
  const wdLower = normalizedWd.toLowerCase();

  if (cwdLower === wdLower) return { allowed: true };
  if (cwdLower.startsWith(wdLower + path.sep.toLowerCase())) return { allowed: true };

  return {
    allowed: false,
    reason:
      `E_PATH_OUT_OF_SCOPE: bash cwd "${cwd}" is outside workspace "${workingDir}". ` +
      `Set TOOL_EXEC_MODE=unrestricted to allow.`,
  };
}

// ============================================================
// 显示辅助
// ============================================================

/** 人类可读的模式描述 */
export function describeMode(mode: LocalExecMode): string {
  switch (mode) {
    case "disabled":
      return "disabled (bash 已禁用)";
    case "workspace_only":
      return "workspace_only (仅工作区)";
    case "unrestricted":
      return "unrestricted (无限制)";
  }
}

/** 获取当前模式的环境变量设置方法提示 */
export function modeSetupHint(mode: LocalExecMode): string {
  switch (mode) {
    case "disabled":
      return '设置环境变量 TOOL_EXEC_MODE=workspace_only 或 unrestricted 以启用 bash';
    case "workspace_only":
      return '设置环境变量 TOOL_EXEC_MODE=unrestricted 以解除工作区限制';
    case "unrestricted":
      return '设置环境变量 TOOL_EXEC_MODE=disabled 以禁用 bash';
  }
}
