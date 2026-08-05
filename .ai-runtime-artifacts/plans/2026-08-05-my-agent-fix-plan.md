---
artifact: implementation-plan
route: superpowers:writing-plans
skills:
  - writing-plans
  - orchestration
skills_evidence:
  - ~/.claude/skills/writing-plans/SKILL.md
dispatch: .ai-runtime-artifacts/plans/2026-08-05-my-agent-fix-dispatch.md
source:
  - .ai-runtime-artifacts/specs/2026-08-05-my-agent-fix-spec.md
  - harness-kit/core/routing.md
  - harness-kit/project.profile.md
  - harness-kit/context-map.md
created_at: 2026-08-05
status: draft
approved: false
---

# My Agent 功能修复与完善 — 实施计划

## Goal

修复 Electron 桌面端 3 大断裂点（Chat IPC / Skills IPC / Config 双存储），3 Phase 渐进交付。

## Architecture & Tech Stack

不变。保持 Electron 33 + Vanilla JS 渲染进程 + TypeScript 主进程 + better-sqlite3 存储。

## Constraints

- 不改 Vanilla JS 架构（不引入 React/Vue/Alpine.js）
- 不修改 AgentRunner 核心引擎逻辑
- 不修改 preload IPC 协议
- better-sqlite3 用 `createRequire` 懒加载（已有模式）
- 配置统一到 JSON 文件（`app.getPath("userData")/config.json`）

## Phase 依赖

```
GROUP-1 (Phase 1: 对话核心)
  │
  ▼
GROUP-2 (Phase 2: 管理功能)
  │
  ▼
GROUP-3 (Phase 3: Skills + UI 打磨)
```

## GROUP-1 — Phase 1：对话核心里程碑

**Goal:** Chat IPC 接入 AgentRunner，会话可创建/恢复/持久化。

### Task 1.1 — Provider 工厂注册
- **文件:** [src/providers/index.ts](src/providers/index.ts)
- **改动:** 模块加载时 `registerFactory("deepseek", ...)` 自动注册。优先读 DB `providers` 表配置，fallback 环境变量 `DEEPSEEK_API_KEY`。
- **验证:** `npm run check` 通过

### Task 1.2 — Config 读写对齐 + Provider 测试
- **文件:** [src/ipc/config.ts](src/ipc/config.ts) + [src/storage/config-store.ts](src/storage/config-store.ts) (新)
- **改动:** 新增 `ConfigStore` 统一 JSON 文件读写；`config:update` 改为写 JSON 文件（与 `config:get` 同源）；`config:get` 合并 JSON + SQLite configs 表；`providers:test` 调用 `DeepSeekProvider.validateAuth()` 真实验证
- **验证:** `npm run check` 通过

### Task 1.3 — Chat IPC 重写：接入 AgentRunner
- **文件:** [src/ipc/chat.ts](src/ipc/chat.ts) + [src/ipc/index.ts](src/ipc/index.ts)
- **改动:** `chat:stream` → 创建/获取 AgentRunner 实例 → `runStream()` → 逐事件转发（text_delta/tool_start/tool_end/retry/done/error）；`chat:cancel` → AbortController.abort()；`registerChatIpc` 接受 runner factory 参数
- **前置:** Task 1.1, Task 1.2
- **验证:** `npm run check` 通过

### Task 1.4 — 主进程入口 + Agent 初始化
- **文件:** [electron/main.cjs](electron/main.cjs) + 删除 [electron/main.ts](electron/main.ts)
- **改动:** 新增 `initAgent()` — 读取 config、注册 Provider factory、创建 AgentRunner 单例（BUILTIN_TOOLS + SessionStore）；合并 `main.ts` 逻辑到 `main.cjs`；IPC 初始化时注入 runner
- **前置:** Task 1.3
- **验证:** `npm run check` 通过；Electron 窗口正常启动

### Task 1.5 — 会话持久化链路
- **文件:** [src/ipc/sessions.ts](src/ipc/sessions.ts)
- **改动:** 新增 `sessions:getMessages` — 从 PersistentSession JSONL 读取消息列表；对话完成后 `upsertSession` 更新 SQLite 元数据 + `logUsage` 记录 token
- **前置:** Task 1.3
- **验证:** `npm run check` 通过

### Task 1.6 — Chat 页面：历史加载 + 新会话
- **文件:** [electron/renderer/js/pages/chat.js](electron/renderer/js/pages/chat.js)
- **改动:** `loadHistory()` 调用 `sessions:getMessages` 渲染历史消息；`newSession()` 更新 UI + session 列表；`cancel()` 调用 `api.chat.cancel()`；流结束后刷新 session 列表
- **前置:** Task 1.4, Task 1.5
- **验证:** Electron 窗口对话页可加载历史

## GROUP-2 — Phase 2：管理功能

**Goal:** 设置页 6 标签页全通、会话管理完整、Provider 管理可用。

### Task 2.1 — 设置页重写
- **文件:** [electron/renderer/js/pages/settings.js](electron/renderer/js/pages/settings.js)
- **改动:** 模型 tab → 从 Provider DB 动态渲染；工具 tab → 从 BUILTIN_TOOLS 动态渲染 toggle；6 个 tab 全部 save() 通；主题即时切换；Provider 表单验证
- **前置:** GROUP-1 完成
- **验证:** 设置页各 tab 保存后可回读

### Task 2.2 — 会话管理完善
- **文件:** [electron/renderer/js/pages/sessions.js](electron/renderer/js/pages/sessions.js) + [src/ipc/sessions.ts](src/ipc/sessions.ts)
- **改动:** 导出功能（JSON + Markdown 下载）；归档按钮接线；搜索服务端化；批量操作确认弹窗
- **前置:** GROUP-1 完成
- **验证:** 会话管理页导出/归档功能可用

## GROUP-3 — Phase 3：Skills + UI 打磨

**Goal:** Skills 真实数据、暗色主题、UI 动画、代码清理。

### Task 3.1 — Skills IPC 接入 SkillLoader
- **文件:** [src/ipc/skills.ts](src/ipc/skills.ts)
- **改动:** `skills:list` → `SkillLoader.scan()` + 同步 DB skills_index；`skills:get` → 读 SKILL.md；`skills:setEnabled` → 写 DB
- **前置:** GROUP-2 完成
- **验证:** `npm run check` 通过

### Task 3.2 — Skills 页面去 Mock
- **文件:** [electron/renderer/js/pages/skills.js](electron/renderer/js/pages/skills.js)
- **改动:** 去掉 `getMockSkills()`；从 IPC 真实数据渲染；分类筛选；启停 toggle 接线；卡片点击查看详情
- **前置:** Task 3.1
- **验证:** Skills 页显示扫描到的真实 Skill

### Task 3.3 — 暗色主题 + UI 打磨
- **文件:** [electron/renderer/css/variables.css](electron/renderer/css/variables.css) + [electron/renderer/css/theme-dark.css](electron/renderer/css/theme-dark.css) (新) + [electron/renderer/js/app.js](electron/renderer/js/app.js)
- **改动:** CSS 变量 `[data-theme="dark"]` 覆盖；hash 路由（`#chat`/`#sessions`/`#skills`/`#settings`）；消息入场动画；错误重试按钮
- **前置:** GROUP-2 完成
- **验证:** 暗色主题覆盖所有页面；路由支持浏览器前进/后退

## Done Criteria

按 `harness-kit/references/definition-of-done.md` 逐项：

- [ ] `npm run check` (tsc --noEmit) 通过
- [ ] `npm test` (vitest run) 通过，无回归
- [ ] Electron 窗口正常启动，对话页可发送消息并收到 LLM 回复
- [ ] 会话创建后刷新会话列表可见
- [ ] 设置页 6 tab 保存后刷新可回读
- [ ] Skills 页显示真实扫描到的 Skill
- [ ] 暗色主题切换即时生效
- [ ] 删除冗余 `electron/main.ts`

## Verification

| Phase | 命令 | 预期 |
|-------|------|------|
| 全部 | `npm run check` | 无类型错误 |
| 全部 | `npm test` | 全部通过 |
| P1-P3 | `npm run dev` | Electron 窗口启动 + 对话+设置+Skills 可用 |

## Next

**（写入后须暂停 — 见 `harness-kit/core/routing.md` § 阶段门禁）**

- 计划确认 → 说「开始实现」或「并行执行」
- 需要调整 → 直接说修改意见
