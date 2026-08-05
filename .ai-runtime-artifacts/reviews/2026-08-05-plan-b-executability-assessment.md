# Plan B 可执行性评估

**评估日期**: 2026-08-05
**评估对象**: [2026-08-04-plan-b-four-screens.md](../../docs/superpowers/plans/2026-08-04-plan-b-four-screens.md)
**评估方法**: 对照现有代码库逐项验证 API 契约、DOM 结构、CSS 变量、IPC 通道

---

## 1. 总评

**结论：方案 B 可以执行 ✅**

四个页面的 UI 层实现（HTML/CSS/JS）与前端的 API 通信层 (`api.js`) 均已对齐。存在 1 个需要修正的 IPC 通道 bug（cancel），和若干已知的 Phase 2 限制（mock 数据 / 占位 IPC）。这些问题不影响 Plan B 的范围交付。

---

## 2. 前提条件验证

| 声明 | 状态 | 证据 |
|------|------|------|
| Plan A（Electron 壳 + CSS 基础设施 + IPC）已完成 | ✅ 属实 | `electron/main.ts`, `preload.cjs`, 4 个 CSS 文件, `index.html` 均存在 |
| `App.navigate()` 路由已就位 | ✅ 属实 | [app.js:23-35](../../electron/renderer/js/app.js#L23-L35) |
| `api.js` 通信层已就位 | ✅ 属实 | [api.js:1-63](../../electron/renderer/js/api.js) 覆盖 sessions/chat/config/skills/providers/app |
| marked (Markdown 渲染) 已引入 | ✅ 属实 | `vendor/marked.min.js` + `modules/markdown.js` |
| `window.myAgent.stream()` 可用 | ✅ 属实 | [preload.cjs:12-28](../../electron/preload.cjs#L12-L28) |
| `window.myAgent.invoke()` 可用 | ✅ 属实 | [preload.cjs:9](../../electron/preload.cjs#L9) |

---

## 3. API 契约逐项对照

### 3.1 会话 (sessions)

| 调用 | Plan 假设 | 实际 IPC | 匹配 |
|------|-----------|----------|------|
| `api.sessions.list({ limit: 50 })` | `{ sessions, total }` | `{ sessions: SessionMeta[], total: number }` | ✅ |
| `api.sessions.get(id)` | `session.name`, `session.model` | 返回 `SessionMeta \| null`，包含 name/model | ✅ |
| `api.sessions.delete(id)` | `{ ok: true }` | `{ ok: true }` | ✅ |
| `api.sessions.rename(id, name)` | `{ ok: true }` | `{ ok: true }` （两个独立参数传递） | ✅ |

> IPC 通道 `sessions:rename` 接收 `(event, id, name)` 两个独立参数。`api.js` 通过 `window.myAgent.invoke("sessions:rename", id, name)` 传递，`ipcRenderer.invoke` 会将后续参数展开，正确匹配。

### 3.2 对话 (chat)

| 调用 | Plan 假设 | 实际 IPC | 匹配 |
|------|-----------|----------|------|
| `api.chat.send({ message, sessionId })` | 流式事件 | `chat:stream` 占位实现（echo） | ⚠️ |
| `stream.on("text_delta", cb)` | `ev.text` | `payload.text` → preload 提取为 `ev.text` | ✅ |
| `stream.on("done", cb)` | `ev.sessionId` | `payload.sessionId` → preload 提取正确 | ✅ |
| `stream.on("tool_start", cb)` | `ev.name`, `ev.input` | **占位 IPC 不发送此事件** | ⚠️ 占位 |
| `stream.on("tool_end", cb)` | `ev.result`, `ev.isError` 等 | **占位 IPC 不发送此事件** | ⚠️ 占位 |
| `stream.on("retry", cb)` | `ev.attempt`, `ev.reason` | **占位 IPC 不发送此事件** | ⚠️ 占位 |
| `stream.on("error", cb)` | `ev.message` | **占位 IPC 不发送此事件** | ⚠️ 占位 |

> **说明**: `chat:stream` 当前为 echo 占位实现（[chat.ts:5-15](../../src/ipc/chat.ts#L5-L15)），仅发送 `text_delta` 和 `done`。Plan B 的 chat.js 为 tool_start / tool_end / retry / error 注册了监听器——这些代码在 IPC 升级后将直接生效，属于**前向兼容的预留代码**。

### 3.3 Skills

| 调用 | Plan 假设 | 实际 IPC | 匹配 |
|------|-----------|----------|------|
| `api.skills.list()` | Skill 对象数组 | 返回 `[]`（占位） | ⚠️ → 触发 mock fallback |
| `api.skills.setEnabled(id, enabled)` | `{ ok: true }` | `{ ok: true }` | ✅ |

> `skills:list` 返回空数组（[skills.ts:5-7](../../src/ipc/skills.ts#L5-L7)）。Plan 的 `SkillsPage.load()` 对此做了防御：空响应时调用 `getMockSkills()` 展示 9 个示例 Skill。**Skills 页始终展示 mock 数据**。

### 3.4 Providers

| 调用 | Plan 假设 | 实际 IPC | 匹配 |
|------|-----------|----------|------|
| `api.providers.list()` | `ProviderEntry[]` (id, name, provider, isEnabled, models, baseUrl) | `ProviderEntry[]` 包含所有字段 | ✅ |
| `api.providers.save({ id?, provider, name, apiKey, baseUrl, models })` | 返回保存后的 Provider | `upsertProvider(input)` 接受相同字段 | ✅ |
| `api.providers.delete(id)` | `{ ok: true }` | `{ ok: true }` | ✅ |

### 3.5 应用版本

| 调用 | Plan 假设 | 实际 IPC | 匹配 |
|------|-----------|----------|------|
| `api.app.getVersion()` | `{ version, electron, node }` | `{ version, electron, node, platform }` | ✅ |

---

## 4. 发现的问题

### 🔴 问题 1：`stream.cancel()` IPC 通道不匹配（需修正）

- **位置**: [preload.cjs:26](../../electron/preload.cjs#L26) vs [chat.ts:18](../../src/ipc/chat.ts#L18)
- **现象**: `stream.cancel()` 发送 IPC 到 `chat:stream:cancel`，但 IPC handler 监听的是 `chat:cancel`
- **影响**: 用户点击「停止」按钮后，取消请求无法到达主进程。UI 侧流式光标会停止更新（`ChatPage.cancel()` 清空了 `currentStream`），但后端不知道已取消。
- **修复建议**: 将 `chat.ts` 的 handler 从 `ipcMain.handle("chat:cancel", ...)` 改为 `ipcMain.on("chat:stream:cancel", ...)`，或修改 `preload.cjs` 的 cancel 发送统一走 `invoke` 模式。

### 🟡 问题 2：Stream 事件监听器未清理（内存泄漏）

- **位置**: [chat.js (plan):409-485](../../docs/superpowers/plans/2026-08-04-plan-b-four-screens.md#L409-L485)
- **现象**: 每个 `stream.on(event, cb)` 在 `ipcRenderer` 上注册监听器，`.on()` 返回 unsubscribe 函数但 plan 代码从未调用
- **影响**: 长时间运行后，`ipcRenderer` 上累积大量死监听器（streamId 不匹配故不会误触发，但占用内存）
- **严重度**: 低。桌面应用单次会话通常不会发送上百次流式请求。建议在 `done` / `error` 事件中收集 unsubscribe 函数并批量清理，或在 Plan C 中重构。

### 🟡 问题 3：已知的 Phase 2 限制

| 限制 | 影响范围 | 后续计划 |
|------|----------|----------|
| `chat:stream` 仅 echo，无工具调用/重试/错误事件 | 对话页只能验证基础消息流 | Plan C 接入 AgentRunner |
| `skills:list` 返回空 | Skills 页永久展示 mock 数据 | Plan C skill-service |
| `ChatPage.loadHistory()` 是 TODO | 切换已有会话不加载历史 | Plan C |
| 设置页 tab 2-6 表单数据不持久化 | Tools/Paths/Context/Appearance/Developer 设置仅 UI 展示 | Plan C 配置扩展 |
| 会话管理 project 筛选为客户端侧 | 筛选不够精确 | 后续 IPC 扩展 |

---

## 5. 代码质量观察

### 正面

- **防御性编程**: Skills 页对空后端响应做了 mock fallback；ChatPage 对 marked 未加载做了降级（`modules/markdown.js` 中的 `escapeHtml` fallback）
- **XSS 防护**: 所有页面 JS 均包含 `escapeHtml`/`esc` 方法，用户输入和 API 返回值经过转义
- **前向兼容**: chat.js 为尚未实现的流式事件（tool_start/tool_end/retry/error）注册了监听器，IPC 升级后无需修改前端代码
- **重复绑定防护**: `ChatPage._initialized` 标志位防止多次导航到对话页时重复绑定事件
- **IME 组合输入**: `chat.js` 正确处理了 `e.isComposing` 和 `keyCode === 229`（中文输入法）
- **CSS 变量一致性**: Plan 中所有 CSS 使用的变量名与 `variables.css` 完全一致

### 需注意

- `escapeHtml` 在 `modules/markdown.js` 中已定义一次，又在每个 page JS 中重复定义。建议统一引用 `modules/markdown.js` 中的版本
- `SettingsPage.renderModelsTab()` 销毁并重建 DOM（innerHTML），依赖 `bindEvents()` 重新绑定。如果后续扩展忘记调用，事件会丢失
- `SessionsPage` 的行菜单使用 `confirm()` / `prompt()` 而非自定义浮层——功能可用但体验粗糙

---

## 6. 执行建议

### 修正清单（实现时即改）

1. **修复 `stream.cancel()` 通道**: 将 `chat.ts` 的 handler 改为监听 `chat:stream:cancel`（`ipcMain.on` 模式），或统一 preload 的 cancel 走 `invoke`
2. **验证布局结构**: 实现 Task 2 Step 2 时，确认 `#session-panel` 是 `#app` 的直接子元素（与 `#sidebar`、`#main` 平级），而非 `#main` 内部

### 实现顺序

Task 1 → 2 → 3 → 4 → 5 的顺序是合理的。Task 1 的 CSS 和 Task 2 的 JS 互不阻塞（CSS 先写好不碍事）。每个 Task 内部 Step 的依赖链紧凑。

### 验证策略

- Task 2 验证时（`npm run dev`）：由于 `chat:stream` 是 echo 占位，实际看到的是 `Echo: <用户输入>` 而非真正的 Agent 回复。这是预期的。
- Task 3-5 验证时：由于依赖 `sessions:list` / `skills:list` / `providers:list`，确认数据库中已有测试数据或接受空列表状态。

---

## 7. 结论

Plan B 的设计与现有代码库高度一致。API 层 (`api.js`) 与 IPC 层 (`src/ipc/*.ts`) 的契约在关键路径上对齐。**4 个页面的 UI 实现均可执行**，唯一的阻塞性 bug（cancel 通道不匹配）是一行修复。已知的占位限制（echo/mock/TODO）不影响 Plan B 的交付范围，且 Plan 中已明确标注了后续 Plan C 的承接点。

**建议：执行前先修复 cancel 通道，其余按 Plan 顺序推进。**
