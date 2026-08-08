---
artifact: spec
route: superpowers:brainstorming
skills:
  - brainstorming
  - source-driven-development
skills_evidence:
  - ~/.claude/skills/brainstorming/SKILL.md
  - harness-kit/core/routing.md
source:
  - AGENTS.md
  - harness-kit/core/routing.md
  - harness-kit/project.profile.md
  - harness-kit/context-map.md
  - .ai-runtime-artifacts/specs/2026-08-08-web-frontend-react-rewrite-spec.md
  - .ai-runtime-artifacts/plans/2026-08-08-chat-fix-and-provider-test-plan.md
  - .ai-runtime-artifacts/plans/session-storage-and-skills-port.md
created_at: 2026-08-08
status: draft
approved: false
---

# 6 项问题诊断与修复方案

> 本文为 my-agent Web 前端当前存在的 6 项问题的根因诊断 + 修复方案 spec。
> 问题来源：用户在实际使用中发现的阻塞性缺陷和体验问题。

---

## 1. 问题总览

| # | 问题 | 严重度 | 根因类别 |
|---|------|--------|---------|
| 1 | 聊天会话没法持久化 | **Critical** | 前端未加载历史 / session 恢复链路断裂 |
| 2 | 中文切换没有用，左边还是英文 | **High** | 缺少 i18n 翻译机制 |
| 3 | API Key 为空 | **Critical** | config 加载路径缺失 + 环境变量未配置 |
| 4 | 聊天不回复 | **Critical** | 问题 3 的连锁反应 + 错误提示缺失 |
| 5 | 日志不详细（无用户输入/模型输出） | **Medium** | AgentRunner 缺少日志埋点 |
| 6 | Settings 看不到可配置项 | **Medium** | Settings 页面仅为展示壳 |

---

## 2. 逐项根因诊断

### 2.1 问题 1：聊天会话没法持久化

**现象：** 刷新页面或重启服务后，之前的聊天记录消失。

**根因诊断：**

后端持久化机制**已实现**（`PersistentSession` + `SessionStore`），但在以下环节存在断裂：

| 环节 | 文件 | 问题 |
|------|------|------|
| Session 创建 | [web/src/pages/ChatPage.tsx](web/src/pages/ChatPage.tsx) | 需确认 ChatPage 是否在进入时自动创建/加载 session |
| 历史加载 | [web/src/features/chat/useChatStream.ts:50-78](web/src/features/chat/useChatStream.ts#L50-L78) | `useEffect` 依赖 `sessionId` + `historyLoaded`，但 `historyLoaded` 为组件级 state，切换 session 时可能不触发重新加载 |
| Session 列表 | [web/src/features/sessions/useSessions.ts](web/src/features/sessions/useSessions.ts) | 需确认 session 列表是否正确从 API 获取并渲染 |
| Sidebar 会话列表 | [web/src/components/layout/Sidebar.tsx:25-26](web/src/components/layout/Sidebar.tsx#L25-L26) | `useSessions(false)` 调用，需确认 false 参数含义 |
| 后端 session 扫描 | [src/storage/session-store.ts:171-181](src/storage/session-store.ts#L171-L181) | `list()` 从磁盘扫描 JSONL 文件，功能正确 |
| 后端 session 加载 | [src/storage/session-store.ts:154-166](src/storage/session-store.ts#L154-L166) | `get()` 支持懒加载从磁盘恢复，功能正确 |
| 消息落盘 | [src/agent/runner.ts:1410](src/agent/runner.ts#L1410) | `session.addAssistantMessage()` → PersistentSession 写 JSONL |

**关键发现：** 后端持久化链路完整（创建→写消息→扫描→加载），问题大概率在**前端**侧：
- ChatPage 可能没有在 mount 时调 `POST /api/sessions` 创建 session
- 或者 session 创建后没有正确传递 `sessionId` 给 `useChatStream`
- 或者刷新后 ChatPage 没有从 URL 参数 / localStorage 恢复 sessionId

**需进一步确认的前端文件：**
- [web/src/pages/ChatPage.tsx](web/src/pages/ChatPage.tsx) — session 生命周期管理
- [web/src/features/sessions/useSessions.ts](web/src/features/sessions/useSessions.ts) — session CRUD hooks

---

### 2.2 问题 2：中文切换没有用，左边还是英文

**现象：** 在 Settings 页面切换语言为中文后，左侧 Sidebar 导航项仍显示英文（Dashboard、Chat、Providers 等）。

**根因诊断：**

i18n 基础设施**已存在但未正确集成**。项目中已有：
- [web/src/i18n/zh.json](web/src/i18n/zh.json) — 完整中文翻译字典（nav、chat、providers、sessions、skills、agents、settings、errors 等）
- [web/src/i18n/en.json](web/src/i18n/en.json) — 完整英文翻译字典
- [web/src/lib/i18n.ts](web/src/lib/i18n.ts) — `t(key, params)` 翻译函数 + `setLocale(locale)` 函数

**但存在两个断裂点：**

| 断裂点 | 文件:行号 | 问题 |
|--------|-----------|------|
| Zustand ↔ i18n 脱节 | [useUiStore.ts:31-34](web/src/features/ui/useUiStore.ts#L31-L34) vs [i18n.ts:16](web/src/lib/i18n.ts#L16) | `useUiStore.setLocale()` 只更新 Zustand state + localStorage，**从不调用** `i18n.ts` 的 `setLocale()`。两套系统完全解耦 |
| UI 组件未使用 t() | [Sidebar.tsx:14-21](web/src/components/layout/Sidebar.tsx#L14-L21) | `navItems` 数组的 `label` 字段**硬编码英文**：`'Dashboard'`, `'Chat'`, `'Providers'`, `'Skills'`, `'Agents'`, `'Settings'`；从未调用 `t('nav.chat')` 等翻译键 |
| Sidebar 其他文本 | [Sidebar.tsx:65](web/src/components/layout/Sidebar.tsx#L65) | "Sessions" 标题硬编码 |
| Sidebar 其他文本 | [Sidebar.tsx:81](web/src/components/layout/Sidebar.tsx#L81) | `"暂无会话"` 硬编码中文 |

**断裂链路：**
```
用户切换语言 → setLocale('zh')
  ├─ ✅ Zustand state 更新 → localStorage 保存
  └─ ❌ i18n.ts currentLocale 不变（仍为初始值 'zh'）
       └─ ❌ t() 始终返回初始语言的翻译
            └─ ❌ 即使组件调用了 t()，也不会随语言切换更新
```

**影响范围（所有硬编码英文/中文文本的组件）：**
- [web/src/components/layout/Sidebar.tsx](web/src/components/layout/Sidebar.tsx) — 导航标签 + "Sessions" + "新建会话" + "暂无会话"
- [web/src/components/layout/AppShell.tsx](web/src/components/layout/AppShell.tsx) — 需确认
- [web/src/pages/SettingsPage.tsx](web/src/pages/SettingsPage.tsx) — "设置" / "外观" / "深色模式" 等（部分已硬编码中文）
- [web/src/pages/ChatPage.tsx](web/src/pages/ChatPage.tsx) — 空状态提示等
- [web/src/pages/DashboardPage.tsx](web/src/pages/DashboardPage.tsx) — 仪表盘文本

---

### 2.3 问题 3：API Key 为空

**现象：** Provider 配置中 API Key 显示为空，导致无法调用 LLM。

**根因诊断：**

项目中**已有** `.env` 文件（含 `DEEPSEEK_API_KEY=sk-REDACTED-please-rotate`）和 `config.json`（含 agent/models 配置），但存在以下问题：

**问题 A：config.json 中 Provider 缺少 apiKey 字段**

`config.json` 中 deepseek provider 的配置：
```json
{
  "models": {
    "providers": {
      "deepseek": { "baseUrl": "https://api.deepseek.com/v1" }
      // ⚠️ 没有 "apiKey" 字段 — apiKey 为 undefined
    }
  }
}
```

**问题 B：前端编辑 Provider 时 apiKey 被掩码污染**

[src/web/server/routes/providers.ts:509-515](src/web/server/routes/providers.ts#L509-L515) — `stripEnvKey()` 将 apiKey 掩码为 `"***"`。当用户编辑已有 Provider 时，前端表单会显示 `"***"`。如果用户不手动清空就提交，`"***"` 会被保存为 apiKey。

**问题 C：三级 fallback 的前两级可能同时失效**

Provider apiKey 的三级 fallback 链：
1. Provider store 中配置的 apiKey（Web UI 设置） → 可能被 `"***"` 污染或为空
2. `process.env.DEEPSEEK_API_KEY`（`.env` 文件） → 需确认 dotenv 是否已加载
3. 空字符串 → 认证失败

**关键确认点：** `.env` 文件中的 `DEEPSEEK_API_KEY` 是否被 tsx 自动加载？`bin/my-agent-web.ts` 中没有显式的 `dotenv/config` import。如果 tsx 不自动加载 `.env`，则 `process.env.DEEPSEEK_API_KEY` 在运行时为 `undefined`。

**注意：** [已知 plan](.ai-runtime-artifacts/plans/2026-08-08-chat-fix-and-provider-test-plan.md) 中已诊断此问题（Task 1），但修复尚未合入。

---

### 2.4 问题 4：聊天不回复

**现象：** 发送消息后，AI 无响应（不显示错误，也不显示回复）。

**根因诊断：**

这是问题 3 的直接连锁反应，同时存在错误处理缺陷：

```
用户发送消息
  → POST /api/sessions/:id/messages/stream
    → installMessageRoutes → runnerFactory({ session })
      → AgentRunner.runStream(params)
        → resolveForModel → 找到 provider ✓
        → provider.stream({ model, messages, ... })
          → DeepSeekProvider.stream()
            → fetch("https://api.deepseek.com/...", { headers: { Authorization: `Bearer ` } })
              → ❌ API Key 为空 → HTTP 401 / 403
                → 抛出 AuthError
                  → AgentRunner.runWithProvider 捕获 (runner.ts:1507-1515)
                    → yield { type: "done", result: errorResult(...) }
                      → SSE 适配器: 直接发 done 事件（无 error 事件！）
                        → 前端 useChatStream 收到 done → setStatusSafe('done')
                          → 用户看到：消息发送成功但无回复
```

**关键 Bug：** 在 [src/web/server/routes/messages.ts:249-266](src/web/server/routes/messages.ts#L249-L266)，当 `AgentRunner.runStream` 的第一个事件就是 `done`（带 error）时，SSE 适配循环可能**不产生任何 SSE 事件**：

```ts
// messages.ts:249-266
for await (const ev of runner.runStream(params)) {
  // ...
  await adaptStreamEvent(res, ev, sse, ...);
  if (ev.type === "message_end" || ev.type === "error") break;
}
// ⚠️ 如果第一个事件是 done（非 message_end/error），
//    不会进 adaptStreamEvent，循环直接结束
//    然后走 finally → hub.close → res.end
//    前端收到 HTTP 200 + 空 body（无 SSE 事件）
```

**此外，前端错误处理也不完善：**
- [web/src/features/chat/useChatStream.ts:148-150](web/src/features/chat/useChatStream.ts#L148-L150) — 收到 SSE `error` 事件时仅 `setStatusSafe('error')`，**不显示错误消息给用户**
- 如果 SSE 连接直接关闭（空响应），前端 `parseSseStream` 也会静默结束

---

### 2.5 问题 5：日志不够详细

**现象：** 没有打印用户输入内容和模型输出内容的日志，排查问题困难。

**根因诊断：**

| 位置 | 问题 |
|------|------|
| [src/shared/logger.ts](src/shared/logger.ts) | Logger 仅为基础 console 封装，**无结构化日志**、无请求追踪 |
| [src/agent/runner.ts](src/agent/runner.ts) | `runStream()` / `runWithProvider()` **没有任何 log 调用**：不记录用户消息内容、不记录模型输出、不记录 token 用量详情 |
| [src/web/server/routes/messages.ts](src/web/server/routes/messages.ts) | `postMessageStream` 不记录请求体（用户消息）、不记录响应摘要 |
| [src/web/server/index.ts:154-167](src/web/server/index.ts#L154-L167) | `handleRequest` 不记录请求方法/路径/耗时/状态码（无 access log） |
| [bin/my-agent-web.ts:39](bin/my-agent-web.ts#L39) | `createLogger("web", "info")` — level 为 `info`，`debug` 级别日志完全不可见 |

**当前唯一有日志的地方：**
- `bin/my-agent-web.ts:69` — `logger.info("registered N providers: ...")`
- Provider routes — `ctx.log.info("[providers] created/updated/deleted ...")`
- Server start — `log.info("listening on ...")`

---

### 2.6 问题 6：Settings 看不到可配置项

**现象：** Settings 页面只有「外观」（深色模式 + 语言）和「关于」两个分组，Agent 的大量配置参数不可见。

**根因诊断：**

| 维度 | 现状 | 缺失 |
|------|------|------|
| 后端 config API | **不存在** | 没有 `GET/PUT /api/config` 端点来读写 `CoreAgentConfig` |
| [src/config/schema.ts](src/config/schema.ts) | 定义了完整的 Zod schema | 但没有任何 HTTP 端点暴露这些配置 |
| [web/src/pages/SettingsPage.tsx:78-160](web/src/pages/SettingsPage.tsx#L78-L160) | 仅 4 个 SettingGroup（外观、模型供应商只读、关于） | Agent 参数、Memory 配置、Evolution 配置全部缺失 |
| config 持久化 | `loadConfig()` 只读 JSON 文件 | 无 `saveConfig()` 写回文件的能力 |

**Config Schema 中已定义但 Settings 页面未展示的字段：**

| 分组 | 字段 | 默认值 |
|------|------|--------|
| Agent 运行时 | `defaultModel` | `"claude-opus-4-8"` |
| Agent 运行时 | `defaultProvider` | `"anthropic"` |
| Agent 运行时 | `maxRetries` | `3` |
| Agent 运行时 | `maxToolLoops` | `100` |
| Agent 运行时 | `toolIdleTimeoutMs` | `1,800,000` (30min) |
| Agent 运行时 | `thinkingLevel` | `"off"` |
| Agent 运行时 | `systemPrompt` | optional |
| Memory | `enabled` | `true` |
| Memory | `provider` | `"auto"` |
| Memory | `maxResults` | `10` |
| Memory | `minScore` | `0.3` |
| Evolution | `enabled` | `true` |
| Evolution | `skillsDir` | `"skills"` |
| Evolution | `maxSkills` | `200` |

---

## 3. 修复方案

### 3.1 方案概述

采用**分优先级修复**策略，将 6 个问题按依赖关系和严重程度分为 3 组：

| 优先级 | 问题 | 依赖 |
|--------|------|------|
| **P0 — 阻塞性** | #3 API Key + #4 聊天不回复 | 相互依赖，需一起修 |
| **P1 — 核心体验** | #1 会话持久化 + #2 i18n | 独立 |
| **P2 — 体验增强** | #5 日志 + #6 Settings 配置 | 独立 |

### 3.2 P0：修复 API Key 加载 + 聊天响应

#### 3.2.1 API Key 加载修复

**修改文件：**

1. **[bin/my-agent-web.ts](bin/my-agent-web.ts)** — 确保 `.env` 被加载（增加 `import "dotenv/config"` 或确认 tsx 自动加载），当前 `bin/my-agent-web.ts` 无显式 dotenv import。

2. **[src/config/loader.ts](src/config/loader.ts)** — 增强默认 config 生成（当 config.json 中 provider 缺少 apiKey 时，自动从环境变量 `DEEPSEEK_API_KEY` 读取并注入到 provider 配置中）：
   ```ts
   // loadConfig 中，解析完 JSON 后：
   // 对每个 provider，如果 apiKey 为空，从对应环境变量 fallback
   for (const [id, p] of Object.entries(parsed.models?.providers ?? {})) {
     if (!p.apiKey) {
       const envKey = `${id.toUpperCase()}_API_KEY`;
       p.apiKey = process.env[envKey] || "";
     }
   }
   ```

3. **[src/web/server/routes/providers.ts:398-401](src/web/server/routes/providers.ts#L398-L401)** — 修复 apiKey 掩码污染问题：编辑已有 provider 时，如果 body.apiKey 为 `"***"`（掩码值），保留原值：
   ```ts
   const merged: ProviderConfigEntry = existed && (!body.apiKey || body.apiKey === "***")
     ? { ...body, apiKey: cfg.providers[id]!.apiKey }
     : body;
   ```

4. **[src/storage/providers-store.ts](src/storage/providers-store.ts)** — 确认 `resolveEnvApiKey()` 在 provider apiKey 为空时正确从环境变量 fallback（已验证存在，第134-141行）。

#### 3.2.2 聊天错误响应修复

**修改文件：**

1. **[src/web/server/routes/messages.ts](src/web/server/routes/messages.ts)** — `postMessageStream` 中处理 runner 直接返回 `done`（带 error）的情况：在 SSE 适配循环之前，先检查第一个事件是否为 `done` + error，若是则发送 SSE `error` 事件给前端。

2. **[src/web/server/routes/messages.ts](src/web/server/routes/messages.ts)** — `adaptStreamEvent` 中增加对 `done` 事件类型的处理（当前 switch 中无 `done` case）。

3. **[web/src/features/chat/useChatStream.ts:148-150](web/src/features/chat/useChatStream.ts#L148-L150)** — SSE `error` 事件处理增加用户可见的错误提示：在 messages 中追加一条 error 类型的 assistant 消息，显示具体错误原因。

### 3.3 P1：会话持久化 + i18n

#### 3.3.1 会话持久化修复

**需确认前端代码后确定具体改动，预计涉及：**

1. **[web/src/pages/ChatPage.tsx](web/src/pages/ChatPage.tsx)** — 确保：
   - Mount 时若 URL 无 sessionId → 自动调 `POST /api/sessions` 创建新 session → 更新 URL
   - URL 有 sessionId → 调 `GET /api/sessions/:id/history` 加载历史 → 显示
   - `sessionId` 变化时触发 `useChatStream` 重新加载

2. **[web/src/features/chat/useChatStream.ts](web/src/features/chat/useChatStream.ts)** — 修复历史加载逻辑：
   - `historyLoaded` 应该在 `sessionId` 变化时重置为 `false`
   - 当前实现中 `useEffect` 依赖 `[sessionId, historyLoaded]`，但 `historyLoaded` 初始为 `false`，加载成功后变为 `true`——切换 session 时 `historyLoaded` 仍为 `true`，导致跳过加载

3. **[web/src/components/layout/Sidebar.tsx](web/src/components/layout/Sidebar.tsx)** — 点击已有 session 时导航到 `/chat/:sessionId`。

#### 3.3.2 i18n 中文切换修复

**关键发现：** 项目已有完整的 i18n 基础设施（翻译文件 + t() 函数），问题出在**集成断裂**。修复聚焦于连接现有组件，而非重建。

**方案：连接现有 i18n 基础设施**

现有资源：
- [web/src/i18n/zh.json](web/src/i18n/zh.json) — 完整中文翻译字典 ✅
- [web/src/i18n/en.json](web/src/i18n/en.json) — 完整英文翻译字典 ✅
- [web/src/lib/i18n.ts](web/src/lib/i18n.ts) — `t(key, params)` + `setLocale(locale)` ✅

需要修复的断裂点：

1. **[web/src/features/ui/useUiStore.ts:31-34](web/src/features/ui/useUiStore.ts#L31-L34)** — `setLocale()` 中增加对 `i18n.ts` 的 `setLocale()` 调用：
   ```ts
   // 修改后
   import { setLocale as setI18nLocale } from '@/lib/i18n';
   // ...
   setLocale: (locale) => {
     localStorage.setItem('locale', locale);
     setI18nLocale(locale);  // ← 新增：同步 i18n 模块
     set({ locale });
   },
   ```

2. **新建** `web/src/i18n/useTranslation.ts` — React hook，订阅 Zustand locale 变化以触发重渲染：
   ```ts
   import { useUiStore } from '@/features/ui/useUiStore';
   import { t } from '@/lib/i18n';
   
   export function useTranslation() {
     const locale = useUiStore(s => s.locale);
     return { t: (key: string, params?: Record<string, string>) => t(key, params), locale };
   }
   ```
   关键：通过 `useUiStore(s => s.locale)` 订阅，确保 locale 变化时所有使用 `useTranslation()` 的组件自动重渲染。

3. **修改所有硬编码文本的组件** — 将静态字符串替换为 `t('key')` 调用：
   - [web/src/components/layout/Sidebar.tsx](web/src/components/layout/Sidebar.tsx) — navItems labels → `t('nav.dashboard')`, `t('nav.chat')` 等
   - [web/src/pages/SettingsPage.tsx](web/src/pages/SettingsPage.tsx) — "设置" → `t('settings.title')`, "外观" → `t('settings.appearance')` 等
   - [web/src/pages/DashboardPage.tsx](web/src/pages/DashboardPage.tsx) — 页面标题和内容
   - [web/src/pages/ChatPage.tsx](web/src/pages/ChatPage.tsx) — 空状态提示
   - 其他有静态文本的页面

### 3.4 P2：日志增强 + Settings 扩展

#### 3.4.1 日志增强

1. **[src/shared/logger.ts](src/shared/logger.ts)** — 扩展 Logger 接口：
   - 支持子 logger（`child(subsystem: string)`）
   - 支持结构化数据（`info(msg, data?)`）
   - 支持请求 ID 追踪

2. **[src/web/server/index.ts](src/web/server/index.ts)** — 添加 access log：
   ```ts
   // handleRequest 末尾
   log.info(`${method} ${pathname} → ${res.statusCode} (${Date.now() - start}ms)`, {
     requestId, method, pathname, status: res.statusCode, durationMs: Date.now() - start
   });
   ```

3. **[src/agent/runner.ts](src/agent/runner.ts)** — 添加关键节点日志：
   - `runStream` 开始时：log 用户消息内容（截断前 200 字符）
   - 每次 LLM 调用：log 模型名 + 消息数 + 工具数
   - `text_delta` 结束时：log 输出文本长度 + token 用量
   - 工具执行时：log 工具名 + 耗时
   - 错误时：log 完整错误信息

4. **[src/web/server/routes/messages.ts](src/web/server/routes/messages.ts)** — 记录：
   - 请求进入：sessionId + 用户消息（截断）
   - 流完成/中断：总事件数 + 最终状态

5. **[bin/my-agent-web.ts:39](bin/my-agent-web.ts#L39)** — 日志级别支持环境变量覆盖：
   ```ts
   const logLevel = (process.env.MY_AGENT_LOG_LEVEL as LogLevel) ?? "info";
   const logger = createLogger("web", logLevel);
   ```

#### 3.4.2 Settings 配置扩展

**分两阶段：**

**阶段 A：后端 Config API（必要前置）**

1. **[src/config/loader.ts](src/config/loader.ts)** — 新增 `saveConfig(config, configPath?)` 函数，将 `CoreAgentConfig` 序列化写回 JSON 文件。

2. **新建** `src/web/server/routes/config.ts` — 2 条 API：
   - `GET /api/config` — 返回当前 `CoreAgentConfig`（脱敏：apiKey 显示为 `***` 或空）
   - `PUT /api/config` — 更新配置（Zod 校验 → 合并 → 写盘 → 热重载）

3. **[src/web/server/wire-routes.ts](src/web/server/wire-routes.ts)** — 注册新路由。

**阶段 B：前端 Settings 页面（依赖阶段 A）**

1. [web/src/pages/SettingsPage.tsx](web/src/pages/SettingsPage.tsx) — 新增 SettingGroup：
   - **Agent 配置**（defaultModel, thinkingLevel, maxRetries, maxToolLoops, toolIdleTimeoutMs, systemPrompt）
   - **Memory 配置**（enabled toggle, provider, maxResults, minScore）
   - **Evolution 配置**（enabled toggle, skillsDir, maxSkills）
   - **模型供应商**从只读改为可编辑（复用 ProviderForm 或内联编辑）

2. 使用 `react-hook-form` + `zod` 做表单校验（与 provider form 一致）。

---

## 4. 文件改动清单

### P0（阻塞性修复）

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `bin/my-agent-web.ts` | Modify | 增加 dotenv import、configPath 传递 |
| `src/config/loader.ts` | Modify | apiKey 为空时从环境变量 fallback |
| `src/web/server/routes/providers.ts` | Modify | apiKey 掩码 `"***"` 防污染 |
| `src/web/server/routes/messages.ts` | Modify | done+error 事件处理、adaptStreamEvent 补 done case |
| `web/src/features/chat/useChatStream.ts` | Modify | error 事件显示错误消息 |

### P1（核心体验）

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `web/src/pages/ChatPage.tsx` | Modify | session 自动创建 + 历史加载 |
| `web/src/features/chat/useChatStream.ts` | Modify | sessionId 变化时重置 historyLoaded |
| `web/src/features/ui/useUiStore.ts` | Modify | setLocale 中同步调用 i18n.setLocale |
| `web/src/i18n/useTranslation.ts` | **New** | React i18n hook（订阅 Zustand locale） |
| `web/src/components/layout/Sidebar.tsx` | Modify | 导航文本改用 t()（翻译键已存在于 zh.json/en.json） |
| `web/src/pages/SettingsPage.tsx` | Modify | 文本改用 t() |
| `web/src/pages/DashboardPage.tsx` | Modify | 文本改用 t() |
| `web/src/pages/ChatPage.tsx` | Modify | 文本改用 t() |
| 其他有静态文本的页面 | Modify | 文本改用 t() |

### P2（体验增强）

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/shared/logger.ts` | Modify | 结构化日志 + 子 logger |
| `src/web/server/index.ts` | Modify | access log |
| `src/agent/runner.ts` | Modify | 关键节点日志埋点 |
| `src/web/server/routes/messages.ts` | Modify | 请求/响应日志 |
| `bin/my-agent-web.ts` | Modify | 日志级别环境变量 |
| `src/config/loader.ts` | Modify | 新增 saveConfig() |
| `src/web/server/routes/config.ts` | **New** | GET/PUT /api/config |
| `src/web/server/wire-routes.ts` | Modify | 注册 config 路由 |
| `web/src/pages/SettingsPage.tsx` | Modify | 新增 Agent/Memory/Evolution 配置组 |

---

## 5. 方案对比

### 5.1 i18n 方案对比

| 方案 | 优点 | 缺点 | 推荐 |
|------|------|------|------|
| **A. 轻量翻译字典** | 零依赖、≤100 行、与 spec "不引入 i18n 框架"一致 | 无复数/日期格式化、需手动维护 key | ✅ **推荐** |
| B. react-i18next | 生态成熟、支持插值/复数/命名空间 | +30KB、违背 spec §1.3 非目标 | ❌ |
| C. 手写 Context + Provider | 完全控制 | 重复造轮子、额外 Context 层级 | ❌ |

**选择方案 A**：当前仅 2 种语言、翻译条目 < 50 条，轻量字典完全够用。未来如需扩展再升级。

### 5.2 Settings 配置方案对比

| 方案 | 优点 | 缺点 | 推荐 |
|------|------|------|------|
| **A. 后端 Config API + 前端表单** | 数据一致性好、热重载、可持久化 | 新增 2 个 API + 1 个路由文件 | ✅ **推荐** |
| B. 前端 localStorage only | 零后端改动 | 不与后端同步、多端不一致、无法持久化到文件 | ❌ |
| C. 前端直接写 config.json（通过后端 API 代理）| 与方案 A 类似但更重 | 需要文件锁、冲突处理 | ❌ |

**选择方案 A**：config 是服务端概念，前端应通过 API 读写。

---

## 6. 风险与注意事项

1. **config 初始化顺序变更**（P0）可能影响现有 Provider 注册流程 → 需充分测试
2. **i18n 翻译字典**初始可能不完整 → 优先覆盖 Sidebar + Settings，其他页面逐步补全
3. **日志级别**默认保持 `info`，避免 `debug` 级别在生产环境产生大量输出
4. **Config API** 需要考虑并发安全（当前单用户本地服务，暂不需要锁）
5. **Settings 表单**中 `systemPrompt` 可能很长，需要合适的 UI 控件（textarea）

---

## 7. Spec 自检

1. **Placeholder 扫描：** 问题 1 的 ChatPage 具体逻辑需进一步确认后精确描述修改点 ✅ 已标注
2. **内部一致性：** P0→P1→P2 优先级顺序合理，依赖关系清晰 ✅
3. **Scope 检查：** 6 个问题聚焦明确，可独立验证，无需进一步拆分 ✅
4. **歧义检查：** 各修复方案给出了具体文件、行号和代码示例，无歧义 ✅

---

## Next

- 确认方案无误 → 说「写计划」或「制定实施计划」
- 变更范围小、无需计划 → 说「直接实现」或「直接做」
- 需要调整方案 → 直接说修改意见
