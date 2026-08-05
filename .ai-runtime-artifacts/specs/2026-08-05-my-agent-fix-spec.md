---
artifact: spec
route: superpowers:brainstorming
skills:
  - brainstorming
  - source-driven-development
skills_evidence:
  - ~/.claude/skills/brainstorming/SKILL.md
source:
  - AGENTS.md
  - harness-kit/core/routing.md
  - package.json
  - electron/main.ts
  - src/ipc/chat.ts
  - src/agent/runner.ts
  - .ai-runtime-artifacts/stack/2026-08-05-stack.md
created_at: 2026-08-05
status: draft
approved: false
---

# My Agent 功能修复与完善 — 方案设计

## 1. 背景与问题诊断

My Agent 是一个基于 Electron + TypeScript 的 LLM Agent 桌面运行时。项目已有完整的 **AgentRunner 核心引擎**（流式对话、工具调用循环、重试/死循环检测、收敛控制）、**8 个内置工具**（read_file/write_file/edit_file/bash/grep_files/list_files/search_files/web_fetch）、**SQLite 存储层**（会话/配置/用量/Skills/Providers 五表 schema + AES-256-GCM 加密），但这些能力**完全没有接入 Electron 桌面端**。

### 核心断裂点

| 断裂点 | 文件 | 现状 | 影响 |
|--------|------|------|------|
| Chat IPC 是 echo 占位 | `src/ipc/chat.ts` | `Echo: <message>` | 对话完全不可用 |
| AgentRunner 未在 Electron 创建 | `electron/main.ts` | initIpc 只注册 IPC，不创建 runner | 无法调用 LLM |
| Skills IPC 返回空 | `src/ipc/skills.ts` | `return []` | Skills 管理页展示假数据 |
| Provider 工厂未注册 | `src/providers/index.ts` | DeepSeek 类导出但未 registerFactory | AgentRunner 解析不到 provider |
| 配置读写双存储 | `src/ipc/config.ts` | `config:get` 读 JSON 文件，`config:update` 写 SQLite | 保存的设置无法回读 |
| 会话历史不加载 | `renderer/js/pages/chat.js` | `loadHistory()` 有 TODO，不读 JSONL | 切换会话看不到历史 |
| 设置页大部分静态 | `renderer/js/pages/settings.js` | 仅 temperature/maxTokens 可保存 | 工具/路径/外观等标签页无效 |
| 暗色主题不存在 | CSS | 仅有亮色变量 | 设置页外观选项是空壳 |
| Provider 测试假实现 | `src/ipc/config.ts` | `providers:test` 直接返回 `{ok:true}` | 无法验证 API Key |
| main.ts / main.cjs 重复 | `electron/` | 两个入口文件内容几乎相同 | 维护隐患 |

### 已确认的约束

- **不改架构**：保持 Vanilla JS 渲染进程（不引入 React/Vue/Alpine.js）
- **全部修复**：不砍功能，四个页面（对话/会话/Skills/设置）全部完善
- **分 3 Phase 渐进交付**：每 Phase 独立可验证

---

## 2. 方案概览：三 Phase 渐进修复

```
Phase 1: 对话核心里程碑 — 真实 LLM 对话可用
Phase 2: 管理功能 — 设置与会话管理完整
Phase 3: Skills + UI 打磨 — 全面完善
```

---

## 3. Phase 1 — 对话核心里程碑

**目标：** Chat IPC 接入 AgentRunner，实现真实流式对话；会话创建/恢复/持久化链路打通。

### 3.1 数据流

```
用户输入 → ChatPage.send()
  → api.chat.send({message, sessionId})
  → ipcRenderer.send("chat:stream", {streamId, message, sessionId})

[Main Process]
ipcMain.on("chat:stream")
  → AgentRunner.runStream({message, ...})
  → for await (ev of stream):
      text_delta  → event.sender.send("stream:text_delta", {streamId, payload: ev})
      tool_start  → event.sender.send("stream:tool_start", {streamId, payload: ev})
      tool_end    → event.sender.send("stream:tool_end", {streamId, payload: ev})
      retry       → event.sender.send("stream:retry", {streamId, payload: ev})
      done        → event.sender.send("stream:done", {streamId, payload: {sessionId, meta}})
      error       → event.sender.send("stream:error", {streamId, payload: {message}})

[完成时]
  → PersistentSession 写入 JSONL
  → session-repo.upsertSession() 更新 SQLite 元数据
  → usage-repo.logUsage() 记录 token 用量
```

### 3.2 文件改动清单

| 文件 | 改动类型 | 改动说明 |
|------|----------|---------|
| `electron/main.ts` | 重构 | 新增 `initAgent()` — 注册 DeepSeek factory、创建 AgentRunner 单例；删除冗余 `main.ts`（统一到 `main.cjs`，或反之） |
| `electron/main.cjs` | 重构 | 与 `main.ts` 合并为一个入口；`initIpc` 改为同步（或接受 runner 参数） |
| `src/ipc/chat.ts` | **重写** | 从 echo → 创建/获取 AgentRunner，`chat:stream` 执行 `runStream()` 并逐事件转发；`chat:cancel` 触发 AbortController |
| `src/providers/index.ts` | 修复 | 在模块加载时自动 `registerFactory("deepseek", ...)` |
| `src/ipc/sessions.ts` | 新增 | `sessions:getMessages` 从 PersistentSession JSONL 读取消息列表；对话完成后 `upsertSession` |
| `src/ipc/config.ts` | 修复 | `config:update` 改为写 JSON 文件（与 `config:get` 同源）；`config:get` 合并 JSON + SQLite configs 表；`providers:test` 调用真实 API 验证 |
| `electron/renderer/js/pages/chat.js` | 修复 | `loadHistory()` 从 `sessions:getMessages` 加载历史消息并渲染；`send()` 完成后刷新 session 列表 |
| `src/ipc/index.ts` | 小改 | 传递 runner 引用给 chat IPC |

### 3.3 关键设计决策

- **AgentRunner 生命周期**：main process 中以懒加载单例管理，首次 `chat:stream` 时初始化。避免 better-sqlite3 ABI 问题影响 Electron 启动。
- **Provider 注册**：`src/providers/index.ts` 模块加载时自动注册 DeepSeek factory。优先从 DB `providers` 表读取配置，fallback 到环境变量。
- **Session 管理**：复用现有 `SessionStore`（LRU 缓存 PersistentSession）。每次对话结束自动 upsert SQLite 元数据。
- **IPC 事件格式**：与 preload `stream()` 已有协议一致 — `{streamId, payload}`。
- **取消机制**：`AbortController` 传递给 AgentRunner，`chat:cancel` 触发 abort。

### 3.4 验证标准

- [ ] 在对话页输入消息，能看到真实 LLM 流式回复
- [ ] 工具调用（如 read_file）在 UI 中显示 tool_start/tool_end 卡片
- [ ] 停止按钮能中断生成
- [ ] 新建会话 → 发送消息 → 刷新后会话列表出现该会话
- [ ] 点击已有会话 → 加载历史消息
- [ ] 重试/错误事件在 UI 正确展示

---

## 4. Phase 2 — 管理功能

**目标：** 设置页所有标签页可保存；会话管理（搜索/导出/归档/批量操作）；Provider 管理完整可用。

### 4.1 文件改动清单

| 文件 | 改动类型 | 改动说明 |
|------|----------|---------|
| `src/storage/config-store.ts` | **新增** | 统一的 config JSON 文件读写模块，替代分散的 config:get/update 逻辑 |
| `src/ipc/config.ts` | 重构 | 使用 ConfigStore；全部标签页设置读写通道；`app:getVersion` 从 `package.json` 动态读取 |
| `electron/renderer/js/pages/settings.js` | **重写** | 模型 tab：从 Provider DB 动态渲染模型列表 + 默认模型选择；工具 tab：从 `BUILTIN_TOOLS` 动态渲染 toggle 列表；路径/上下文/外观/开发者 tab：读写 config |
| `src/ipc/sessions.ts` | 新增 | 批量删除/归档/导出通道；搜索接口支持标题+内容模糊匹配 |
| `electron/renderer/js/pages/sessions.js` | 修复 | 导出功能（JSON + Markdown）；归档按钮接线；搜索改为服务端查询；批量操作确认弹窗 |
| `electron/renderer/css/variables.css` | 新增 | `[data-theme="dark"]` 变量覆盖块 |
| `electron/renderer/css/theme-dark.css` | **新增** | 暗色主题完整变量定义 |
| `electron/renderer/js/app.js` | 小改 | 主题切换逻辑（`document.documentElement.dataset.theme`） |

### 4.2 设置页 6 标签页修复细节

| 标签页 | 读 | 写 | UI |
|--------|----|----|----|
| 模型 | 默认模型从 config 读，Provider 列表从 DB 读 | 默认模型/规划模型选中等写入 config | 下拉选项从 Provider DB 模型列表动态生成 |
| 工具 | 工具启用状态从 config 读 | toggle 写入 config | 从 `BUILTIN_TOOLS` 动态渲染（含 `run_skill` 占位） |
| 路径 | 工作目录白名单从 config 读 | 文本框内容写入 config | 保持现有 UI |
| 上下文 | 压缩阈值/保留轮次/压缩预算从 config 读 | 写入 config | 保持现有 UI |
| 外观 | 主题/字体大小从 config 读 | 写入 config + 立即应用 | 暗色切换即时生效 |
| 开发者 | Mock LLM/Trace 模式从 config 读 | 写入 config | 版本号动态读取 |

### 4.3 验证标准

- [ ] 模型标签页显示 DB 中配置的 Provider 和模型
- [ ] 切换默认模型后，对话页使用新模型
- [ ] 工具标签页 toggle 与 BUILTIN_TOOLS 一致
- [ ] 外观标签页切换暗色主题即时生效
- [ ] 会话管理页搜索功能可用
- [ ] 批量删除/导出功能可用
- [ ] Provider 添加/编辑/删除可用，连接测试调用真实 API

---

## 5. Phase 3 — Skills + UI 打磨

**目标：** Skills 管理页接入真实数据；暗色主题完整；UI 细节优化；代码清理。

### 5.1 文件改动清单

| 文件 | 改动类型 | 改动说明 |
|------|----------|---------|
| `src/ipc/skills.ts` | **重写** | 接入 `SkillLoader.scan()`；`skills:list` 返回扫描结果 → 同步到 DB `skills_index`；`skills:get` 读取 SKILL.md 内容；`skills:setEnabled` 写入 DB |
| `electron/renderer/js/pages/skills.js` | 修复 | 去掉 `getMockSkills()`，从 IPC 真实数据渲染；分类筛选保留；启停 toggle 接线；卡片点击查看详情 |
| `electron/renderer/css/theme-dark.css` | 完善 | 全部组件暗色变量（消息气泡、输入框、工具卡片、模态框、Toast） |
| `electron/main.cjs` | 清理 | 删除冗余的 `main.ts`；统一入口逻辑 |
| `electron/renderer/js/app.js` | 改进 | hash 路由 `#chat`/`#sessions`/`#skills`/`#settings`；支持 `popstate` 前进/后退 |
| `electron/renderer/css/` | 增强 | 消息滑入动画（`@keyframes slideIn`）；流式光标闪烁；焦点状态过渡 |
| `electron/renderer/js/pages/chat.js` | 增强 | 错误重试按钮；空状态差异化（无会话/无消息/加载失败）；工具调用卡片折叠动画 |
| `electron/renderer/js/pages/settings.js` | 增强 | 保存成功反馈；Provider 表单验证（API Key 格式检查） |

### 5.2 Skills 数据流

```
SkillsPage.init()
  → api.skills.list()
  → ipcMain.handle("skills:list")
  → SkillLoader.scan(skillsDir)  // 扫描磁盘 SKILL.md
  → 同步到 DB skills_index 表
  → 返回 SkillSpec[] → UI 渲染卡片
```

### 5.3 Skills 卡片交互

- 分类 chip 筛选（从 SKILL.md frontmatter 的 category 字段提取）
- 启停 toggle 写入 DB skills_index.enabled
- 点击卡片展开详情（description + 工具列表 + 依赖）
- "新建 Skill" 按钮 → 系统文件管理器打开 skills 目录

### 5.4 验证标准

- [ ] Skills 页显示扫描到的真实 Skill（如 `skills/coding/SKILL.md`）
- [ ] 分类筛选可用
- [ ] 启停 toggle 持久化
- [ ] 暗色主题覆盖所有页面和组件
- [ ] Hash 路由支持浏览器前进/后退
- [ ] 消息列表有入场动画
- [ ] 仅保留一个 main 入口文件

---

## 6. 不改动的部分（明确排除）

- **不引入前端框架**：继续保持 Vanilla JS
- **不修改 AgentRunner 核心**：引擎逻辑不变（compaction stub 保留为 Phase 4）
- **不修改工具实现**：8 个内置工具保持同步 I/O（不做 Worker 线程化）
- **不添加新 Provider**：仅修复 DeepSeek 注册链路
- **不修改 preload**：IPC 协议不变

---

## 7. 风险评估

| 风险 | 影响 | 缓解 |
|------|------|------|
| better-sqlite3 ABI 不匹配 | IPC 初始化失败 | 懒加载 + 优雅降级（已有 try/catch） |
| AgentRunner 在 main process 阻塞 | UI 卡顿 | 工具执行以 `Promise` 包裹，不阻塞 IPC 事件循环 |
| JSONL 文件损坏 | 历史消息加载失败 | `readJsonLines` 已有 skip-corrupt 逻辑 |
| PersistentSession 内存占用 | 多会话时内存增长 | SessionStore 的 LRU 缓存自动驱逐 |
| 配置迁移（旧 SQLite configs → JSON） | 已有配置丢失 | Phase 2 做一次性 migrate |

---

## 8. Spec 自检

### 占位符扫描
- 无 TBD/TODO 残留

### 内部一致性
- Phase 1 → Phase 2 → Phase 3 依赖关系清晰：P1 打通核心链路，P2 在此基础上补全管理功能，P3 收尾打磨
- 所有 IPC 通道与 preload 已有接口一致

### 范围检查
- 聚焦于"修复断裂点"，每个改动都有明确的现状 → 目标
- 不改架构、不加新功能（MVP 范围内修复）

### 歧义检查
- "config JSON 文件" = `app.getPath("userData") + "/config.json"`（与现有 `config:get` 一致）
- "模型列表动态生成" = 从 Provider DB 表中所有 enabled provider 的 models 字段合并去重

---

## Next

**（写入后须暂停，等用户明确继续 — 见 `harness-kit/core/routing.md` § 阶段门禁）**

- 确认方案无误 → 说「写计划」或「制定实施计划」
- 变更范围小、无需计划 → 说「直接实现」或「直接做」
- 需要调整方案 → 直接说修改意见
