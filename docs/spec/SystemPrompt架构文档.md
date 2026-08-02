# Orkas System Prompt 架构文档

## 概述

Orkas 的 system prompt 体系分为四个层次：

1. **模板源文件** — `src/main/prompts/*.md`，面向 LLM 的原始 prompt 模板
2. **加载引擎** — `src/main/prompts/loader.ts`，模板加载与变量替换
3. **组装逻辑** — 各 feature 模块中的 `build*SystemPrompt()` 函数
4. **最终管线** — `model/core-agent/runner.ts`，缓存优化与最终拼接

---

## 一、模板源文件 (`src/main/prompts/`)

所有模板使用 `$variable` / `${variable}` 占位符语法（移植自 Python `string.Template`），运行时由 `loader.ts` 填充。编辑 `.md` 文件无需重启即可生效（基于 mtime 缓存）。

### 1.1 模板文件清单

| 文件 | 用途 | 主要占位符 |
|------|------|-----------|
| `chat_commander.md` | 群聊指挥官 system prompt | `$agents_index`, `$orchestration_state`, `$os`, `$working_dir`, `$shell_hint`, `$local_exec_state`, `$env_summary`, `$output_format_hint` |
| `chat_agent_in_group.md` | 群聊 agent worker system prompt | `$name`, `$agent_id`, `$description`, `$workflow`, `$agent_runtime_guidance`, `$inputs_schema`, `$working_dir`, `$output_format_hint`, `$plan_interaction_hint` |
| `chat_shared_rules.md` | Commander 和 Agent 共享的公共规则（PDF处理、网页搜索、文件输出等） | 无变量（静态规则） |
| `chat_agent_setup.md` | LLM agent 创建/编辑 session prompt | `$name`, `$description`, `$description_zh`, `$description_en`, `$workflow`, `$skills`, `$inputs_json`, `$knowhow_text`, `$standards_text`, `$category`, `$interactive` |
| `chat_agent_setup_cli.md` | CLI agent 创建/编辑 session prompt | `$name`, `$description_zh`, `$description_en`, `$inputs_json`, `$category`, `$interactive` |
| `chat_skill_setup.md` | Skill 创建/编辑 session prompt | `$skill_name`, `$skill_description`, `$skill_description_zh`, `$skill_description_en`, `$skill_dir`, `$skill_files` |
| `chat_cli_agent.md` | CLI agent 运行时的轻量 system prompt | agent 名称、描述、输出协议、项目说明、语言、附件、对话历史、任务正文、运行时日期 |
| `chat_cli_coding_protocol.md` | Coding CLI agent 输出协议 | 项目目录切换表单触发条件 |
| `contexts_extract_image.md` | 知识库图片理解 prompt | 引导模型进行 OCR、图表数据提取、场景描述 |

### 1.2 Prompt 文件规则（来自 CLAUDE.md）

- 不得包含产品/品牌名、真实 OS 路径、项目源码/数据目录字面量、硬编码工具目录
- 运行时易变的 prompt 字段统一放在末尾 `## Runtime injection` 节
- 静态规则放前面，保持 cache 前缀稳定
- 聊天 prompt 应指向平台 creator skills 获取 agent/skill 编写细节
- 残留的共享 prompt 规则应有唯一权威来源，下游 prompt 只保留简短引用

---

## 二、加载引擎

### 2.1 `loader.ts` — PromptManager

文件：[src/main/prompts/loader.ts](../src/main/prompts/loader.ts)

核心类 `PromptManager`，提供：

```typescript
// 全局单例
export const prompts = new PromptManager();

// 加载并渲染模板
prompts.load(template: string, args: TemplateArgs): string

// 检查模板是否存在
prompts.exists(template: string): boolean

// 清空缓存，强制重新读取磁盘
prompts.reload(): void
```

**替换规则**（与 Python `string.Template.safe_substitute` 一致）：

| 模式 | 行为 |
|------|------|
| `$identifier` | 从 args 替换 |
| `${identifier}` | 从 args 替换 |
| `$$` | 字面量 `$` |
| 未知 id | 保留字面量（如 `$foo` 仍为 `$foo`） |

identifier 格式：`[A-Za-z_][A-Za-z0-9_]*`

**缓存机制**：已加载模板按名称缓存，以文件 mtime 为键。磁盘上编辑 `.md` 无需重启即可生效。

### 2.2 `runtime_context.ts` — 运行时上下文

文件：[src/main/prompts/runtime_context.ts](../src/main/prompts/runtime_context.ts)

提供三个工具函数，用于在 system prompt 尾部注入日期和时区：

```typescript
formatCurrentDate(date?: Date): string        // → "2026-08-02"
getRuntimeTimezone(): string                   // → "Asia/Shanghai"
buildRuntimeDatetimeBlock(date?: Date): string // → 完整的 "## Current date" 块
```

---

## 三、System Prompt 组装逻辑

### 3.1 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                     runner.ts::buildRunner()                      │
│  最终组装：按缓存友好顺序拼接各部分                                 │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 稳定前缀（可被 LLM provider 缓存）                            │ │
│  │  [基础 prompt] → [connectors] → [system skills] → [skills]   │ │
│  │  → [agents] → [project context policy] → [project instructions]│ │
│  ├─────────────────────────────────────────────────────────────┤ │
│  │ 易变区域（每轮可能变化）                                       │ │
│  │  [runtime injection] → [memory]                              │ │
│  ├─────────────────────────────────────────────────────────────┤ │
│  │ 真正每轮易变（放在用户消息尾部，不进入 system prompt）          │ │
│  │  [orchestration state] → [volatile date tail] → [project status]│ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 各角色 Prompt 构建函数

#### Commander System Prompt

**位置**：[src/main/features/group_chat/bus.ts](../src/main/features/group_chat/bus.ts) — `buildCommanderSystemPrompt()` (line 2986)

**构建流程**：

```
chat_commander.md  ← $agents_index, $orchestration_state, $os,
  (模板渲染)           $working_dir, $shell_hint, $local_exec_state,
                      $env_summary, $output_format_hint
       │
       ▼
concatSharedRules(main, shared)
       │  chat_shared_rules.md 插入到 ## Runtime injection 之前
       ▼
appendLanguageDirective(result)
       │  语言指令 + 运行时日期时间块
       ▼
  最终 commander system prompt
```

**关键子函数**：

| 函数 | 行号 | 用途 |
|------|------|------|
| `buildAgentsIndexBlock()` | 3096 | 渲染 agents 索引块，包含每个 agent 的 name/source/id/description/标记 |
| `_buildOrchestrationStateBlock()` | — | 渲染 orchestration ledger JSON 状态块 |
| `concatSharedRules()` | 3040 | 将共享规则合并到 `## Runtime injection` 之前 |
| `appendLanguageDirective()` | 3050 | 追加语言指令和运行时日期时间 |
| `buildOutputFormatHint()` | 3242 | 渲染输出格式偏好提示 |
| `buildPlanInteractionHint()` | 3223 | 为 interactive agent 渲染 plan interaction 提示 |

#### Agent Worker System Prompt

**位置**：[src/main/features/group_chat/bus.ts](../src/main/features/group_chat/bus.ts) — `buildAgentInGroupSystemPrompt()` (line 3135)

**构建流程**：

```
chat_agent_in_group.md  ← $name, $agent_id, $description, $workflow,
  (模板渲染)                $agent_runtime_guidance, $inputs_schema,
                           $working_dir, $output_format_hint,
                           $plan_interaction_hint
       │
       ▼
concatSharedRules(main, shared)  →  chat_shared_rules.md
       │
       ▼
appendLanguageDirective(result)   →  语言指令 + 日期时间
       │
       ▼
  最终 agent worker system prompt
```

**关键子函数**：

| 函数 | 行号 | 用途 |
|------|------|------|
| `buildAgentRuntimeGuidance()` | 3182 | 从 agent profile 构建 role/knowhow/standards 指导 |
| `pickAgentRuntimeDescription()` | 3172 | 按语言选择 agent 描述（zh/en/legacy 优先级） |

#### Agent 编辑 Session Prompt

**位置**：[src/main/features/agents.ts](../src/main/features/agents.ts) — `buildAgentSetupPrompt()` (line 2458)

- CLI agent → `chat_agent_setup_cli.md`
- LLM agent → `chat_agent_setup.md`
- 末尾追加语言指令 + 日期时间块

#### Skill 编辑 Session Prompt

**位置**：[src/main/features/skills.ts](../src/main/features/skills.ts) — `buildSkillSetupPrompt()` (line 2854)

- 使用 `chat_skill_setup.md`
- 末尾追加语言指令 + 日期时间块

#### CLI Agent System Prompt

**位置**：[src/main/features/group_chat/bus.ts](../src/main/features/group_chat/bus.ts) (line 4827-4837)

- 渲染 `chat_cli_agent.md` + `chat_cli_coding_protocol.md`
- 注入 agent 名称、描述、输出协议、项目说明、语言、附件、对话、任务

---

## 四、最终管线 — `runner.ts`

文件：[src/main/model/core-agent/runner.ts](../src/main/model/core-agent/runner.ts)

### 4.1 缓存优化拆分函数

在 `buildRunner()` 中，system prompt 被拆分为稳定和易变部分：

```typescript
// 拆分顺序：
const { stable, volatileTail } = splitVolatilePromptTail(params.systemPrompt);
//   → 按 "\n\n---\n\n## Current date\n" 拆分

const { stable: s2, agentsBlock } = splitCommanderAgentsBlock(stable);
//   → 按 "\n\n### Agents list\n\n" 拆分

const { stable: s3, runtimeInjectionBlock } = splitRuntimeInjectionBlock(s2);
//   → 按 "\n\n## Runtime injection" 拆分

const { stable: s4, orchestrationBlock } = splitCommanderOrchestrationBlock(s3);
//   → 按 "\n\n## Orchestration state" 拆分
```

### 4.2 最终组装顺序

缓存友好的拼接顺序（[runner.ts:862-924](src/main/model/core-agent/runner.ts#L862)）：

```
1. [stable base prompt]          ← 去掉 agents/runtime/orchestration/date 后的基础 prompt
2. [connectors block]            ← connector 工具描述
3. [system skills block]         ← 系统内置 skills
4. [skills block]                ← 用户/平台 skills
5. [agents block]                ← agents 索引
6. [project context policy]      ← 项目层的静态冲突解决合约
7. [project instructions]        ← 用户编写的 ORKAS.md 项目说明
8. [runtime injection block]     ← ## Runtime injection 节
9. [memory block]                ← 跨 session 持久化记忆
──────────────────────────────────
  [orchestration state]          → 进入 turnEphemeral（用户消息尾部）
  [volatile date tail]           → 进入 turnEphemeral
  [project status]               → 进入 turnEphemeral
```

### 4.3 `turnEphemeral` 机制

真正每轮易变的内容（orchestration ledger、日期时间、project status）**不进入 system prompt**，而是放在用户消息的尾部（`turnEphemeral`）。这样 system prompt 缓存前缀保持跨轮字节稳定，只有用户消息的历史尾部变化，大幅降低 Anthropic prompt cache 失效的概率。

---

## 五、System Prompt 中注入的辅助模块

### 5.1 项目上下文

**文件**：[src/main/features/projects.ts](../src/main/features/projects.ts)

| 函数 | 用途 |
|------|------|
| `formatProjectContextPolicyForSystemPrompt()` (line 364) | 渲染项目层冲突解决策略块（静态合约，始终注入 project session） |
| `formatProjectInstructionsForSystemPrompt(uid, projectId)` (line 412) | 读取并渲染用户编写的 ORKAS.md 项目说明（低流失配置，位于稳定前缀） |

### 5.2 跨 Session Memory

**文件**：[src/main/features/memory.ts](../src/main/features/memory.ts)

| 函数 | 用途 |
|------|------|
| `formatForSystemPrompt(userId, agentId?, projectId?)` (line 465) | 读取并渲染四类持久记忆：user profile、shared facts、project notes、agent notes |

### 5.3 语言指令

**文件**：[src/main/i18n.ts](../src/main/i18n.ts) — `buildLanguageDirective()` (line 214)

生成语言指令块，注入到 system prompt 中。

### 5.4 Skills 渲染

**文件**：[src/main/model/core-agent/skill-registry.ts](../src/main/model/core-agent/skill-registry.ts) — `renderSkillLines()` (line 278)

渲染 `## Available skills` 块，嵌入 system prompt。

### 5.5 Metacognition

**文件**：[src/main/features/metacognition.ts](../src/main/features/metacognition.ts) — `formatForSystemPrompt()` (line 174)

格式化 metacognition 数据到 system prompt。

---

## 六、相关文件索引

### 模板源文件
- [src/main/prompts/chat_commander.md](../src/main/prompts/chat_commander.md)
- [src/main/prompts/chat_agent_in_group.md](../src/main/prompts/chat_agent_in_group.md)
- [src/main/prompts/chat_shared_rules.md](../src/main/prompts/chat_shared_rules.md)
- [src/main/prompts/chat_agent_setup.md](../src/main/prompts/chat_agent_setup.md)
- [src/main/prompts/chat_agent_setup_cli.md](../src/main/prompts/chat_agent_setup_cli.md)
- [src/main/prompts/chat_skill_setup.md](../src/main/prompts/chat_skill_setup.md)
- [src/main/prompts/chat_cli_agent.md](../src/main/prompts/chat_cli_agent.md)
- [src/main/prompts/chat_cli_coding_protocol.md](../src/main/prompts/chat_cli_coding_protocol.md)
- [src/main/prompts/contexts_extract_image.md](../src/main/prompts/contexts_extract_image.md)

### 基础设施
- [src/main/prompts/loader.ts](../src/main/prompts/loader.ts) — PromptManager 加载引擎
- [src/main/prompts/runtime_context.ts](../src/main/prompts/runtime_context.ts) — 日期/时区运行时注入

### 组装逻辑
- [src/main/features/group_chat/bus.ts](../src/main/features/group_chat/bus.ts) — Commander/Agent/CLI agent prompt 构建
- [src/main/features/agents.ts](../src/main/features/agents.ts) — Agent 编辑 session prompt 构建
- [src/main/features/skills.ts](../src/main/features/skills.ts) — Skill 编辑 session prompt 构建
- [src/main/model/core-agent/runner.ts](../src/main/model/core-agent/runner.ts) — 最终组装管线 + 缓存优化

### 注入辅助
- [src/main/features/projects.ts](../src/main/features/projects.ts) — 项目上下文策略 + 说明
- [src/main/features/memory.ts](../src/main/features/memory.ts) — 跨 session 记忆
- [src/main/features/metacognition.ts](../src/main/features/metacognition.ts) — Metacognition 数据
- [src/main/i18n.ts](../src/main/i18n.ts) — 语言指令
- [src/main/model/core-agent/skill-registry.ts](../src/main/model/core-agent/skill-registry.ts) — Skills 行渲染

---

## 七、快速参考

### 修改静态 Prompt 内容
→ 直接编辑 `src/main/prompts/` 下的 `.md` 文件，无需重启（mtime 热更新）

### 修改 Prompt 组装逻辑
→ 修改 `features/group_chat/bus.ts` 中的 `buildCommanderSystemPrompt()` / `buildAgentInGroupSystemPrompt()`

### 修改 Prompt 最终拼接顺序
→ 修改 `model/core-agent/runner.ts::buildRunner()` 中的 `parts` 数组

### 添加新的运行时注入内容
→ 在 `runner.ts` 的 `parts` 数组中添加新块，注意区分稳定前缀和易变区域

### 添加新的模板文件
→ 在 `src/main/prompts/` 下创建 `.md` 文件，通过 `prompts.load('模板名', args)` 加载
