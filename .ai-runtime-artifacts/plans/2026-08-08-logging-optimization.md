# 日志中文化优化方案

> **日期**: 2026-08-08 | **范围**: 全项目（前后端）

---

## 一、现状分析

### 1.1 日志基础设施

| 文件 | 说明 |
|------|------|
| [src/shared/logger.ts](../../src/shared/logger.ts) | Logger 接口 + `createLogger()` 工厂 |
| 格式 | `[ISO时间戳] [子系统] 英文消息 {JSON附加数据}` |
| 级别 | debug / info / warn / error + child() 子 logger |

### 1.2 当前日志点分布（共约 20 处）

**启动 & 路由接线（`bin/my-agent-web.ts` + `wire-routes.ts`）**：
```log
[web] [providers] registered 1 providers: deepseek
[web] [wire] providers: 9/8 handlers wired
[web] [wire] sessions: handlers wired
[web] [wire] messages: SSE stream + abort wired
[web] [wire] models: 1 handler wired
[web] [wire] agents: 2 handlers wired
[web] [wire] skills: 5 handlers wired
[web] 🌐 my-agent Web listening on http://127.0.0.1:4321
```

**HTTP 请求（`index.ts` handleRequest）**：
```log
[web] GET / 200 3ms
[web] POST /api/sessions 201 8ms
[web] POST /api/sessions/gconv-xxx/messages/stream 200 1521ms
```

**Chat SSE 流（`routes/messages.ts`）**：
```log
[web] SSE stream start  {"sessionId":"gconv-708255c09a94","streamId":"606392b1-..."}
[web] SSE stream end  {"sessionId":"gconv-708255c09a94","streamId":"606392b1-..."}
```

**错误处理（`errors.ts`）**：
```log
[web] [web] 404 NOT_FOUND: Not Found: GET /assets/index-CkDyHF_W.js
```

**Agent Runner（`runner.ts`）**：
```log
// 注意：AgentRunner 的 logger 当前未接入 web logger，这些日志不会输出！
runStream start  {model, provider, ...}
LLM call completed  {model, tokens, durationMs, ...}
tool start: ${call.name}  {tool, id}
```

### 1.3 核心问题

| 问题 | 影响 |
|------|------|
| **全部英文** | 中文用户看不懂，调试困难 |
| **无用户输入日志** | 不知道用户发了什么消息，无法回溯对话 |
| **无对话上下文** | 无法关联 session ↔ 对话主题 |
| **SSE 流日志空洞** | "SSE stream start/end" 完全无法理解发生了什么 |
| **Agent Runner 日志丢失** | runner 的 logger 未与 web logger 桥接，agent 执行过程完全不可见 |
| **路由接线信息冗余** | `[wire] xxx: N handlers wired` 对运维无意义 |
| **子系统标识单一** | 所有日志都打 `[web]`，无法区分来源模块 |
| **前端零日志** | 前端用户操作、API 调用、错误完全不可追踪 |
| **404 日志格式** | `[web] [web] 404 NOT_FOUND: ...` 重复前缀 |

---

## 二、优化方案

### 2.1 总体策略

1. **日志消息中文化** — 所有 `logger.info/warn/error` 消息改为中文
2. **细化子系统标识** — 利用 `logger.child()` 为每个模块创建子 logger
3. **增加关键信息** — 用户输入、对话 session、工具执行等
4. **Runner 日志桥接** — 确保 AgentRunner 的 logger 输出到 web 日志
5. **前端接入日志** — 前端关键操作打 console 日志（开发环境）
6. **日志级别分层** — debug=内部细节, info=关键事件, warn=异常, error=故障

### 2.2 子系统划分

```
web (root)
├── web/http        HTTP 请求/响应日志
├── web/wire        路由接线（debug 级别，启动时一次性输出）
├── web/chat        Chat SSE 流（用户输入、流开始/结束、token 消耗）
├── web/session     会话管理（创建/删除/列表）
├── web/provider    供应商管理
├── web/skill       技能管理
├── web/agent       Agent 管理
├── web/config      配置管理
└── agent/runner    Agent 执行器（通过桥接接入 web 日志流）
```

### 2.3 逐模块改造

#### A. 日志基础设施 (`src/shared/logger.ts`)

**不改变 Logger 接口**，仅优化 `createLogger` 内部：
- `child()` 已正确实现子系统链 `parent/child`
- 保持 `[timestamp] [subsystem] msg data` 格式不变
- 无需改动

#### B. 启动 & 路由接线 (`bin/my-agent-web.ts` + `wire-routes.ts`)

| 原日志 | 新日志 | 级别 |
|--------|--------|------|
| `[providers] registered N providers: ...` | `已注册 N 个模型供应商: ...` | info |
| `[wire] providers: 9/8 handlers wired` | `供应商 API 路由已就绪 (8 条)` | debug |
| `[wire] sessions: handlers wired` | `会话管理路由已就绪` | debug |
| `[wire] messages: SSE stream + abort wired` | `聊天流式路由已就绪 (SSE + 取消)` | debug |
| `[wire] models: 1 handler wired` | `模型列表路由已就绪` | debug |
| `[wire] agents: 2 handlers wired` | `Agent 管理路由已就绪` | debug |
| `[wire] skills: 5 handlers wired` | `技能管理路由已就绪 (5 条)` | debug |
| `🌐 my-agent Web listening on ...` | `🌐 服务器已启动 → http://127.0.0.1:4321` | info |

#### C. HTTP 请求日志 (`src/web/server/index.ts`)

```diff
- GET / 200 3ms
+ → GET / → 200 (3ms)
+ → POST /api/sessions/gconv-xxx/messages/stream → 200 (1521ms)
```

同时增加 `requestId` 到日志 data 中方便关联。

#### D. Chat SSE 流 (`src/web/server/routes/messages.ts`)

**这是最关键的部分。** 增加用户输入内容：

| 原日志 | 新日志 | 级别 |
|--------|--------|------|
| `SSE stream start {sessionId, streamId}` | `💬 对话开始 [会话:xxx] 用户输入: "你好，帮我..."` | info |
| `SSE stream end {sessionId, streamId}` | `💬 对话结束 [会话:xxx] 耗时: 1521ms 消耗: 1234 tokens` | info |
| `auto-aborting previous stream(s)...` | `⚠️ 检测到重复请求，已自动取消上一个对话流 [会话:xxx]` | warn |

#### E. Agent Runner 日志桥接 + 中文化 (`src/agent/runner.ts` + `bin/my-agent-web.ts`)

**关键修复**：当前 `AgentRunner` 创建时没传 logger！

```diff
// bin/my-agent-web.ts
const runner = new AgentRunner({
  config,
  providers,
  tools: BUILTIN_TOOLS,
  session,
+ logger: logger.child("agent"),
});
```

Runner 日志中文化：

| 原日志 | 新日志 | 级别 |
|--------|--------|------|
| `runStream start {model, provider, ...}` | `🤖 开始执行 [模型:deepseek-v4-pro] 消息长度:42字` | info |
| `LLM call completed {model, tokens, ...}` | `✅ 模型响应完成 [tokens:1234 耗时:800ms 原因:end_turn]` | info |
| `tool start: read_file {tool, id}` | `🔧 执行工具: read_file` | debug |
| - 无错误日志 | `❌ 模型调用失败: {error message}` | error |
| - 无重试日志 | `🔄 重试第 2/3 次 (等待 1.2s)...` | warn |

#### F. 错误处理 (`src/web/server/errors.ts`)

```diff
- [web] 404 NOT_FOUND: Not Found: GET /assets/index-CkDyHF_W.js
+ ⚠️ 404 资源未找到: GET /assets/index-CkDyHF_W.js
```

修复双重 `[web] [web]` 前缀问题（errors.ts 里 logger.warn 内部又拼了 `[web]`）。

#### G. 新增会话日志 (`src/web/server/routes/sessions.ts`)

当前会话创建/删除没有日志，应在相应 handler 中加入：

```log
📝 创建新会话: gconv-xxx
🗑️ 删除会话: gconv-xxx (3条消息)
```

#### H. 前端日志（新增）

在 `web/src/` 中增加前端日志（仅开发环境）：

```typescript
// web/src/utils/logger.ts (新建)
const LOG_PREFIX = '[my-agent]';

export const logger = {
  debug: (msg: string, ...args: unknown[]) => {
    if (import.meta.env.DEV) console.debug(LOG_PREFIX, msg, ...args);
  },
  info: (msg: string, ...args: unknown[]) => {
    if (import.meta.env.DEV) console.info(LOG_PREFIX, msg, ...args);
  },
  warn: (msg: string, ...args: unknown[]) => {
    console.warn(LOG_PREFIX, msg, ...args); // warn 始终输出
  },
  error: (msg: string, ...args: unknown[]) => {
    console.error(LOG_PREFIX, msg, ...args); // error 始终输出
  },
};
```

前端日志点：

| 场景 | 日志 | 级别 |
|------|------|------|
| 发送消息 | `📤 发送消息: "你好" (session:xxx)` | debug |
| 收到流式响应 | `📥 流式响应开始 (streamId:xxx)` | debug |
| 流式完成 | `📥 流式响应完成 (耗时:1521ms)` | debug |
| API 错误 | `❌ API 错误: 500 INTERNAL_ERROR` | error |
| 创建会话 | `📝 新建会话` | debug |
| 切换会话 | `🔄 切换到会话: xxx` | debug |
| 设置变更 | `⚙️ 配置已保存` | debug |

### 2.4 优化后日志示例

```
[2026-08-08T15:01:54.491Z] [web] 已注册 1 个模型供应商: deepseek
[2026-08-08T15:01:54.491Z] [web/wire] 供应商 API 路由已就绪 (8 条)
[2026-08-08T15:01:54.491Z] [web/wire] 会话管理路由已就绪
[2026-08-08T15:01:54.491Z] [web/wire] 聊天流式路由已就绪 (SSE + 取消)
[2026-08-08T15:01:54.491Z] [web/wire] 模型列表路由已就绪
[2026-08-08T15:01:54.491Z] [web/wire] Agent 管理路由已就绪
[2026-08-08T15:01:54.491Z] [web/wire] 技能管理路由已就绪 (5 条)
[2026-08-08T15:01:54.491Z] [web] 🌐 服务器已启动 → http://127.0.0.1:4321
[2026-08-08T15:01:54.500Z] [web/http] → GET / → 200 (3ms)
[2026-08-08T15:01:54.600Z] [web/http] → POST /api/sessions → 201 (8ms)
[2026-08-08T15:01:54.600Z] [web/session] 📝 创建新会话: gconv-708255c09a94
[2026-08-08T15:01:54.601Z] [web/chat] 💬 对话开始 [gconv-708255c09a94] 用户: "帮我写一个 React 组件"
[2026-08-08T15:01:55.200Z] [agent/runner] 🤖 开始执行 [模型:deepseek-v4-pro] 消息长度:10字 工具:12个
[2026-08-08T15:01:55.800Z] [agent/runner] 🔧 执行工具: write_file
[2026-08-08T15:01:56.000Z] [agent/runner] ✅ 模型响应完成 [tokens:856 耗时:800ms 原因:end_turn]
[2026-08-08T15:01:56.122Z] [web/chat] 💬 对话结束 [gconv-708255c09a94] 耗时:1521ms 消耗:856 tokens
[2026-08-08T15:01:56.122Z] [web/http] → POST /api/sessions/gconv-.../messages/stream → 200 (1521ms)
```

### 2.5 实现步骤

| 步骤 | 内容 | 影响文件 |
|------|------|----------|
| **1** | 修复 AgentRunner logger 桥接 | `bin/my-agent-web.ts` |
| **2** | logger 子系统细化 + 创建子 logger | `bin/my-agent-web.ts` |
| **3** | 路由接线日志中文化 (debug 级别) | `src/web/server/wire-routes.ts` |
| **4** | HTTP 请求日志中文化 + 添加 `[web/http]` 子 logger | `src/web/server/index.ts` |
| **5** | Chat SSE 日志中文化 + 添加用户输入+token统计 | `src/web/server/routes/messages.ts` |
| **6** | Agent Runner 日志中文化 + 增加错误/重试日志 | `src/agent/runner.ts` |
| **7** | 错误处理日志中文化 + 修复双前缀 | `src/web/server/errors.ts` |
| **8** | 优雅退出日志中文化 | `src/web/server/graceful-shutdown.ts` |
| **9** | 新增会话管理日志 | `src/web/server/routes/sessions.ts` |
| **10** | 新增配置变更日志 | `src/web/server/routes/config.ts` |
| **11** | 新增前端日志工具 + 关键点接入 | `web/src/utils/logger.ts` + 各组件 |
| **12** | 验证：启动服务 → 发对话 → 检查日志输出 | 全量冒烟 |

### 2.6 不做的

- **不改 Logger 接口** — 保持 `Logger` interface 不变，不影响现有测试
- **不改日志格式** — 保持 `[timestamp] [subsystem] msg {json}` 格式
- **不改日志级别** — 保持 `MY_AGENT_LOG_LEVEL` 环境变量控制
- **不引入新依赖** — 不加 winston/pino 等，保持零外部日志依赖
- **不记录完整消息内容到日志** — 用户消息仅截取前 50 字，避免日志膨胀和隐私泄露

### 2.7 预计影响范围

| 类别 | 文件数 | 风险 |
|------|--------|------|
| 日志基础设施 | 0（不改） | 无 |
| 后端日志消息 | ~7 个 | 低（仅改字符串） |
| 后端新增日志 | ~5 处 | 低 |
| Runner 日志桥接 | 1 处 | 中（需验证 runner 正常输出） |
| 前端日志 | 新建1文件 + ~5 组件 | 低（仅开发环境） |
| 测试 | 0 | 无（测试不依赖日志消息文本） |

---

## 三、下一步

确认方案后，按步骤 1-12 逐步实施。
