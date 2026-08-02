/**
 * prompts 模块 — System Prompt 模板加载与组装。
 *
 * **架构（参考 Orkas System Prompt 架构文档）：**
 *
 * 1. **模板源文件** — `src/prompts/templates/*.md`，面向 LLM 的原始 prompt 模板
 * 2. **加载引擎** — `loader.ts`，模板加载与变量替换
 * 3. **组装逻辑** — `system-prompt-builder.ts`，缓存友好的最终拼接
 * 4. **运行时注入** — `runtime-context.ts`，日期/时区注入
 *
 * **缓存优化策略：**
 * - 稳定前缀（base agent + shared rules + skills + project）→ 可被 provider 缓存
 * - 易变区域（Runtime injection）→ 每轮可能变化
 * - turnEphemeral（日期/时区）→ 放在用户消息尾部，不进入 system prompt
 *
 * @module prompts
 */

export { PromptManager, prompts, safeSubstitute } from "./loader.js";
export type { TemplateArgs } from "./loader.js";

export {
  formatCurrentDate,
  getRuntimeTimezone,
  buildRuntimeDatetimeBlock,
} from "./runtime-context.js";

export {
  buildSystemPrompt,
  buildDefaultSystemPrompt,
  splitVolatilePromptTail,
  splitVolatileDateTail,
} from "./system-prompt-builder.js";
export type {
  SystemPromptBuildParams,
  SystemPromptAssembly,
} from "./system-prompt-builder.js";
