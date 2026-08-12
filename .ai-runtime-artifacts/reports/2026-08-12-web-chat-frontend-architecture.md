# 前端 Chat UI 架构分析报告

- **调研时间**：2026-08-12
- **范围**：`d:\studyspace\project\my-agent\web\` 整个前端工程
- **方法**：只读代码审计 + 关键测试对照 + 配置逆向。无任何文件被修改。
- **证据原则**：每条结论标注 `path:行号` 或 `path:章节`；主观判断段落显式标注 `## 评估` 或 `## 建议`。

---

## 1. 执行摘要

`web/` 是一个**以 Chat 为核心场景的 SPA 桌面控制台**：

- **栈形态**：React 19 + Vite 6 + TypeScript 5 严格模式，**Zustand** 承担流式会话运行时状态，**TanStack Query** 承担服务端历史/列表快照，**Tailwind 4** + 自研 `tokens.ts` 设计 token，**Radix Slot** 仅作为 Button 的可选子节点机制。
- **流式对话**：自研 `useChatStream` hook（1287 行） + Zustand `chatRuntimeStore`（858 行），**使用 fetch POST + `parseSseStream` 解析 SSE**（不是 WebSocket / 不是 EventSource）。协议自定义 envelope `{sessionId, runId, streamId, seq, event, data}` 做强身份校验与 seq 去重。
- **会话隔离**：`useChatStream` 与 store 的核心合同是 **「每会话独立 SessionRuntime + 每 run 独立 RunRuntime + rAF 文本缓冲按 run 隔离 + callback 捕获不可变 runId」**，配套 **5 个回归测试**（A→B→A、跨 runId 复用、流完成 409 防止、retention TTL）已固化。
- **Trace / Tool 可视化**：v4 双布局（spec `.ai-runtime-artifacts/specs/2026-08-11-run-trace-dual-layout-spec.md`）—— assistant 消息的 trace 步骤、final markdown、生成指示器**作为三个独立 DOM 节点**渲染，避免共享容器复用错位；`runTrace.ts` 提供纯函数派生层 `buildRunTrace` 合并 tool_call/tool_result 并摘要。
- **懒创建会话**：`/chat` 不再立即 POST 会话；按首条消息触发，再 `setPendingMessage` 跨 React 实例传文本给新的 `ChatPage`。
- **UI 风格**：Orkas 风格、强调 backdrop-blur / 圆角 / pill 按钮 / 渐变；自定义 `thinking-slider` 复选滑块；Tailwind 4 `@theme` 注入设计 token（亮/暗）；亮色为主色 `#6c5ce7`（紫）。
- **测试**：Vitest + jsdom 跑 32 个单测/feature 测试 + Playwright 跑 4 个 e2e（其中 a11y 用 `@axe-core/playwright` 跑 7 个路由 + WCAG2.1AA 严格扫描）。

简言之：**一个由流式协议细节驱动的"工具感"对话前端**，重点是流式鲁棒性与多会话隔离，"漂亮度"次之。

---

## 2. 技术栈

| 技术 | 版本 | 用途 / 依据 |
|---|---|---|
| React | 19.1.0 | `web/package.json:20-21` |
| Vite | 6.3.0 | `web/package.json:46` |
| TypeScript | 5.7.0（严格模式） | `web/package.json:45`、`web/tsconfig.json:9` |
| React Router | 7.18.2（createHashRouter） | `web/package.json:24`、`web/src/App.tsx:1,4` |
| Zustand | 5.0.14 | `web/package.json:30`（用于 `chatRuntimeStore`、`useUiStore`） |
| TanStack Query | 5.101.4 | `web/package.json:16`（用于 sessions/agents/skills/providers/models/active-provider 缓存） |
| React Hook Form | 7.85.0 + `@hookform/resolvers` 5.7.1 + Zod 4.4.3 | `web/package.json:14,22,29`（用于 Provider 表单，参考 `web/src/features/providers/ProviderForm.tsx`） |
| Tailwind CSS | 4.0.0 + `@tailwindcss/postcss` 4.0.0 | `web/package.json:35,44`；`postcss.config.js:1` |
| Radix Slot | 1.3.3 | `web/package.json:15`（仅 `components/ui/button.tsx` 用 `asChild` 模式） |
| Lucide React | 1.30.0 | `web/package.json:19`（图标库） |
| `clsx` + `tailwind-merge` | 2.1.1 / 2.5.0 | `web/package.json:17,28`（经 `web/src/lib/cn.ts` 合并） |
| `react-markdown` + `remark-gfm` + `rehype-sanitize` + `rehype-highlight` + `highlight.js` | 10.1.0 / 4.0.1 / 6.0.0 / 7.0.2 / 11.11.1 | `web/package.json:23-27`、`web/src/components/chat/Markdown.tsx:1-5` |
| Vitest | 2.1.0 | `web/package.json:47` |
| Testing Library | `@testing-library/react` 16 + `@testing-library/jest-dom` 6.6 + `@testing-library/user-event` 14.5 | `web/package.json:36-38` |
| jsdom | 25.0.0 | `web/package.json:43`；`web/vitest.config.ts:11` |
| Playwright + `@axe-core/playwright` | 1.62.1 / 4.12.1 | `web/package.json:33-34` |
| 包管理器 | npm | `web/package-lock.json` 存在；无 `pnpm-lock.yaml` / `yarn.lock` |
| Node | 隐含 ≥ 18（Vite 6、tsc 5.7 要求） | 未在 `engines` 显式声明 |

**注**：没有 Redux、Styled-Components、Emotion、shadcn、Headless UI、Chakra、Antd。`components/ui/` 仅有 1 个文件（`button.tsx`），不是 shadcn 风格的组件库。

---

## 3. 目录结构

```
web/
├── package.json                 # 依赖、scripts: dev/build/test/e2e
├── vite.config.ts               # base:'./'、port 5173、/api 代理到 4321
├── vitest.config.ts             # jsdom、@/ → src/
├── tsconfig.json                # 严格模式、@/* → src/*
├── postcss.config.js            # @tailwindcss/postcss
├── playwright.config.ts         # E2E 配置（未读取，但 e2e 已在用）
├── index.html                   # 入口 HTML + 同步 data-theme 闪烁规避脚本
├── public/                      # fonts/(Inter-Bold/Regular, JetBrainsMono-Regular)
├── src/
│   ├── main.tsx                 # 根：QueryClientProvider + StrictMode
│   ├── App.tsx                  # createHashRouter
│   ├── routes.tsx               # 8 条路由（AppShell 包裹）
│   ├── test-setup.ts            # jest-dom 注册
│   ├── styles/
│   │   ├── globals.css          # tailwind + @theme + Prose + dark + 动画 + 滚动条
│   │   └── tokens.ts            # 同步的 design token 对象
│   ├── lib/                     # 跨 feature 基础库
│   │   ├── api.ts               # apiGet/Post/Put/Patch/Delete + Zod 错误 + {ok,data} 解包
│   │   ├── sse.ts               # parseSseStream 异步生成器（按 \n\n 切帧）
│   │   ├── cn.ts                # clsx + tailwind-merge
│   │   ├── error.ts             # ApiErrorCode 枚举
│   │   ├── logger.ts            # debug/info/warn/error 命名导出
│   │   ├── i18n.ts              # zh/en JSON 加载器
│   │   └── query-keys.ts        # 中央化 React Query key
│   ├── hooks/useTheme.ts        # 主题切换
│   ├── i18n/                    # useTranslation + zh.json + en.json
│   ├── components/
│   │   ├── ui/button.tsx        # 唯一通用 UI 原子（4 variant × 3 size + asChild）
│   │   ├── layout/              # AppShell、Sidebar、Topbar
│   │   └── chat/                # 11 个聊天相关组件（见 §4）
│   ├── features/                # 按业务域聚合（核心！）
│   │   ├── chat/                # ★ useChatStream、chatRuntimeStore、types、runTrace、pending-message
│   │   ├── sessions/            # useSessions（列表+删除）
│   │   ├── providers/           # useProviders + ProviderForm + ProviderTestButton
│   │   ├── skills/              # useSkills
│   │   ├── tools/               # useTools
│   │   ├── agents/              # useAgents
│   │   ├── attachments/         # validateAttachment + uploadAttachment（stub）
│   │   ├── dashboard/           # useTaskSuggestions + TaskSuggestionsGrid/TaskSuggestionCard + taskSuggestions
│   │   └── ui/                  # useUiStore（主题/语言/sidebar）
│   └── pages/                   # 9 个页面（Dashboard、Chat、Sessions、Providers、Skills、Tools、Agents、Settings、NotFound）
└── tests/
    ├── unit/                    # 24 个组件/库单测
    ├── features/chat/           # 6 个核心流式回归（chat-stream-state / chatRuntimeStore / runTrace / trace-bubble×2 / run-trace-panel×2 / message-bubble-cycle / generating-indicator）
    └── e2e/                     # 4 个 Playwright 脚本（含 a11y）
```

### 模块职责

| 路径 | 职责 |
|---|---|
| `src/features/chat/` | **核心**：SSE 协议解析、流状态机、消息块模型、trace 派生、跨实例 pending 消息 |
| `src/components/chat/` | **视图**：消息列表 / 气泡 / 工具 / 输入框 |
| `src/components/layout/` | 全局壳：侧边栏（导航 + session 列表 + 删除）、顶栏、AppShell |
| `src/components/ui/button.tsx` | 唯一通用 UI 原子，其余全部 Tailwind 组合 |
| `src/lib/` | 基础设施：HTTP、SSE 解析、错误、日志、cn、query-keys |
| `src/styles/` | Tailwind 4 `@theme` + tokens 对象（双源；见 §7） |
| `src/features/{sessions,providers,skills,tools,agents}/` | CRUD 列表/表单，各自独立 useQuery hook |
| `src/features/dashboard/` | 任务推荐栅格（首页） |
| `src/pages/ChatPage.tsx` | **编排中心**：模型选择、思考级别、handleSend 懒创建、pending 消费、Abort 透传 |

---

## 4. 核心数据流

### 4.1 一段文字

`Composer` 收集文本 → `ChatPage.handleSend` 决定「已有 session」或「懒创建」分支 → `useChatStream.send` 在 `chatRuntimeStore` 创建 `RunRuntime` 与 `(sessionId, runId)` 身份 → `POST /api/sessions/:id/messages/stream` → 后端回 SSE → 浏览器用 `parseSseStream` 逐帧解析 → hook 按 envelope 校验 sessionId/runId 并按 seq 去重 → 事件 dispatch（`message_start` 创建 assistant 占位、`content_block_delta` 走 rAF 缓冲、`tool_use` 走 tool_call block、`tool_result` 走 tool_result block、`thinking_delta` 走 thinking block、`done`/`error`/`aborted` 收尾）→ `MessageList` 订阅 `useChatRuntimeStore(selectSessionMessages(sessionId))` → `MessageBubble` 用 `buildRunTrace` 派生 `RunTraceViewModel` → 渲染三个独立 DOM 节点（`<TraceBubble>` + final markdown + 可选 `GeneratingIndicator`）。`MessageBubble` 之间互不耦合，session 切换时由于 store 切 selector 自带（sessionId, runId）身份，不会串流。

### 4.2 ASCII 伪流程图

```
┌────────────┐  text  ┌────────────┐
│  Composer  │───────▶│ ChatPage   │
│  (input)   │  send  │ handleSend │
└────────────┘        └─────┬──────┘
                            │ sessionId
                            ▼
                ┌───────────────────────┐    Zustand selector
                │  useChatStream(cid)   │◀──── (per-session)
                └──┬──────────────┬────┘
        send/text  │              │ status / messages / historyLoaded
                   ▼              ▼
        ┌──────────────────┐  ┌──────────────────────┐
        │ ensureSession()  │  │ selectSession…(cid)  │
        │ createRun(runId) │  │ → 订阅当前 session   │
        │ setActiveRun()   │  └─────────┬────────────┘
        └────┬─────────────┘            │
             │ POST {text, runId,      │
             │       clientMessageId,  │
             │       model, thinking}  │
             ▼                         │
   POST /api/sessions/:id/             │
        messages/stream  ──────►       │
                                  ┌────┴────┐
   onmessage (SSE)            ◀────│ fetch   │
        │                          └────────┘
        │  bytes
        ▼
   parseSseStream (lib/sse.ts)  ── 切帧 ──▶  (event, data)
        │
        ▼
   useChatStream 主循环
   ├─ envelope 校验: envSessionId === sessionId?
   ├─ envRunId 校验:  === runId (callback 闭包不可变)
   ├─ seq 去重: envSeq > run.lastSeq
   └─ switch(envEvent)
      ├─ message_start     → ensureAssistant + set messageId + status='streaming'
      ├─ content_block_delta(text_delta)
      │   → store.appendTextBuffer(runId, text) → rAF 16ms 批刷
      │   → store.flushTextBuffer(runId) 把 buffer 推进 message.blocks
      ├─ content_block_delta(input_json_delta)
      │   → 追加到当前 tool_call.inputRaw
      ├─ tool_use          → 增/改 tool_call block
      ├─ tool_result       → 增/改 tool_result block + 收尾对应 tool_call
      ├─ thinking_delta    → 增/改 thinking block
      ├─ usage             → 写 assistant.usage
      ├─ message_stop      → 收尾 streaming→done
      ├─ done              → finishRun('succeeded', 'done'); 若带 persistedRevision → 异步 GET /history 并 mergePersistedWithOverlay
      ├─ error             → finishRun('failed', 'error')
      └─ aborted           → finishRun('aborted', 'aborted')
        │
        ▼
   chatRuntimeStore（Zustand） sessions[cid].messages 更新
        │
        ▼
   MessageList (订阅 selector)
        │
        ▼
   MessageBubble → buildRunTrace(blocks) → RunTraceViewModel
        │
        ├─ 存在 trace steps → <TraceBubble><RunTracePanel /></TraceBubble>
        ├─ text blocks      → <Markdown>（lazy 加载）
        └─ isStreaming && !hasFinalText → <GeneratingIndicator />

   abort 路径:  Composer stop → onAbort
   → useChatStream.abort() → 读 activeRunId → run.abortController.abort()
   → setRunStatus('aborted') → setSessionStatus('aborted') → setActiveRun(null)

   retry 路径:  Composer 上方「重试」按钮（仅 status==='error' 时显示）
   → useChatStream.retry() → 用同 clientMessageId 重新 sendAttempt 新 run
```

---

## 5. `useChatStream` 架构剖析

文件：`web/src/features/chat/useChatStream.ts`（1287 行）。
Store：`web/src/features/chat/chatRuntimeStore.ts`（858 行）。
类型：`web/src/features/chat/types.ts`（305 行）。

### 5.1 暴露面（`web/src/features/chat/useChatStream.ts:1285`）

```ts
return { status, messages, send, abort, retry, historyLoaded };
```

仅 5 个返回值，但内部对应一个**双层 store 状态机**（session 维 + run 维）。

### 5.2 状态切片

| 维度 | 类型 | 关键字段 | 文件:行号 |
|---|---|---|---|
| Session 状态 | `SessionRuntime` | `messages`、`historyLoaded`、`historyRevision`、`activeRunId`、`status`、`retryCandidate`、`pendingPersistence` | `chatRuntimeStore.ts:67-89` |
| Run 状态 | `RunRuntime` | `streamId`、`abortController`、`lastSeq`、`pendingTextBuffer`、`rafHandle`、`submittingTimer`、`messageStopped`、`persistedRevision`、`status` | `chatRuntimeStore.ts:46-61` |
| ChatStatus | `'idle'\|'submitting'\|'streaming'\|'reconnecting'\|'done'\|'error'\|'aborted'` | — | `types.ts:65-72` |
| RunStatus | `'queued'\|'running'\|'completing'\|'succeeded'\|'failed'\|'aborted'` | — | `chatRuntimeStore.ts:38-44` |

### 5.3 协议

- **HTTP 方法**：`POST /api/sessions/:sessionId/messages/stream`（见 `useChatStream.ts:574-583`），body 含 `{text, clientMessageId, runId, model?, thinkingLevel?}`，`signal: ctrl.signal`，`credentials: 'same-origin'`。
- **响应体格式**：`ReadableStream<Uint8Array>`（`parseSseStream`，`lib/sse.ts:37-78`），按 `\n\n` 切帧、逐行解析 `event:` / `data:`。
- **envelope**：`{sessionId, runId, streamId, seq, event, data}`（`types.ts:280-293`）。
  - 身份校验：`useChatStream.ts:653-666` 校验 `envSessionId === sessionId` 且 `envRunId === runId`（callback 闭包捕获的不可变 runId，不依赖瞬时 `activeRunId`）。
  - seq 去重：`useChatStream.ts:669-673` 仅接受 `envSeq > run.lastSeq`。
- **历史协议**：`GET /api/sessions/:sessionId/history` → `{sessionId, revision, messages: SerializedMsg[]}`（`types.ts:299-304`、`useChatStream.ts:420-450`）。
- **错误协议**：`POST` 非 2xx 在 `api.ts:90-92` 抛 `ApiError(code, status, msg)`；409（active run 冲突）在 hook 内 `useChatStream.ts:594-597` 走特殊路径。

### 5.4 流式事件 dispatch

`useChatStream.ts:641-1208` 主循环 switch 分发，支持事件：
- `message_start`、`content_block_start`、`content_block_delta`、`content_block_stop`
- `thinking_delta`、`tool_use`、`tool_result`、`tool_progress`
- `compaction`、`context_status`、`retry`、`provider_fallback`（已接收但无 UI 效果，分支空体）
- `message_delta`、`message_stop`、`usage`
- `done`（含 `deduplicated: true` 分支）、`error`、`aborted`

### 5.5 Abort 策略

两层 abort：
1. **用户主动**：`abort()`（`useChatStream.ts:1243-1258`）→ 读 `activeRunId` → `run.abortController.abort()` → 状态置 `aborted`，`activeRunId=null`。
2. **submitting 超时**：`SUBMITTING_TIMEOUT_MS = 60_000`（`useChatStream.ts:45`），在 send 内启动 `setTimeout`（`useChatStream.ts:537-549`）→ 若 60s 仍在 `queued` 状态则 abort + 标 `failed`。
3. **卸载 / 切会话**：component unmount 不主动 abort（store 持续后台 run），但 `_evictIfNeeded` 会在缓存超 20 个 session 时驱逐非 active session 的所有 run（`chatRuntimeStore.ts:770-796`）。

### 5.6 文本缓冲（rAF 批刷）

`appendTextBuffer`（`chatRuntimeStore.ts:619-646`）→ 把 SSE delta 累积到 `RunRuntime.pendingTextBuffer` → `requestAnimationFrame` 单次 `flushTextBuffer`（`chatRuntimeStore.ts:648-725`）→ 找到对应 assistant message → 找到或新建一个 `status !== 'done'` 的 text block → 整体拼接后清空 buffer + 释放 rAF。**好处**：高频 delta 不触发每帧 React 渲染。

### 5.7 持久化收敛（mergePersistedWithOverlay）

`useChatStream.ts:254-336`：
- `applySessionHistory`（`chatRuntimeStore.ts:278-322`）用单调 revision 拒绝更旧 history（`revision < ses.historyRevision` 直接 return）。
- merge 规则分三档：
  - **`identity` 命中**（`messageId ?? clientMessageId ?? id`）：按 `requiredRevision` vs `historyRevision` 决定 `overlay-wins` 或 `persisted-wins`。
  - **runId 命中**（防「重复气泡」）：再次用 `runId` 二次匹配，避免 persisted 与 overlay identity 不一致时错位插入（`useChatStream.ts:298-319`）。
  - **都不命中**：按 overlay 顺序 splice 插入。
- `mergeAssistantTextFromOverlay`（`useChatStream.ts:343-356`）：若 persisted 已收敛但缺 text block，保留 overlay 的更长的 final text（防「回复流被吞」）。

### 5.8 与 Trace bubble 的耦合点

- **`MessageBubble`** 不直接消费 store，而是消费 `chatRuntimeStore` 通过 selector 取出的 `messages`。
- **Trace 派生**：`runTrace.ts:131-220` `buildRunTrace(blocks, options)` 是**纯函数**，把 `Block[]` → `RunTraceViewModel`；`MessageBubble.tsx:46-50` 直接调用。
- **关键解耦点**：`runTrace.ts` 与 `useChatStream.ts` **不共享可变状态**——`useChatStream` 只写 store，`MessageBubble` 只读 store，派生层是纯函数。这意味着 trace 渲染可以独立单测（`tests/features/chat/runTrace.test.ts`，450+ 行，6 个分支）而不需要 mock SSE。

---

## 6. 多会话与流隔离

### 6.1 隔离机制（按代码层）

| 层 | 机制 | 代码位置 |
|---|---|---|
| 路由 | `useParams<{sessionId}>` 决定 `cid`，`App.tsx` 用 `createHashRouter` 每次重 mount | `routes.tsx:18-19` |
| Store | `sessions: Record<sessionId, SessionRuntime>` 与 `runs: Record<runId, RunRuntime>` 双索引 | `chatRuntimeStore.ts:95-99` |
| Hook | `useChatStream(sessionId)` 内 `useMemo(() => selectSessionMessages(sessionId), [sessionId])` —— **selector 是工厂闭包** | `useChatStream.ts:394-408` |
| Callback 闭包 | `sendAttempt` 捕获 `runId` 与 `sessionId` 不可变；SSE 事件 envelope 校验用闭包值 | `useChatStream.ts:486-490, 663-666` |
| rAF 缓冲 | 按 `runId` 隔离；rAF 句柄挂在 `RunRuntime.rafHandle` | `chatRuntimeStore.ts:619-725` |
| Abort 精度 | 按 `(sessionId, runId)` 中止；切会话不 abort 后台 run（除非 evict） | `useChatStream.ts:1243-1258`、`chatRuntimeStore.ts:770-796` |
| 持久化收敛 | `pendingPersistence: Record<runId, number>` 按 run 跟踪最低 revision | `chatRuntimeStore.ts:77-79, 522-590` |
| LRU 缓存 | `MAX_CACHED_SESSIONS = 20`、`MAX_TERMINAL_RUNS_PER_SESSION = 20`、`MAX_PENDING_PERSISTENCE_PER_SESSION = 32` + 30 分钟 TTL | `chatRuntimeStore.ts:25-32, 770-815` |
| 渲染 | `MessageList` 的 `key={sessionId}`（`ChatPage.tsx:428`）和 `Composer` 的 `key={sessionId ?? '__blank__'}`（`ChatPage.tsx:441`）强制重挂载避免草稿/滚动污染 | — |
| 草稿 / pending | `pending-message.ts` 用模块级 `Map<sessionId, PendingEntry>` 跨 ChatPage 实例传首条消息 | `features/chat/pending-message.ts:29-48` |

### 6.2 回归测试覆盖

| 测试 | 覆盖点 | 文件 |
|---|---|---|
| `A→B→A 切换` | 切回 A 时 `trace-bubble` 计数=1、灰底 + border + 紫色侧条 className 恒在 | `tests/features/chat/trace-bubble-session-switch.test.tsx:163-246` |
| `同 message.id 跨 session 复用` | A/B 共用 `id='shared-1'` 时 final 内容不残留 | 同上 `:248-324` |
| `A 有未完成流切走` | 切回后 `GeneratingIndicator` 按真实 `isStreaming` 渲染 | 同上 `:326-390` |
| `status=error 但 activeRunId 残留` | send 必须被拦下（避免后端 409） | 同上 `:392-455` |
| `keeps A overlay and later deltas across A → B → A with late history` | 迟到的 history 不覆盖 A 的 streaming overlay | `tests/features/chat/chat-session-stream-isolation.test.tsx:84-170` |
| `clears only the terminal run resources while preserving same-run convergence writes` | 终态 run 清理不能误清同 session 其他 run | 同上 `:234-264` |
| `done clears active run resources without touching another session run` | 跨 session run 资源互不干扰 | 同上 `:381-446` |
| `does not let an old run terminal steal a newer run UI ownership` | 旧 run 晚到 error 不抢新 run 的 activeRunId | 同上 `:448-496` |
| `aborts a timed-out old request without changing the newer run UI` | submitting 60s 超时不影响新 run | 同上 `:498-531` |
| `rejects a delayed history response older than the current session revision` | 迟到旧 revision 的 history 不污染 | 同上 `:533-564` |
| `keeps retry identity isolated between A and B sessions` | retry 槽位按 session 隔离 | 同上 `:1293-1369` |
| `does not rerender an A hook for background B session updates` | 订阅 B 状态变化不重渲 A 视图 | 同上 `:909-931` |
| `sessionId 变化清空 messages` | 切到空 cid 必须立刻清空 | `tests/unit/chat-stream-state.test.ts:170-258` |
| `abort 后 UI 不卡死` | status 必须脱离 streaming 集合 | `chat-stream-state.test.ts:265-369` |

**总计**：14+ 集成 / 单元测试专门守护流隔离，这是这个项目最严防死守的领域。

---

## 7. UI 设计语言

### 7.1 组件库

- **自研轻量**。`src/components/ui/` 只有 `button.tsx`，导出 `Button`（4 variant × 3 size + `asChild` 通过 `@radix-ui/react-slot`）。
- **未使用** shadcn / Headless UI / Chakra / Antd / Mantine。
- **图标**：`lucide-react`（1.30.0，版本号偏低但与 React 19 兼容）。

### 7.2 样式方案

- **唯一方案**：Tailwind CSS 4.0.0，通过 `@tailwindcss/postcss`（`postcss.config.js:1`）。
- **设计 token 双源**：
  - `src/styles/tokens.ts` —— TS 对象（11 个颜色 + 3 个圆角），目前**几乎没有被引用**（grep 显示仅 globals.css 和 ChatPage 注释有提及），可以视为「死代码 / 未来接口」。
  - `src/styles/globals.css:21-37` —— Tailwind 4 的 `@theme` 块定义同名 CSS 变量。**实际生效的是这一处**。
- **暗色模式**：`[data-theme="dark"]` 选择器（`globals.css:39-52`）+ 入口 HTML 同步闪烁规避（`index.html:7-14`）。
- **CSS Modules / Styled-Components / Emotion / vanilla-extract**：**均未使用**。
- **第三方 CSS**：仅 `highlight.js/styles/github.css`（`Markdown.tsx:5`） + dark 模式覆盖（`globals.css:189-241`）。

### 7.3 关键视觉惯例

- **品牌色**：`#6c5ce7`（紫），dark 模式 `#7c6ff7`。
- **字号**：`text-[15px]` 正文、`text-[11px]` 标签、`text-[32px]` 空状态大招呼。
- **圆角**：`rounded-xl`、`rounded-2xl` 居多；`tokens.ts` 的 `radius: {sm:6, md:10, lg:14}` 与 CSS `--radius-*` 一致。
- **背景**：`bg-surface/80 backdrop-blur-sm` 在输入框卡片（`Composer.tsx:150-152`）。
- **动画**：入场 `animate-fade-in`、`message-enter`、`animate-stagger`（`globals.css:521-571, 577-590`），并通过 `prefers-reduced-motion` 全部禁用。
- **i18n**：zh.json（167 行）+ en.json；`useTranslation` 走模块级切换。
- **Orkas 风格明确引用**：注释里多次出现 "Orkas chat-header 风格"、"Orkas .new-chat-input-area 风格"、"Orkas .chat-send-btn" 等。属于参考实现。

### 7.4 组件分布

`src/components/` 15 个文件，按"原子 / 分子"分：
- **原子**：`ui/button.tsx`
- **布局**：`layout/AppShell.tsx`、`layout/Sidebar.tsx`、`layout/Topbar.tsx`
- **聊天领域组件**（11 个）：`Composer`、`ComposerAttachmentButton`、`AttachmentList`、`ContextDropdown`、`MessageList`、`MessageBubble`、`Markdown`、`RunTracePanel`、`TraceBubble`、`ThinkingDots`（已弃用但保留）、`GeneratingIndicator`

`Composer` 的 `modelSelector` 节点由 `ChatPage` **注入**（`ChatPage.tsx:224-345`）—— 一种 prop composition 模式，避免 Composer 知道 ChatPage 状态。

---

## 8. 测试覆盖

### 8.1 框架

- **单元 / Feature**：`vitest` 2.1.0 + `@testing-library/react` 16 + `@testing-library/jest-dom` 6.6 + jsdom 25。配置在 `vitest.config.ts`。
- **E2E**：`@playwright/test` 1.62.1 + `@axe-core/playwright` 4.12.1。

### 8.2 测试文件统计

| 类别 | 数量 | 范围 |
|---|---|---|
| `tests/unit/` | 24 | `api`、`cn`、`sse`、`font-face`、`csp-font-src`、`theme`、`i18n`、`routes-table`、`chat-stream-state`、`chat-stream-state` 的状态机、`chatRuntimeStore`、`runTrace`、`run-trace-panel-matrix`、`message-bubble-cycle`、`trace-bubble`、`generating-indicator`、`message-copy`、`pending-prompt`、`session-delete-and-lazy-create`、`markdown-xss`、`composer-attachment`、`upload-attachment-stub`、`validate-attachment`、`dashboard-tasks`、`tools-hooks`、`tools-page`、`provider-form`、`skills-agents`、`app-shell`、`button`、`use-task-suggestions`、`task-suggestions`、`sessions-page`、`bundle`（包大小预算） |
| `tests/features/chat/` | 7 | `runTrace`、`run-trace-panel`、`run-trace-panel-matrix`、`trace-bubble`、`trace-bubble-session-switch`、`message-bubble-cycle`、`chat-session-stream-isolation`、`chatRuntimeStore`、`generating-indicator` |
| `tests/e2e/` | 4 | `a11y.spec.ts`（7 路由 axe + 2 路由 WCAG2.1AA）、`composer-validation.spec.ts`、`composer-attachment.spec.ts`、`dashboard-tasks.spec.ts` |

### 8.3 缺什么

| 领域 | 缺什么 |
|---|---|
| 视觉回归 | **没有** Playwright screenshot diff / Percy / Chromatic |
| ChatPage 集成 | `tests/features/chat/` 没有 `ChatPage.test.tsx`（除了 `chat-stream-state.test.ts` 在 hook 层） |
| ChatPage 端到端 | 缺少"打开 → 打字 → 收 SSE → 切会话 → 切回" 的 e2e |
| 错误路径 E2E | 没有网络断开 / 504 / 长时间无 done 的 e2e |
| i18n 视觉 | 缺少 en.json 在真实 DOM 的截图 |
| Mobile / 响应式 | 没有任何 mobile 视口测试，E2E 默认桌面 |
| 性能 | 仅有 `bundle.test.ts` 静态体积预算（JS < 700KB raw / CSS < 50KB raw），无真实 CWV 测试 |
| 可访问性 | 已用 axe 自动扫描（强项），但缺键盘 / 屏幕阅读器手动测试 |

### 8.4 `.playwright-mcp/` 目录

`git status` 列出大量 `.playwright-mcp/console-*.log` 与 `.yml` 文件（见 `git_status` 段）。这是 **Playwright MCP 服务在 IDE 内的诊断日志**：每次启 MCP server 或失败重试时落地。**不是测试产物**，是开发期"实时浏览器控制台 + DOM 快照"取证。

---

## 9. 与后端的协议

### 9.1 调用方式

- **HTTP 库**：原生 `fetch`（无 axios / ky / ofetch）。
- **统一入口**：`src/lib/api.ts:115-142` 暴露 `apiGet/apiPost/apiPut/apiPatch/apiDelete`，全部走 `request()`（`api.ts:56-113`）。
- **统一响应壳**：后端约定 `{ok: true, data: ...} | {ok: false, error: {code, message, details?}}`（`api.ts:86-94`）。`api.ts:90-92` 解析后抛 `ApiError(code, status, message)`。
- **27 个错误码**枚举在 `ApiErrorCode`（`api.ts:4-32`）：从 `SESSION_NOT_FOUND` 到 `INTERNAL_ERROR` 全覆盖；`Agent` 通过 `err.code === ApiErrorCode.PROVIDER_RATE_LIMITED` 等做分支处理。
- **dev 代理**：`vite.config.ts:25-27` 把 `/api` 反代到 `http://localhost:4321`。
- **i18n / 错误码**：`z.object` 兜底 schema（`api.ts:48-52`）防止非 `{ok}` 响应挂掉。

### 9.2 流式协议细节

- **使用原生 fetch POST + ReadableStream + 手写 SSE 解析**（`parseSseStream`，`lib/sse.ts:37-78`）。**没有用 EventSource**（因为需要 POST 传 body）、**没有用 WebSocket**。
- **SSE 帧格式**：标准 `event:` + `data:` 多行 + `\n\n` 分隔。**未实现 retry / last-event-id 续传**。
- **已知事件**白名单：`KNOWN_EVENTS`（`lib/sse.ts:8-28`）共 18 个，不在白名单的丢弃。
- **Enveloped 协议**：所有事件都包 `{sessionId, runId, streamId, seq, event, data}`（`types.ts:280-293`），允许前后端解耦。
- **客户端限速 / 重试**：
  - **主连接内 retry**：`MAX_RETRIES = 5`（`useChatStream.ts:44`），backoff `1s/2s/4s/8s/16s`（`useChatStream.ts:46`），但 **触发条件仅限「事件处理抛错」（`useChatStream.ts:1195-1207`）**，网络断 / EOF 不在此重试范围——EOF 由 `parseSseStream` 自然结束，若无 terminal 事件则 `finishRun('failed', 'error')`（`useChatStream.ts:1210-1219`）。
  - **整体重发（retry 按钮）**：复用 `clientMessageId` + 新 `runId`（`useChatStream.ts:1263-1283`）。
- **提交时超时**：`SUBMITTING_TIMEOUT_MS = 60_000`（`useChatStream.ts:45`），超时则 `run.status='failed'` + 用户可见错误。
- **取消**：`AbortController.signal` 立即中断 fetch；后端会通过 SSE `aborted` 事件反向确认（`useChatStream.ts:1176-1190`），但前端 abort 不等服务端 ack。

### 9.3 协议消息 schema 索引

| 端点 | 方法 | 入参 | 出参 | 位置 |
|---|---|---|---|---|
| `/api/sessions` | POST | `{kind: 'gconv'}` | `{session: {id}}` | `ChatPage.tsx:187-190` |
| `/api/sessions/:id/messages/stream` | POST | `{text, clientMessageId, runId, model?, thinkingLevel?}` | SSE stream | `useChatStream.ts:570-583` |
| `/api/sessions/:id/history` | GET | — | `{sessionId, revision, messages: SerializedMsg[]}` | `useChatStream.ts:420-450` |
| `/api/sessions` | GET | `?archived=bool` | `{sessions: SessionItem[], total, limit, offset}` | `features/sessions/useSessions.ts:23` |
| `/api/sessions/:id` | DELETE | — | 204 | `useSessions.ts:41` |
| `/api/models` | GET | — | `{models: ModelInfo[]}` | `ChatPage.tsx:60-65` |
| `/api/providers/active` | GET | — | provider | `ChatPage.tsx:68-72` |
| `/api/providers` | GET/POST/PUT/DELETE | — | provider[] | `features/providers/useProviders.ts` |
| `/api/skills`、`/api/tools`、`/api/agents` | GET | — | list | 各 useQuery |
| `/api/...` 还有更多（agents / skills / tools / dashboard） | — | — | — | `lib/query-keys.ts` |

**SSE event payload**（`types.ts:115-269`）共 18 种类型，分类：
- 生命周期：`message_start`、`message_delta`、`message_stop`、`done`、`error`、`aborted`
- 块：`content_block_start/delta/stop`、`thinking_delta`、`usage`
- 工具：`tool_use`、`tool_result`、`tool_progress`
- 上下文：`compaction`、`context_status`、`retry`、`provider_fallback`
- 心跳：`ping`

**注意**：未发现服务端 `ping` 的使用代码（`KNOWN_EVENTS` 包含但 dispatch 表无 case，落入 `default: break`，相当于 silent 丢弃）。

---

## 10. 优劣评估

### 10.1 流式渲染鲁棒性

**强**：
- **envelope 校验 + seq 去重**（`useChatStream.ts:653-673`）让中途乱序 / 重复帧不会污染 UI。
- **callback 闭包捕获不可变 runId**（`useChatStream.ts:663-666`）解决了"active run 切换瞬间"的竞态——这是"切回 A 多个气泡" bug 的根因修复。
- **rAF 文本批刷**把高频 delta 收敛到 1 帧 1 次 React 渲染，UI 不抖。
- **三处"以不可变身份代替瞬时 activeRunId"**（`updateMessages` 用 `runId` 而非 `activeRunId` 校验、`updateAssistantForRun` 用 runId 找目标、`markRunAwaitingPersistence` 在 session 上而非 run 上落索引）一致贯穿，run 终态后还能继续写。
- **EOF 兜底**：无 terminal 事件视为 `error`，保留 partial overlay 让用户能看到断在哪儿（`useChatStream.ts:1210-1219`，被 `chat-session-stream-isolation.test.tsx:933-990` 锁死）。
- **持久化收敛**是这套系统最复杂的部分之一。`mergePersistedWithOverlay` 三档规则覆盖了"identity 命中 / runId 命中 / 都不命中"；`mergeAssistantTextFromOverlay` 处理"persisted 已收敛但缺 final text"边界。
- **TTL + cap 淘汰**：`PENDING_PERSISTENCE_TTL_MS = 30min` + `MAX_PENDING_PERSISTENCE_PER_SESSION = 32`（`chatRuntimeStore.ts:30-31`）保证长时间挂着的 run metadata 不爆炸。

**弱**：
- **没有重连**。SSE 断流（网络抖动）即失败，需用户手动 retry。`MAX_RETRIES` 仅覆盖事件 handler 抛错。
- **`compaction`、`context_status`、`retry`、`provider_fallback` 事件被显式忽略**（`useChatStream.ts:947-951`），后端若推送这些事件，前端无视觉反馈。
- **没有 backpressure**：长流 rAF 缓冲没有上限，理论上一个超长 run 的 buffer 可能膨胀。
- **没有持久化的 `chat.runtime.draft` 同步**——`SessionRuntime.draft?` 字段（`chatRuntimeStore.ts:88`）已声明但未实现（`Composer` 用 `useState`）。

### 10.2 Trace / Tool Call 可视化

**强**：
- **v4 双布局**（`MessageBubble.tsx:80-130`）从结构上封堵了"trace 边框+紫侧条消失 / final 内容裸奔"——三个独立 DOM 节点 + 独立 key。
- **派生层纯函数化**（`runTrace.ts`，被 `runTrace.test.ts` 450+ 行覆盖）：call/result 合并、孤儿 result 兜底、thinking 与 tool 交叉、status→摘要文案的 7 分支。
- **KeyParam pill**（`runTrace.ts:296-330`）把 URL/路径/查询压成短 chip，避免视觉噪声。
- **`prefers-reduced-motion` 全覆盖**（`globals.css:604-622`），无障碍考虑完整。
- **streaming 状态可读性**：`streamState` 四态（`thinking/generating/tool_executing/done`）+ 摘要文案"正在思考 / 正在执行 X / 正在整理回答 / 已完成 N 步"切换无歧义。

**弱**：
- **工具名映射表**仅 2 个（`web_search`、`web_fetch`，`runTrace.ts:78-81`），未知工具原名展示，对中文化一致性有损。
- **trace panel 没有时间戳**（仅 `durationMs`），用户无法判断"刚刚 / 5 分钟前"。
- **tool 详情折叠展开**没有"全屏"快捷键，文本长时只能滚。
- **Markdown 在 trace 详情里**也走 `react-markdown`（`RunTracePanel.tsx:304`），但和正文 `prose` 样式在紧凑模式 `prose-compact` 下没有视觉差异——折叠区与正文一致或偏暗，全靠 `text-text-muted`。

### 10.3 错误处理与可恢复性

**强**：
- **`status === 'error' && isCurrentAssistant` 时 header 显示"重试"按钮**（`ChatPage.tsx:381-388`），一键 `retry()` 复用 `clientMessageId`。
- **HTTP 409 特殊处理**（`useChatStream.ts:594-597`）—— 后端拒绝"active run 已存在"时，前端不再尝试，避免雪崩。
- **错误码统一 27 个**（`ApiErrorCode` 枚举）覆盖 session/provider/skill/agent/网络 5 大类，调用方可按 `err.code` 分支。
- **abort 显式区分 `aborted` 与 `error`**（`finishRun('aborted', 'aborted')` vs `finishRun('failed', 'error')`），UI 重置入口不同。
- **localStorage 持久化** `my-agent.activeSession` 用于恢复上次会话（`ChatPage.tsx:80-83`），但**未自动 navigate**，只是记忆。

**弱**：
- **网络断**只走 `AbortError` 路径，但**没有离线检测 / retry 间隔提示**。
- **错误展示**仅在 header 一个小红 pill 出现"重试"按钮（`ChatPage.tsx:380-388`），错误本身细节 `❌ ${errMsg}`（`useChatStream.ts:608, 1150`）出现在 assistant 消息气泡里，没有 toast。
- **`submitting 60s 超时**后**不自动 retry**——用户得手动再点发送。
- **`logger.error('❌ 流式连接在 terminal 事件前关闭', ...)`**（`useChatStream.ts:1214`）仅在 console，没有上报到 telemetry。

### 10.4 移动端 / 可访问性

**强**：
- **`@axe-core/playwright` 跑 7 路由 + 2 路由 WCAG 2.1 AA 严格扫描**（`tests/e2e/a11y.spec.ts`），这是真 e2e a11y 而非单测。
- **`aria-live="polite"` 覆盖消息列表**（`MessageList.tsx:90`）和 `GeneratingIndicator`（`GeneratingIndicator.tsx:17`）。
- **`role="log"`**（`MessageList.tsx:90`）、**`role="status"`**（`GeneratingIndicator.tsx:17`）、**`role="listbox/option"`**（`ContextDropdown.tsx:104-107`）、**`role="alert"`**（`Composer.tsx:165`）—— 语义角色基本到位。
- **`focus-visible` ring 显式**（`globals.css:598-602`、`Composer.tsx`、`RunTracePanel.tsx:116, 250`）。
- **`prefers-reduced-motion`**（`globals.css:604-622`）—— 减少动画。
- **IME 组合态守卫**（`Composer.tsx:127-135`）—— 中文输入法按 Enter 不会误发。

**弱**：
- **没有 mobile / 窄视口 e2e**。`ChatPage` 的 `px-5` padding 在 < 640px 没有特别调整。
- **Composer 内的 `modelSelector`**（`ChatPage.tsx:308-342`）使用自定义 range slider + 绝对定位 thumb——移动端触屏行为未验证。
- **`TraceBubble` 灰底硬色 `#f1f2f4`**（`TraceBubble.tsx:28`）—— dark mode 仍是这个固定值，**没有 `[data-theme="dark"]` 覆盖**。这是 dark mode 视觉死区。
- **聊天滚动容器** 没有 `tabindex="0"`，键盘用户无法纯键浏览历史。
- **`onCopy`（`MessageBubble.tsx:60-66`）** 没有"复制成功"的 `aria-live` 公告。

### 10.5 综合

这是一个**「流式协议正确性优先」**的前端：流隔离、并发 run 身份、持久化收敛都被严防死守；UI 美观度与可访问性是「够用就行」。可以总结为：

| 维度 | 评分 | 证据 |
|---|---|---|
| 流式鲁棒性 | ★★★★★ | envelope/seq/runId 三重守护 + 5 套回归测试 |
| 多会话隔离 | ★★★★★ | 14+ 测试 + LRU + TTL |
| Trace 可视化 | ★★★★☆ | v4 双布局 + 派生纯函数 + 7 分支摘要 |
| 错误恢复 | ★★★☆☆ | 有 retry/重发，但网络断 = 失败 |
| 移动端 | ★★☆☆☆ | 桌面优先；无 mobile e2e |
| 可访问性 | ★★★★☆ | axe 全绿 + aria 完整 + reduced-motion |
| 视觉设计 | ★★★★☆ | Orkas 风格 + token 体系 + 自定义 slider |
| 测试覆盖 | ★★★★☆ | 32 unit + 7 feature + 4 e2e；缺 visual regression |

---

## 11. 建议改进 Top 5（按优先级）

### P1 · 修 TraceBubble dark mode 死区

- **现状**：`web/src/components/chat/TraceBubble.tsx:28` 硬编码 `bg-[#f1f2f4]`，`RunTracePanel.tsx:105` 硬编码 `bg-white`，globals.css 中也无 `[data-theme="dark"]` 覆盖。
- **影响**：暗色主题下出现"亮灰/亮白"光块，破图。
- **建议**：把 `bg-[#f1f2f4]` 改成 `bg-surface-hover` 或新增 `--color-trace-bubble` 变量；`RunTracePanel` 改 `bg-surface`。
- **改动量**：2 行 + 加暗色变量。

### P2 · 给 `submitting` 超时与 EOF 错误加 UX 反馈

- **现状**：`useChatStream.ts:537-549` 的 60s 超时仅 console error；`useChatStream.ts:1214-1218` 的 EOF 同样静默。
- **影响**：用户不知道发生了什么、不知道要不要重试。
- **建议**：在 `ChatPage` header 处复用现有"重试"按钮逻辑（`ChatPage.tsx:381-388`），让它在 `status === 'error'` 时始终可见；并把 `errMsg` 透传到按钮 title / 一条 toast。
- **改动量**：~20 行 + i18n 字符串。

### P3 · 工具名映射 + streaming 进度抽象

- **现状**：`runTrace.ts:78-81` 仅映射 2 个工具名；新工具零成本。
- **影响**：用户对系统支持哪些工具无感知；后端加新工具后中文 label 滞后。
- **建议**：①把 `TOOL_ACTION_LABELS` 提到独立 `toolNameLabels.ts`，加 i18n 键；②在 `RunTracePanel` 摘要行对未知工具显示 `未知工具：X` 而非原名。
- **改动量**：~30 行 + en/zh 词条。

### P4 · 移动端真机 / 真视口测试

- **现状**：所有 e2e 默认桌面（Playwright 默认 1280×720）。`ChatPage` / `Composer` 在 < 640px 视口下未验证。
- **影响**：移动 web 用户体验未量化。
- **建议**：①给 `playwright.config.ts` 加 mobile projects（iPhone 14 / Pixel 7 viewport）；②在 `ChatPage` / `Composer` 关键断点（`sm:` / `md:`）加审计；③ 跑一遍截图比对。
- **改动量**：~50 行 + 设计调整若干。

### P5 · 重连（断流恢复）支持

- **现状**：`useChatStream.ts:620-1232` 主循环没有对网络断开做重连；EOF 无 terminal 即失败（`useChatStream.ts:1210-1219`）。
- **影响**：移动网络 / NAT 切换导致流断开后必须用户手动 retry。
- **建议**：①识别"已收到 `message_start` 但连接断开"的场景（不是无 terminal 的完全空流）；②用 `clientMessageId` 调后端 `GET /api/sessions/:id/messages/:clientMessageId/replay` 拿到 missed events（需后端支持）；③若后端无 replay 能力，至少在 `status='reconnecting'` 出现时做 1-2 次透明重连。
- **改动量**：后端配合 + 约 80 行前端 + 协议扩展。

### 备选改进（非 P1，但价值高）

- **tokens.ts 与 globals.css 双源**：tokens.ts 几乎死代码。统一到 CSS 变量后用 JS 读 `getComputedStyle` 或在 Tailwind 4 用 `@theme inline` 引用，可能更一致。
- **`pending-message.ts` 用模块级 Map**：SPA 单客户端是 OK 的，但 SSR / 多 tab 同步时会丢。考虑用 BroadcastChannel。
- **Composer `modelSelector` 由 ChatPage 注入**：合理 prop composition，但 modelSelector 实际只跟 ChatPage 有关联，提取成 `<ChatHeader>` 自包含组件可简化 ChatPage（451 行）。
- **bundle.test.ts 仅看 raw 体积**：可以加 `vite-plugin-bundlesize` 或 `size-limit` 给 PR 检查。
- **没有 `ChatPage.test.tsx`**：核心编排组件没有 DOM 级集成测试（只有 hook 层）。

---

## 12. 关键文件索引（供后续改动查阅）

| 关注点 | 入口 | 行数 |
|---|---|---|
| 流式核心 | `web/src/features/chat/useChatStream.ts` | 1287 |
| 流式 store | `web/src/features/chat/chatRuntimeStore.ts` | 858 |
| 协议类型 | `web/src/features/chat/types.ts` | 305 |
| Trace 派生 | `web/src/features/chat/runTrace.ts` | 331 |
| 跨实例消息 | `web/src/features/chat/pending-message.ts` | 49 |
| SSE 解析 | `web/src/lib/sse.ts` | 102 |
| HTTP 客户端 | `web/src/lib/api.ts` | 143 |
| 错误码 | `web/src/lib/error.ts` | 33 |
| Chat 编排页 | `web/src/pages/ChatPage.tsx` | 451 |
| 消息气泡 | `web/src/components/chat/MessageBubble.tsx` | 132 |
| Trace 面板 | `web/src/components/chat/RunTracePanel.tsx` | 440 |
| Trace 气泡 | `web/src/components/chat/TraceBubble.tsx` | 33 |
| 输入框 | `web/src/components/chat/Composer.tsx` | 268 |
| 消息列表 | `web/src/components/chat/MessageList.tsx` | 110 |
| 全局壳 | `web/src/components/layout/AppShell.tsx` | 18 |
| 侧边栏 | `web/src/components/layout/Sidebar.tsx` | 148 |
| 全局样式 | `web/src/styles/globals.css` | 622 |
| 设计 token（TS） | `web/src/styles/tokens.ts` | 18 |
| 路由表 | `web/src/routes.tsx` | 30 |
| 关键回归 | `web/tests/features/chat/chat-session-stream-isolation.test.tsx` | 1395 |
| Trace 切会话 | `web/tests/features/chat/trace-bubble-session-switch.test.tsx` | 456 |
| a11y E2E | `web/tests/e2e/a11y.spec.ts` | 45 |

---

## 13. 参考资料 / 引用来源

- `web/package.json` — 依赖与脚本
- `web/vite.config.ts` / `web/vitest.config.ts` / `web/tsconfig.json` / `web/postcss.config.js` / `web/playwright.config.ts` — 构建配置
- `web/index.html` / `web/src/main.tsx` / `web/src/App.tsx` / `web/src/routes.tsx` — 入口与路由
- `web/src/features/chat/*` — 核心流式实现
- `web/src/components/chat/*` / `web/src/components/layout/*` — UI
- `web/src/lib/{api,sse,cn,error,logger,query-keys,i18n}.ts` — 基础设施
- `web/src/styles/{globals.css,tokens.ts}` — 样式
- `web/tests/features/chat/chat-session-stream-isolation.test.tsx` — 关键回归
- `web/tests/features/chat/trace-bubble-session-switch.test.tsx` — 切会话守卫
- `web/tests/e2e/a11y.spec.ts` — 可访问性 E2E
- `.ai-runtime-artifacts/specs/2026-08-11-run-trace-dual-layout-spec.md`（在注释中被引用）
- `.ai-runtime-artifacts/contracts/2026-08-10-contract-run-trace.md`（在 `runTrace.ts` 注释中被引用）
- `.ai-runtime-artifacts/specs/2026-08-09-chat-composer-redesign-spec.md`（在 `Composer.tsx` 注释中被引用）

---

*报告完。所有结论均来自上述文件的静态分析；如需更深入地了解某模块的细节，可基于本报告"第 12 节 关键文件索引"进一步读取。*
