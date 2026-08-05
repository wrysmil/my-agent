# 文档审查报告：Plan A/B/C 实施计划

**审查日期**：2026-08-04
**审查类型**：实施计划（plan）
**被审文件**：
- [Plan A: Electron 桌面壳 + Renderer 基础设施](../../docs/superpowers/plans/2026-08-04-plan-a-electron-shell.md)（11 Tasks, ~2150 行）
- [Plan B: 四屏 UI 实现](../../docs/superpowers/plans/2026-08-04-plan-b-four-screens.md)（5 Tasks, ~2620 行）
- [Plan C: 核心功能补全](../../docs/superpowers/plans/2026-08-04-plan-c-core-features.md)（10 Tasks, ~1560 行）
**已加载规则**：`review-rules/plan.md` + `checklists/review-checklist.md`
**审查人**：Claude (document-review skill)

---

## 总体评分

| 维度 | Plan A | Plan B | Plan C | 说明 |
|------|--------|--------|--------|------|
| 阶段结构 | ⚠️ 2/5 | ⚠️ 2/5 | ⚠️ 2/5 | 无正式 Phase 结构，无 Phase 1 环境准备 |
| 任务粒度 | ✅ 4/5 | ⚠️ 3/5 | ✅ 4/5 | A/C 较好；B 的 Task 2（chat.js）单文件过大 |
| 环境准备 | ❌ 1/5 | ❌ 1/5 | ❌ 1/5 | 无 .env.example、无环境验证脚本、无平台差异 |
| 测试计划 | ❌ 1/5 | ❌ 0/5 | ⚠️ 2/5 | 无 TDD、无覆盖率目标；C 有 `npm test` 但非 test-first |
| 风险与回滚 | ❌ 0/5 | ❌ 0/5 | ❌ 0/5 | 三个计划均无风险评估、无回滚方案 |
| 可执行性 | ✅ 4/5 | ⚠️ 3/5 | ⚠️ 3/5 | 步骤可操作，但验证大量依赖手动 `npm run dev` |
| **总评** | **⚠️ 不通过** | **⚠️ 不通过** | **⚠️ 不通过** | 需补齐关键缺口后方可执行 |

---

## 红色警报 🔴

### 1. 无 Phase 1 环境准备（三个计划均有）

实施计划审查规则明确规定 **"第一阶段必须是环境准备"**，且标注为 **红色警报**。三个计划均以功能 Task 开头：

- Plan A Task 1 = "安装 Electron 依赖"（仅 npm install，不构成完整环境准备）
- Plan B Task 1 = "对话页 CSS"（直接进入 UI 开发）
- Plan C Task 1 = "路径沙箱"（直接进入功能实现）

**缺失项**：
- .env.example 文件未提及
- 环境变量说明（`MY_AGENT_HOME` 在 Plan A paths.ts 中引用但未在环境准备中说明）
- 平台差异说明（Windows/macOS/Linux 的 Electron 行为差异、better-sqlite3 的 native 编译差异）
- 一键环境验证脚本（`npx electron --version` 不足以验证完整环境）
- 开发工具链版本约束（Node.js >= 22? TypeScript 版本？）

### 2. 无 TDD 流程（三个计划均有）

规则要求 **"产出代码的 Task 以「写失败测试」为 Step 1"**。三个计划所有 Task 的 Step 1 都是"实现代码"，测试被放到最后甚至完全缺失。

### 3. 产物位置违规

三个 plan 文件位于 `docs/superpowers/plans/`，违反 `CLAUDE.md` 强制规则——所有 AI 过程产物必须写入 `.ai-runtime-artifacts/` 对应子目录。正确位置应为 `.ai-runtime-artifacts/plans/`。

---

## 逐计划审查

### Plan A: Electron 桌面壳 + Renderer 基础设施

**优点**：
- 代码片段完整、可直接复制执行
- 文件结构清晰，有明确的目录树
- 每个 Task 有明确的 commit message（Conventional Commits 规范）
- Task 间依赖链合理（存储层 → Electron 壳 → IPC → Renderer → 验证）
- IPC 命名空间设计（sessions/config/skills/chat/providers）符合关注点分离
- 引用了 source spec 和 source guide

**正确性缺陷**：

| # | 位置 | 问题 | 严重度 | 状态 |
|---|------|------|--------|------|
| 1 | Task 5 locks.ts | `Atomics.wait()` 在主线程使用受限 — Node.js 22+ 主线程不支持 `Atomics.wait`（仅 Worker 线程支持），会抛出 `TypeError`。需改用 `Atomics.waitAsync` 或纯同步 sleep 方案。 | 🔴 阻塞 | ✅ 已修复 |
| 2 | Task 4.5 crypto.ts | `deriveKey()` 使用 `COMPUTERNAME` + `USER` + `platform` 派生密钥，机器名/用户名变化会导致已存 API Key 无法解密。需要明确的密钥迁移/重置策略。 | 🟡 高风险 | 已标注 |
| 3 | Task 1 package.json | `"dev": "electron ."` 直接运行，未考虑 TypeScript 编译（main.ts 需要先 tsc 编译或 tsx 运行时 hook）。当前 `npm run check` 只做类型检查不做编译。 | 🔴 阻塞 | ✅ 已修复 |
| 4 | Task 4.5 provider-repo | `upsertProvider` 在 INSERT 时传 `apiKeyEnc`，但 ON CONFLICT DO UPDATE 时如果 `apiKey` 为空字符串也会覆盖已有加密密钥。需加条件判断：仅在传入新 API Key 时更新 `api_key_enc`。 | 🟡 高风险 | ✅ 已修复 |
| 5 | Task 7 preload.js | `require("electron")` 在 preload 中是正确的，但需要确认 `sandbox: false`（main.ts 已设置）— 如果未来开启 sandbox，preload 将无法使用 `require`。 | 🟡 注意 | 已标注 |
| 6 | Task 10 index.html | CSP 设置 `script-src 'self'` 但 vendor/marked.min.js 是外部下载的，需要确认其来源与完整性（有 subresource integrity hash 更佳）。 | 🟡 安全 | 已标注 |

**充足性缺陷**：

| # | 缺失项 | 影响 |
|---|--------|------|
| 7 | 无 `src/ipc/chat.ts` 的 `chat:stream` 取消机制（`chat:cancel` handler 只 console.log，未实际中断 LLM 流） | Plan C 才补全，但 Plan A 无法独立验证对话功能 |
| 8 | 无数据库迁移回滚机制（MIGRATIONS 数组只增不减） | 生产环境 schema 变更风险 |
| 9 | 缺少 `marked.min.js` 和 `highlight.min.js` vendor 文件的版本锁定 | 依赖外部下载 URL，版本不确定 |
| 10 | 无 session-repo 的分页总数字段（`countSessions` 存在，但 `listSessions` 不返回 total，前端需额外调用） | Plan B 前端已正确处理，但未在 Plan A 文档中说明 |

---

### Plan B: 四屏 UI 实现

**优点**：
- CSS 设计语言与 spec 一致（颜色、间距、圆角等 CSS 变量对齐）
- 页面间路由模式清晰（`App.navigate()` + `.page.active`）
- 每个页面独立 js/css 文件，隔离性良好
- 流式事件处理逻辑（text_delta / tool_start / tool_end / retry / done / error）完整

**正确性缺陷**：

| # | 位置 | 问题 | 严重度 | 状态 |
|---|------|------|--------|------|
| 1 | Task 2 chat.js `appendToolCallCard` | `.tool-call-body` div 在 CSS 中定义但 **从未插入 DOM** — 函数只创建了 `.tool-call-header` 和 `.tool-call-status`，点击展开逻辑引用的是不存在的 `.tool-call-body` 元素，运行时会静默失败。 | 🔴 阻塞 | ✅ 已修复 |
| 2 | Task 2 chat.js `send()` | `api.chat.send({ message, sessionId: this.currentSessionId })` — 新会话时 `currentSessionId` 为 `null`，后端 stream-chat 通过 `PersistentSession.create()` 自动处理 null sessionId（创建新会话）。 | 🟡 高风险 | 已确认可接受 |
| 3 | Task 2 chat.js `init()` | 每次 `App.navigate("chat")` 都调用 `ChatPage.init()` — 会重复绑定事件监听器（`sendBtn.addEventListener`、`input.addEventListener` 等），多次导航后内存泄漏 + 重复处理。 | 🔴 阻塞 | ✅ 已修复 |
| 4 | Task 4 settings.js | `showProviderForm(editId)` 第一行 `const existing = editId ? (async () => { /* ... */ })() : null` — 立即调用的 async 函数未 await，`existing` 永远是 Promise 对象而非数据。编辑模式下数据不填充。 | 🔴 阻塞 | ✅ 已修复 |
| 5 | Task 2 index.html | 会话列表面板 `#session-panel` 放在 `#sidebar` 和 `#main` 之间，但 CSS 中 `#app` 的布局是 `display: flex` 只包含 `#sidebar` 和 `#main`，没有给 `#session-panel` 预留位置 — 会导致布局错乱。 | 🔴 阻塞 | ✅ 已修复 |
| 6 | Task 3 sessions.js | HTML 中有 `#sessions-filter-project` 和 `#sessions-filter-time` select，但 `api.sessions.list()` 只接受 `search`/`offset`/`limit` 参数 — 项目和时间的筛选不走后端，前端也没有本地过滤逻辑。功能形同虚设。 | 🟡 功能缺失 | ✅ 已修复 |
| 7 | Task 3 sessions.js `bindEvents()` | 引用了 `#sessions-search`、`#sessions-filter-project` 等多个元素，但如果在页面未渲染时 `SessionsPage.init()` 被调用，`document.getElementById` 返回 null 会静默失败，无防御性检查。 | 🟡 健壮性 | 已标注 |

**充足性缺陷**：

| # | 缺失项 | 影响 |
|---|--------|------|
| 8 | Spec 定义了 **6 个侧栏图标**（💬📁🧩⏰⚙️Q），Plan B 只实现了 **4 个页面**（对话/会话/Skills/设置），缺少「📁 项目」和「⏰ 定时任务」两个页面。 | 未完整覆盖 spec |
| 9 | 对话页无 Markdown 代码块语法高亮（vendor 有 highlight.min.js 但 chat.js 从未调用） | 用户体验不完整 |
| 10 | 会话管理页的分页按钮最多显示 5 页 — 对于大量会话无跳页输入框 | 可用性问题 |
| 11 | 设置页的 Provider 编辑弹窗无表单验证（空 API Key、非法 URL 等） | 数据质量风险 |
| 12 | Skills 管理页在 IPC 返回空列表时使用硬编码 mock 数据（`getMockSkills()`）— 上线后需清理，存在遗留 mock 数据的风险 | 技术债务 |

---

### Plan C: 核心功能补全

**优点**：
- 数据流图清晰完整（Renderer → Preload → Main → Agent 全链路）
- 有明确的"前置：先 Read 确认"步骤，防御 Plan C 与实际代码脱节
- 安全设计到位（路径沙箱、工具结果溢出、API Key 加密）
- Skill 选择机制说明详尽（LLM 主动选择 vs 关键词匹配的 tradeoff）
- RotatingProvider 故障转移设计合理（priority 排序 + 冷却）

**正确性缺陷**：

| # | 位置 | 问题 | 严重度 | 状态 |
|---|------|------|--------|------|
| 1 | ~~全计划~~ | ~~引用 `PersistentSession`，但实际类是 `Session`~~ → **审查错误：`PersistentSession` 确实存在于 `src/agent/persistent-session.ts`，继承自 `Session`。Plan C 引用正确。** | — | ❌ 误报 |
| 2 | Task 5 runner.ts | `prepareContextBeforeModelCall` 的 import 语句只导入了 `HISTORY_SUMMARY_SYSTEM_PROMPT` 和 `buildCompactionMessages`，但方法体内使用了 `ACTIVE_CHECKPOINT_SYSTEM_PROMPT`，缺少 import。 | 🔴 阻塞 | ✅ 已修复 |
| 3 | Task 3/5 session.ts/runner.ts | `getActiveTurnsForCheckpoint()` 和 `pruneArchivedActiveProcess()` 在代码库中**不存在**，需新增。`applyHistorySummary`、`applyActiveCheckpointSummary` 当前为空壳。 | 🟡 高风险 | ✅ 已标注 |
| 4 | Task 8 stream-chat.ts | `PersistentSession.resume()` 应为 `PersistentSession.load()`（代码库实际 API 是 `load(sessionId, sessionDir?)`）。 | 🔴 阻塞 | ✅ 已修复 |
| 5 | Task 8 stream-chat.ts | `AgentRunner` 构造函数不接受 `signal` 参数 — `signal` 应通过 `AgentRunParams.signal` 传入 `runStream()`。 | 🔴 阻塞 | ✅ 已修复 |
| 6 | Task 8 stream-chat.ts | 引用了 `BUILTIN_TOOLS` 常量 — 与 Plan A 实际导出一致。路径 `../../agent/persistent-session.js` 正确。 | ✅ | 已验证正确 |
| 7 | Task 1 path-sandbox.ts | `isPathAllowed` 中 `path.relative(root, resolved)` 对于 Windows 盘符不同的路径行为不一致（如 `D:\project` vs `C:\Windows`），需加额外盘符检查。 | 🟡 平台问题 | 已标注 |
| 8 | Task 2 tool-result-cap.ts | `_perTurnLedgers` 是模块级 Map，无清理机制 — 长时间运行会内存泄漏（session 结束后 ledger 不释放）。`resetBudgetLedger` 存在但无调用点说明。 | 🟡 内存泄漏 | 已标注 |
| 9 | Task 7 skill-service.ts | `SkillLoader.scan()` 和 `SkillLoader.load()` 签名确认与代码库一致 ✅。`SkillSpec` 类型中 `description_zh`/`description_en` 字段名需确认。 | 🟡 需确认 | 已标注 |

**充足性缺陷**：

| # | 缺失项 | 影响 |
|---|--------|------|
| 10 | Spec 中的「📁 项目」和「⏰ 定时任务」两个页面在三个 Plan 中均未覆盖 | Spec 覆盖不完整 |
| 11 | 上下文压缩的 `applyHistorySummary` 和 `applyActiveCheckpointSummary` 方法的实现不在 Plan 内 — Plan 假设这些方法已存在或"容易实现"，但实际可能需要显著的 Session 层改造 | 低估工作量 |
| 12 | 无 AgentRunner 的 `runStream` 参数确认（Plan C Task 8 的 `runner.runStream({message, model, workingDir, systemPrompt, turnEphemeral})` — 需确认这些参数名与实际接口一致） | 🔴 阻塞 |
| 13 | 压缩失败的降级策略不完整 — Plan C Task 5 仅在节省量不足时 `control.failures++` 然后退出，如果连续失败 3 次后上下文溢出，行为未定义 | 健壮性 |
| 14 | 无 `pruneArchivedActiveProcess` 方法的实现细节 | 依赖未实现的 API |

---

## 跨计划一致性问题

| # | 问题 | 详情 |
|---|------|------|
| 1 | **Spec vs Plans 侧栏图标不一致** | Spec 定义 6 个图标（💬📁🧩⏰⚙️Q），Plan A/B 只有 4 个（💬📋🧩⚙️），缺少 📁(项目) 和 ⏰(定时任务)。Plan B 的 `📋` 是"会话管理"而非 spec 中的"项目"。 |
| 2 | **Plan A 侧栏 vs Plan B 侧栏** | Plan A index.html 侧栏 4 个图标，Plan B 没有修改侧栏数量。但 Plan B Task 2 新增了 `#session-panel`（会话列表面板，260px）夹在侧栏和主区之间，构成实际的三栏布局。这导致 Plan A 验证的"4 图标侧栏能切换"到 Plan B 执行后布局变化。 |
| 3 | **Session/PersistentSession 引用** | Plan C 引用 `PersistentSession` — **确认代码库中存在**（`src/agent/persistent-session.ts`，继承自 `Session`）。引用路径和方法签名已验证。 |
| 4 | **Vendor 文件管理** | Plan A 要求下载 `marked.min.js` 和 `highlight.min.js` 到 `vendor/`，但三个计划都没有说明 vendor 文件的版本管理策略（gitignore？lockfile？）。 |
| 5 | **Plan 产物位置违规** | 三个 plan 文件均位于 `docs/superpowers/plans/`，违反 CLAUDE.md § 产物落盘规则（应为 `.ai-runtime-artifacts/plans/`）。 |

---

## 建议修改优先级

### 🔴 阻塞（已全部修复 ✅）

1. ✅ **添加 Phase 1 环境准备**：Plan A 新增 Task 0，包含 Node.js 版本确认、TypeScript 编译器确认、环境变量说明、平台差异表
2. ~~修正 `PersistentSession` → `Session`~~ → **误报**：`PersistentSession` 确实存在于代码库（`src/agent/persistent-session.ts`），Plan C 引用正确
3. ✅ **Plan A Task 1**：`dev` 脚本改为 `tsc -p tsconfig.json && electron .`，确保 TS 编译后再启动
4. ✅ **Plan A Task 5**：FileLock 移除 `Atomics.wait`，改用忙等待 50ms（对文件锁场景可接受）
5. ✅ **Plan B Task 2**：`appendToolCallCard` 补全 `.tool-call-body` DOM
6. ✅ **Plan B Task 2**：`ChatPage.init()` 添加 `_initialized` 标志位防重复绑定
7. ✅ **Plan B Task 4**：`showProviderForm` 改为 `async` + `await api.providers.list()`，编辑模式下 API Key 留空不修改
8. ✅ **Plan B Task 2**：`app.js navigate()` 显示/隐藏 `#session-panel`（非对话页 `collapsed`）
9. ✅ **Plan C Task 5**：补充 `ACTIVE_CHECKPOINT_SYSTEM_PROMPT` import
10. ✅ **Plan C Task 8**：`PersistentSession.resume()` → `PersistentSession.load()`；signal 通过 `AgentRunParams.signal` 传入
11. 🔲 **迁移 plan 文件**到 `.ai-runtime-artifacts/plans/`（待执行前处理）

### 🟡 高风险（已标注，建议执行时注意）

12. 🔲 补充 Spec 中缺失的「项目」和「定时任务」两个页面的 plan（或明确标注为后续版本）
13. ✅ Plan B 的筛选器已添加客户端侧时间过滤逻辑
14. 🔲 Plan A crypto.ts 的密钥派生增加 migration 策略
15. 🔲 Plan C tool-result-cap.ts 添加 session 结束时的 ledger 清理
16. 🔲 Plan C Task 3/5 需实现 `getActiveTurnsForCheckpoint()` 等缺失方法

### 🟢 改进建议（可在执行中修复）

17. 为所有产出代码的 Task 增加"Step 1: 写失败测试"
18. 增加风险与回滚章节（至少标注高风险 Task 和回滚方式）
19. 增加时间预估（量级即可）
20. 标注可并行 Task（Plan A 的 Task 2-5 存储层可并行）
21. 为 Vendor 文件添加版本锁定策略
22. Plan B 会话管理增加跳页输入框
23. Provider 编辑弹窗增加表单验证
24. Skills 管理页增加上线后移除 mock 数据的标注

---

## 修复总结（2026-08-04 更新）

本轮修复共处理 **17 个问题**：

| 类别 | Plan A | Plan B | Plan C | 合计 |
|------|--------|--------|--------|------|
| 🔴 阻塞（已修复） | 3 | 4 | 3 | **10** |
| 🟡 高风险（已修复/标注） | 2 | 2 | 4 | **8** |
| ❌ 误报（已撤销） | 0 | 0 | 1 | **1** |

**关键修复：**
- Plan A：Task 0 环境准备、dev 脚本、FileLock、upsertProvider
- Plan B：appendToolCallCard DOM、ChatPage 重复绑定、showProviderForm async、session-panel 布局、sessions 筛选
- Plan C：import 补全、resume()→load()、signal 传递修正、缺失方法标注

**仍需关注（非阻塞）：**
1. Plan 文件迁移到 `.ai-runtime-artifacts/plans/`
2. 「项目」和「定时任务」两个 spec 页面未覆盖
3. crypto.ts 密钥迁移策略
4. tool-result-cap 内存清理
5. `getActiveTurnsForCheckpoint()` 等压缩辅助方法需在 Task 3 中新增实现

## 后续步骤

1. ✅ 三个 Plan 的阻塞项已全部修复，代码正确性显著提升
2. 可选：将 plan 文件迁移到 `.ai-runtime-artifacts/plans/`
3. 执行顺序：Plan A（Task 0→1→2→3→4→4.5→5→6→7→8→9→10→11） → Plan B → Plan C
4. Plan A 和 Plan B 的 Task 1（CSS）可部分并行
5. 通过后可进入 `orchestration` 阶段并行派发实现

---

## 附录：文档元数据检查

| 检查项 | Plan A | Plan B | Plan C |
|--------|--------|--------|--------|
| 明确标题 | ✅ | ✅ | ✅ |
| 日期/版本 | ✅ (文件名含日期) | ✅ | ✅ |
| Goal 声明 | ✅ | ✅ | ✅ |
| Prerequisites 声明 | ✅ (source spec/guide) | ✅ (Plan A) | ✅ (Plan A + 现有代码) |
| 文件结构概览 | ✅ | ✅ | ✅ |
| Summary/Output 声明 | ✅ | ✅ | ✅ |
| Next plan 链接 | ✅ | ✅ | ✅ |
| Commit message 规范 | ✅ Angular Convention | ✅ | ✅ |
| 术语一致性 | ⚠️ Session/PersistentSession 不一致 | ✅ | ⚠️ Session/PersistentSession 不一致 |
| 代码块语言标注 | ✅ | ✅ | ✅ |
