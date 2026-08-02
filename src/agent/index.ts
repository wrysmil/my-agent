/**
 * Agent 模块 — Agent 运行时的核心实现。
 *
 * 本模块提供：
 * - **AgentRunner** — 主入口，编排 LLM 调用 → 工具执行 → 结果返回的完整生命周期
 * - **Session** — 会话状态管理器，维护对话历史、执行计划和已完成工作账本
 * - **类型定义** — AgentRunParams、AgentRunResult、AgentRunEvent 等核心类型
 * - **导出的阈值常量** — 死循环检测、收敛控制等可调参数
 *
 * ## 快速开始
 *
 * ```ts
 * import { AgentRunner, Session } from "./agent/index.js";
 *
 * const runner = new AgentRunner({ config, providers, tools, session });
 *
 * // 流式模式
 * for await (const ev of runner.runStream({ message: "帮我重构 src/utils" })) {
 *   if (ev.type === "text_delta") process.stdout.write(ev.text);
 *   if (ev.type === "done") console.log("完成:", ev.result.meta);
 * }
 *
 * // 阻塞模式
 * const result = await runner.run({ message: "分析依赖关系" });
 * ```
 *
 * ## 模块结构
 *
 * | 文件 | 职责 |
 * |------|------|
 * | `types.ts` | 参数、结果、事件等核心类型 |
 * | `runner.ts` | AgentRunner 类 + 常量和辅助函数 |
 * | `session.ts` | Session 类 + 执行计划和账本类型 |
 * | `index.ts` | 统一导出（本文件） |
 *
 * @module agent
 */

// ---- runner.ts 导出 ----

/** AgentRunner 类 — 编排一次 agent run 的完整生命周期 */
export { AgentRunner } from "./runner.js";

/** 完全重复工具调用警告阈值（3 次） */
export { LOOP_WARN } from "./runner.js";

/** 完全重复工具调用强制终止阈值（5 次） */
export { LOOP_HARD } from "./runner.js";

/** 近重复工具调用警告阈值（6 次） */
export { NEAR_DUP_LOOP_WARN } from "./runner.js";

/** 工具循环软上限比率（0.8） */
export { RUN_CONVERGENCE_SOFT_RATIO } from "./runner.js";

/** 旋转收敛触发的最小压缩次数（2 次） */
export { SPIN_CONVERGENCE_MIN_COMPACTIONS } from "./runner.js";

/** 旋转收敛的工具循环比率（0.75） */
export { SPIN_CONVERGENCE_TOOL_LOOP_RATIO } from "./runner.js";

/** 上下文压缩专用 system prompt */
export { CONTEXT_COMPACTION_SYSTEM_PROMPT } from "./runner.js";

/** 合并两次 LLM 调用的 token 用量统计 */
export { mergeUsage } from "./runner.js";

/** 生成工具调用的精确签名（用于死循环检测） */
export { toolCallSignature } from "./runner.js";

/** 生成工具调用的归一化签名（排除易变字段，用于近重复检测） */
export { normalizedToolCallSignature } from "./runner.js";

/** 将工具调用列表划分为顺序/并行执行批次 */
export { partitionToolBatches } from "./runner.js";

/** 计算工具循环的"软上限"（开始提醒的轮数） */
export { runConvergenceSoftToolLoopThreshold } from "./runner.js";

/** 判断是否应触发旋转收敛 nudge */
export { shouldNudgeSpinConvergence } from "./runner.js";

/** 根据 maxToolLoops 计算压缩周期的上限 */
export { compactionRunCaps } from "./runner.js";

// ---- session.ts 导出 ----

/** Session 类 — 会话状态管理器 */
export { Session } from "./session.js";

/** 导出类型：执行计划相关 */
export type {
  HistoryResource,
  ExecutionPlanStepStatus,
  ExecutionPlanStep,
  ExecutionPlanState,
  CompletedWorkStatus,
  CompletedWorkInput,
  CompletedWorkEntry,
  HistoryArchiveCandidate,
  ActiveCheckpointCandidate,
} from "./session.js";

// ---- types.ts 导出 ----

/** 启动一次 agent run 的参数 */
export type { AgentRunParams } from "./types.js";

/** 单次 agent run 的结果 */
export type { AgentRunResult } from "./types.js";

/** agent run 的完整元数据 */
export type { AgentRunMeta } from "./types.js";

/** 非重叠墙钟时间桶 */
export type { AgentRunTimings } from "./types.js";

/** agent run 期间流式发出的事件联合类型 */
export type { AgentRunEvent } from "./types.js";

/** 从 types.ts 重新导出的 HistoryResource（别名为 AgentHistoryResource） */
export type { HistoryResource as AgentHistoryResource } from "./types.js";

// ---- persistent-session.ts 导出 ----

/** PersistentSession 类 — 持久化会话 */
export { PersistentSession } from "./persistent-session.js";

/** 序列化类型 */
export type {
  SerializedMessage,
  SerializedTurn,
  SerializedSessionContext,
} from "./session-serde.js";
