/**
 * System Prompt 组装器。
 *
 * 负责将模板、技能索引、项目上下文、运行时注入等各部分按缓存友好的顺序
 * 组装为最终的 system prompt。
 *
 * **架构（参考 Orkas System Prompt 架构文档）：**
 *
 * ```
 * ┌──────────────────────────────────────────────────────┐
 * │ 稳定前缀（可被 LLM provider 缓存）                      │
 * │  [base agent] → [shared rules] → [skills]             │
 * │  → [project context] → [project instructions]          │
 * ├──────────────────────────────────────────────────────┤
 * │ 易变区域（每轮可能变化）                                │
 * │  [runtime injection]                                  │
 * ├──────────────────────────────────────────────────────┤
 * │ 真正每轮易变（放在用户消息尾部，不进入 system prompt）     │
 * │  [volatile date tail]                                  │
 * └──────────────────────────────────────────────────────┘
 * ```
 *
 * **缓存优化策略：**
 * - `splitStableFromVolatile()` — 按 `## Runtime injection` 拆分稳定/易变部分
 * - `turnEphemeral` — 日期等每轮变化的内容放在用户消息尾部，保持 system prompt
 *   前缀跨轮字节稳定，最大化 Anthropic/OpenAI prompt cache 命中率
 */

import * as os from "node:os";
import { prompts } from "./loader.js";
import { buildRuntimeDatetimeBlock } from "./runtime-context.js";

// ============================================================
// 常量
// ============================================================

/** System prompt 中稳定区域与易变区域的分隔标记 */
const RUNTIME_INJECTION_MARKER = "\n## 运行时注入";

/** 用于拆分 volatile tail 的分隔标记 */
const CURRENT_DATE_MARKER = "\n\n## Current date\n";

// ============================================================
// 类型
// ============================================================

/**
 * System prompt 构建的输入参数。
 *
 * 所有字段均为可选，未提供的部分使用合理的默认值或留空。
 */
export type SystemPromptBuildParams = {
  /**
   * Agent 名称。
   * 注入到 prompt 中帮助模型理解自身角色。
   */
  name?: string;

  /**
   * 语言指令。
   * 如 "Always respond in Chinese."。
   * 不传则默认使用中文。
   */
  languageDirective?: string;

  /**
   * 技能索引块。
   * 由 skill-loader 渲染的技能列表，格式如：
   * ```
   * ## Available skills
   * - skill-name: description
   * ```
   */
  skillsIndex?: string;

  /**
   * 项目上下文。
   * 项目层冲突解决策略、ORKAS.md 项目说明等。
   */
  projectContext?: string;

  /**
   * 工具执行的工作目录。
   * 注入到 Runtime injection 块中。
   */
  workingDir?: string;

  /**
   * 额外的系统级指令（追加到稳定区域末尾）。
   * 来自 CoreAgentConfig.agent.systemPrompt 的自定义 prompt。
   */
  extraSystemPrompt?: string;

  /**
   * 宿主元数据（OS、Shell 等运行时信息）。
   */
  host?: {
    /** 操作系统标识，如 `"darwin"`、`"linux"` */
    platform?: string;
    /** Shell 类型提示，如 `"zsh"`、`"bash"` */
    shell?: string;
  };
};

/**
 * System prompt 组装结果。
 *
 * 分为三个部分：
 * - `stable`: 稳定前缀，可被 provider 缓存
 * - `volatile`: 易变区域（Runtime injection）
 * - `turnEphemeral`: 每轮变化的内容，放在用户消息尾部
 */
export type SystemPromptAssembly = {
  /** 完整的 system prompt（stable + volatile） */
  systemPrompt: string;

  /** 稳定前缀（base + skills + project） */
  stable: string;

  /** 易变尾部（Runtime injection） */
  volatile: string;

  /** 每轮临时注入（日期等，放在用户消息尾部） */
  turnEphemeral: string;
};

// ============================================================
// 环境信息采集
// ============================================================

/**
 * 采集宿主 OS 信息。
 */
function collectOsInfo(): string {
  const platform = os.platform();
  const arch = os.arch();
  const release = os.release();
  const map: Record<string, string> = {
    darwin: "macOS",
    linux: "Linux",
    win32: "Windows",
  };
  const name = map[platform] || platform;
  return `${name} (${arch}, ${release})`;
}

/**
 * 采集 Shell 提示信息。
 */
function collectShellHint(): string {
  const shell = process.env.SHELL || process.env.COMSPEC || "";
  if (!shell) return "";
  const basename = shell.split("/").pop() || shell;
  return `Shell: ${basename}`;
}

// ============================================================
// splitVolatilePromptTail — 缓存优化拆分
// ============================================================

/**
 * 按 `## Runtime injection` 标记将 system prompt 拆分为稳定区域和易变尾部。
 *
 * **用途：** provider 可以对稳定前缀开启 prompt cache，
 * 仅易变尾部和 user message 被视为"变化"而绕过缓存。
 *
 * @param prompt — 完整的 system prompt
 * @returns `{ stable, volatileTail }`，无标记时 volatileTail 为空
 */
export function splitVolatilePromptTail(prompt: string): {
  stable: string;
  volatileTail: string;
} {
  const idx = prompt.indexOf(RUNTIME_INJECTION_MARKER);
  if (idx === -1) return { stable: prompt, volatileTail: "" };
  return {
    stable: prompt.slice(0, idx),
    volatileTail: prompt.slice(idx),
  };
}

/**
 * 按 `## Current date` 标记拆分出易变的时间尾部。
 *
 * 此部分通常放在 `turnEphemeral` 中而非 system prompt 中，
 * 以保持 system prompt 前缀的跨轮字节稳定。
 *
 * @param prompt — system prompt 或 volatile tail
 * @returns `{ stable, volatileTail }`
 */
export function splitVolatileDateTail(prompt: string): {
  stable: string;
  volatileTail: string;
} {
  const idx = prompt.indexOf(CURRENT_DATE_MARKER);
  if (idx === -1) return { stable: prompt, volatileTail: "" };
  return {
    stable: prompt.slice(0, idx),
    volatileTail: prompt.slice(idx),
  };
}

// ============================================================
// buildSystemPrompt — 主组装函数
// ============================================================

/**
 * 组装完整的 system prompt。
 *
 * 按缓存友好顺序拼接各部分：
 * 1. 基础 agent prompt（模板渲染）
 * 2. 共享规则（shared-rules 模板）
 * 3. 技能索引
 * 4. 项目上下文
 * 5. 额外系统指令（来自配置）
 * 6. 运行时注入（OS、工作目录等）— 易变区域
 *
 * 日期/时区信息**不**进入 system prompt，而是放入 `turnEphemeral`
 * 供调用方注入到用户消息尾部。
 *
 * @param params — 构建参数，详见 {@link SystemPromptBuildParams}
 * @returns 组装结果，包含 stable、volatile、turnEphemeral 三个部分
 *
 * @example
 * ```ts
 * const { systemPrompt, turnEphemeral } = buildSystemPrompt({
 *   name: "coder",
 *   languageDirective: "Always respond in Chinese.",
 *   skillsIndex: "## Available skills\n- bash: Run shell commands",
 *   workingDir: "/home/user/project",
 * });
 *
 * // systemPrompt → 发送给 LLM provider
 * // turnEphemeral → 注入到用户消息尾部
 * ```
 */
export function buildSystemPrompt(
  params: SystemPromptBuildParams = {},
): SystemPromptAssembly {
  const languageDirective =
    params.languageDirective ||
    "Always respond in Chinese. Use Chinese for all explanations, " +
      "comments, and communications with the user.";

  const osInfo = params.host?.platform || collectOsInfo();
  const shellHint = params.host?.shell
    ? `Shell: ${params.host.shell}`
    : collectShellHint();
  const workingDir = params.workingDir || process.cwd();

  // ---- 1. 基础 agent prompt ----
  const basePrompt = prompts.load("base-agent", {
    name: params.name || "AI Assistant",
    language_directive: languageDirective,
    skills_index: params.skillsIndex || "(No additional skills loaded)",
    project_context: params.projectContext ||
      "(No project context available)",
    os: osInfo,
    working_dir: workingDir,
    shell_hint: shellHint,
  });

  // ---- 2. 共享规则 ----
  const sharedRules = prompts.load("shared-rules");

  // ---- 3. 组装稳定前缀 ----
  const stableParts: string[] = [basePrompt];

  // 共享规则插入到 Runtime injection 之前
  if (sharedRules) {
    const runtimeIdx = stableParts[0].indexOf(RUNTIME_INJECTION_MARKER);
    if (runtimeIdx !== -1) {
      const before = stableParts[0].slice(0, runtimeIdx);
      const after = stableParts[0].slice(runtimeIdx);
      stableParts[0] = before + "\n\n" + sharedRules + after;
    } else {
      stableParts.push(sharedRules);
    }
  }

  // 项目上下文（如果未在模板中替换则追加）
  if (params.projectContext && !basePrompt.includes(params.projectContext)) {
    // 已在模板中替换，跳过
  }

  // 额外的系统指令（来自配置）
  if (params.extraSystemPrompt) {
    stableParts.push(params.extraSystemPrompt);
  }

  const fullPrompt = stableParts.join("\n\n");

  // ---- 4. 拆分稳定/易变区域 ----
  const { stable, volatileTail } = splitVolatilePromptTail(fullPrompt);

  // ---- 5. 生成 turnEphemeral（日期/时区） ----
  // 放在用户消息尾部，不进入 system prompt，保持缓存前缀稳定
  const datetimeBlock = buildRuntimeDatetimeBlock();
  const turnEphemeral = datetimeBlock;

  return {
    systemPrompt: fullPrompt,
    stable,
    volatile: volatileTail,
    turnEphemeral,
  };
}

// ============================================================
// buildDefaultSystemPrompt — 简化的默认 prompt（fallback）
// ============================================================

/**
 * 构建最简默认 system prompt。
 *
 * 当模板文件不可用或不需要完整模板时的 fallback。
 * 不依赖文件 I/O，可直接在内存中完成。
 *
 * @param languageDirective — 语言指令，默认中文
 * @returns 简化的 system prompt
 */
export function buildDefaultSystemPrompt(
  languageDirective?: string,
): string {
  const lang =
    languageDirective ||
    "Always respond in Chinese. Use Chinese for all explanations, " +
      "comments, and communications with the user.";

  const osInfo = collectOsInfo();
  const shellHint = collectShellHint();

  return [
    "You are a helpful AI assistant with access to tools.",
    "Use tools when needed to accomplish tasks.",
    "Be concise and accurate in your responses.",
    "",
    "## Doing the task well",
    "- Finish it in one turn. Produce complete deliverables; never abbreviate.",
    "- Correctness first. Handle edge cases, prefer correct approaches.",
    "- Report outcomes faithfully. Never claim success when it's not.",
    "- Match the blast radius. Confirm before destructive actions.",
    "- Do what was asked — no less, no more.",
    "- Lead with the result. Put the conclusion first.",
    "",
    "## Language",
    lang,
    "",
    "## 运行时注入",
    "",
    `### 环境`,
    `- 操作系统: ${osInfo}`,
    `- Shell: ${shellHint || "unknown"}`,
    `- 工作目录: \`${process.cwd()}\``,
  ].join("\n");
}
