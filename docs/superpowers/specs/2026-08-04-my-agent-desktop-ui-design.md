# My-Agent 桌面端 UI 设计

**日期**: 2026-08-04
**作者**: Claude (brainstorming)
**项目**: my-agent（从命令行 Agent 升级为 Electron 桌面应用）
**关联文档**:
- [第三阶段升级指南](../plan/第三阶段升级指南.md)（架构 / 数据 / 后端方案）
- Orkas `CLAUDE.md`（PC 端硬约束）

---

## 1. 设计目标

将 my-agent 从命令行工具升级为桌面应用，对标主流产品（KIMI / Claude Desktop）的使用体验。整套 UI 围绕以下原则：

- **白底极简**：减少长时间使用的视觉负担
- **三栏布局**：图标侧栏（64px） + 二级面板（200-260px） + 主区（flex）
- **统一风格**：四屏共用同一套 CSS 变量与组件，导航稳定可预期
- **项目本地化**：围绕「代码工作」场景，工具 / Skill / Provider 都是真实可点的入口

## 2. 设计语言

| 元素 | 取值 |
|------|------|
| 主色 | `#6c5ce7`（紫）→ 渐变 `#6c5ce7 → #a29bfe` |
| 文字主色 | `#222` |
| 文字次色 | `#666` / `#999` |
| 边框 | `#f0f0f0` / `#ececec` |
| 背景 | `#fff`（主区）/ `#fafafa`（次级面板） |
| 卡片阴影 | `0 1px 2px rgba(0,0,0,0.03)`（浅） |
| 输入框圆角 | 18px（大输入框）/ 8px（小输入框） |
| 字号 | 14px 正文 / 13px 次要 / 11px 标签 |

字体栈：`-apple-system, 'PingFang SC', sans-serif`

## 3. 整体架构

```
┌─────┬──────────┬──────────────────────────────────┐
│  M  │  对话列表  │                                  │
│     │  (260px)  │     主内容区（按页面变化）          │
│ 64px│          │                                  │
│ 图标│  分组：    │                                  │
│ 侧栏│  📁 项目A │                                  │
│     │  📁 项目B │                                  │
│ 💬  │  💬 临时  │                                  │
│ 📁  │          │                                  │
│ 🧩  │          │                                  │
│ ⏰  │          │                                  │
│     │          │                                  │
│ ⚙️  │          │                                  │
│  Q  │          │                                  │
└─────┴──────────┴──────────────────────────────────┘
```

**侧栏图标（64px）**：
- M（Logo / Home）
- 💬 对话（默认页）
- 📁 项目
- 🧩 Skills
- ⏰ 定时任务
- ⚙️ 设置
- Q（用户头像，浮层弹账号菜单）

**导航路由**：
- `/chat` → 对话页（默认）
- `/chat?session=xxx` → 切到指定会话
- `/sessions` → 会话管理页
- `/projects` → 项目管理页（未来）
- `/skills` → Skills 管理页
- `/settings` → 设置页（含二级导航）
- `/tasks` → 定时任务页（未来）

## 4. 四屏设计

### 4.1 对话页 `/chat`

**目标**：消息流主战场，对标 KIMI 的极简白底风格。

**布局**：
- 图标侧栏 64px
- 会话列表面板 260px（可折叠到 0）
- 主区（消息流 + 输入区）

**会话列表面板**：
- 顶部：标题「对话」+ `+` 新建按钮
- 搜索框
- 分组：按项目目录折叠（📁 my-agent / 📁 Orkas / 💬 临时对话）
- 每条显示：标题 + 首条消息预览
- 底部：「共 N 个会话」+ 管理链接

**主区顶栏**：
- 左：会话标题 + `·  当前项目路径`
- 右：模型下拉（带 🧠 图标） + token 计数 + 工具轮次 + 更多菜单（⋯）

**消息流**：
- 用户消息：右侧气泡，紫色头像
- AI 消息：左侧卡片（白底浅边框 + 圆角 4/14/14/14）
- 工具调用卡片：单独成行，显示
  - 标题：🔧 read_file · src/utils.ts
  - 折叠区：参数 / diff / 输出（终端暗色）
  - 底部状态条：✅ 已读取 245 行 · 45ms（绿底）/ ❌ EACCES（红底）
- 错误态：红色边框卡片
- 流式指示：底栏光标 ▍

**输入区**：
- 上方上下文条：`📁 my-agent ⌄` / `🧠 deepseek-chat ⌄` / `🧩 4 个工具已启用 ⌄`
- 大圆角输入框（圆角 18px，浅阴影）：
  - 上：textarea
  - 下：左侧工具按钮（📎 / 🖼️ / /）+ 右侧「🔧 工具」+「发送 ➤」
- 下方免责提示

**Key 交互**：
- `Cmd/Ctrl + K`：聚焦输入框
- `Cmd/Ctrl + N`：新建会话
- `Enter` 发送，`Shift+Enter` 换行
- 工具卡片点击展开/折叠
- 长按消息可复制 / 重新生成 / 删除

### 4.2 会话管理页 `/sessions`

**目标**：批量管理会话，对话页之外的二级入口。

**布局**：
- 图标侧栏 64px（点击 💬 切回对话页）
- 主区（顶栏 + 筛选条 + 工具条 + 表格 + 分页）

**顶栏**：
- 标题「会话管理」 + 「共 N 个会话 · M 个项目」
- 右侧：📥 导出全部 + ＋ 新建会话

**筛选条**：
- 搜索框（标题或内容全文）
- 📁 项目下拉 / 📅 时间下拉 / 🧠 模型下拉

**批量操作条**（选中行后浮现，紫色背景）：
- 已选 N 个会话 · 占用 X tokens
- 📦 归档 / 📥 导出 / 🗑️ 删除

**表格列**：
| 勾选 | 会话（含首条预览） | 项目 | 模型 | 消息 | Token | 更新时间 | 操作 |
|------|------|------|------|------|------|------|------|

**分页**：底栏「显示 X-Y / 总数」+ 页码按钮

### 4.3 设置页 `/settings`

**目标**：配置 LLM Provider、工具、路径、上下文、外观、定时任务、日志、开发者选项。

**布局**：
- 图标侧栏 64px（⚙️ 高亮）
- 二级导航 200px（8 个分类）
- 主区表单

**二级导航**：
1. 🤖 模型
2. 🔧 工具
3. 📁 路径与权限
4. 🧠 上下文
5. 🎨 外观
6. ⏰ 定时任务
7. 📜 日志
8. 🧪 开发者

**主区（以「模型」为例）**：
- 默认模型：主对话模型 + 规划/反思模型两个下拉
- Provider 列表卡片：DS / A / O 三个图标 + 已连接/未配置 badge + 编辑/配置按钮
- 生成参数：Temperature 滑块 + Max tokens + 请求超时
- 保存 / 恢复默认按钮

### 4.4 Skills 管理页 `/skills`

**目标**：浏览 / 启用 / 安装 Skill。

**布局**：
- 图标侧栏 64px（🧩 高亮）
- 主区（顶栏 + 标签筛选 + 卡片网格）

**顶栏**：
- 标题「🧩 Skills 管理」 + 「已启用 N / 总数 · 自定义 M」
- 右侧：📥 从市场安装 + 📂 打开目录 + ＋ 新建 Skill

**标签筛选**：
- 分类 chip：全部 / 💻 开发 / 📝 写作 / 📊 数据 / 🔍 研究 / 🎨 创意
- 右侧：「仅显示已启用」复选框

**卡片网格**（3 列）：
- 图标 + 名称 + 分类
- 描述（1-2 行）
- 版本 + 来源（内置/自定义/市场）
- 启用开关
- 配置入口

**分组**：用小标题分组「已启用」「未启用」，未启用区半透明（opacity 0.7）。

## 5. 关键交互

| 交互 | 行为 |
|------|------|
| `Cmd/Ctrl + K` | 聚焦输入框 |
| `Cmd/Ctrl + N` | 新建会话 |
| `Cmd/Ctrl + ,` | 打开设置 |
| `Cmd/Ctrl + B` | 切换侧栏 |
| `Esc` | 关闭弹层 / 停止生成 |
| 工具卡片点击 | 折叠 / 展开 |
| 长按消息 | 复制 / 重新生成 / 删除 |
| 拖文件到输入区 | 上传为附件 |

## 6. 组件清单

### 6.1 复用组件
- **Sidebar（图标侧栏）**：4 屏通用，仅当前项高亮
- **SubNav（二级导航）**：用于会话列表 + 设置页
- **Card**：通用卡片容器，padding 14-16px
- **Input / Textarea / Select / Button**：基础表单元素
- **Tag / Chip**：分类标签，圆角 14px
- **Modal / Toast / Dropdown**：通用浮层
- **Empty State**：列表为空时的占位

### 6.2 业务组件
- **MessageBubble**：用户 / AI 消息气泡
- **ToolCallCard**：工具调用卡片（折叠 / 展开 / 错误三态）
- **SessionListItem**：会话列表条目
- **SkillCard**：Skill 卡片
- **ProviderCard**：Provider 配置卡片
- **StreamingIndicator**：流式生成光标

## 7. 文件 / 目录组织

```
src/renderer/
├── index.html                    # 单页入口
├── styles/
│   ├── reset.css
│   ├── variables.css            # CSS 变量（颜色 / 间距 / 字号）
│   ├── layout.css               # 布局（侧栏 / 二级导航 / 主区）
│   ├── components.css           # 通用组件
│   ├── chat.css                 # 对话页专属
│   ├── sessions.css             # 会话管理页专属
│   ├── settings.css             # 设置页专属
│   └── skills.css               # Skills 页专属
├── js/
│   ├── app.js                   # 路由 + 启动
│   ├── api.js                   # window.myAgent 封装
│   ├── store.js                 # 本地状态（轻量 store）
│   ├── pages/
│   │   ├── chat.js
│   │   ├── sessions.js
│   │   ├── settings.js
│   │   └── skills.js
│   └── components/
│       ├── sidebar.js
│       ├── message-bubble.js
│       ├── tool-call-card.js
│       └── ...
└── vendor/                      # 第三方 JS/CSS（如需）
```

## 8. 路由策略

**单页应用**（hash 路由，避免 Electron 路由问题）：
- `#/chat` → 对话页
- `#/sessions` → 会话管理
- `#/skills` → Skills 管理
- `#/settings` → 设置
- `#/settings/tools` → 设置的「工具」子页（hash 深路径）

**路由表**：

| 路由 | 组件 | 标题 |
|------|------|------|
| `#/chat` | ChatPage | My Agent |
| `#/sessions` | SessionsPage | 会话管理 |
| `#/skills` | SkillsPage | Skills 管理 |
| `#/settings` | SettingsPage（默认子页=模型） | 设置 |
| `#/settings/{tab}` | SettingsPage（指定 tab） | 设置 |

## 9. 与后端的契约（IPC）

所有 UI 状态通过 `window.myAgent.invoke / stream` 调用 main 进程：

（注意：Plan 实现中使用 `window.myAgent` 命名，非 `window.orkas` — 这是 MyAgent 项目自身的 API namespace。）

```js
// 示例：会话列表
const sessions = await window.myAgent.invoke('sessions:list', { projectId });

// 示例：流式对话
const stream = window.myAgent.stream('chat:send', { sessionId, message });
stream.on('event', (e) => { /* delta / tool_call / done */ });
```

详见 [第三阶段升级指南 §4.3](../plan/第三阶段升级指南.md) 的 IPC 表。

## 10. 与 Orkas 前端功能对比

以下对比基于 Orkas `src/renderer/` 源码（56 个 JS 模块 + index.html），梳理 MyAgent 当前 Spec/Plan 中**已覆盖**与**缺失**的前端功能。

### 10.1 侧栏导航对比

| 功能 | Orkas | MyAgent Spec | MyAgent Plan | 状态 |
|------|-------|-------------|-------------|------|
| 对话 (Commander/Chat) | ✅ 主按钮 | ✅ 💬 对话 | Plan B Task 1-2 | 🟢 已覆盖 |
| 会话列表 (侧栏内) | ✅ Projects + Conversations 分组 | ✅ 会话列表面板 260px | Plan B Task 2 (session-panel) | 🟢 已覆盖 |
| Auto / 定时任务 | ✅ Auto 按钮 + 页面 | ⏰ 侧栏图标 (标记未来) | ❌ 未实现 | 🟡 延后 |
| Agents 管理 | ✅ Agents 按钮 + 页面 | ❌ 无 | ❌ 无 | 🔴 缺失 |
| Skills 管理 | ✅ Skills 按钮 + 页面 | ✅ 🧩 Skills | Plan B Task 5 | 🟢 已覆盖 |
| Connectors (MCP) | ✅ Connectors 按钮 + 页面 | ❌ 无 (MyAgent 不走 MCP) | ❌ 无 | N/A |
| Library / 知识库 | ✅ Library 按钮 + 页面 | ❌ 无 | ❌ 无 | 🔴 缺失 |
| My Apps / Artifacts | ✅ Apps 按钮 + 页面 | ❌ 无 (MyAgent 无此功能) | ❌ 无 | N/A |
| 设置 | ✅ 底部齿轮按钮 | ✅ ⚙️ 设置 | Plan B Task 4 | 🟢 已覆盖 |
| 全局搜索 | ✅ Cmd/Ctrl+K → Search 弹窗 | Cmd/Ctrl+K → 聚焦输入框 | Plan B Task 2 | 🔴 冲突 |

> ⚠️ **快捷键冲突**：Orkas 用 `Cmd/Ctrl+K` 打开全局搜索，MyAgent 用 `Cmd/Ctrl+K` 聚焦输入框。建议 MyAgent 改用 `Cmd/Ctrl+L` 聚焦输入（浏览器惯例），保留 `Cmd/Ctrl+K` 给未来全局搜索。

### 10.2 设置页面对比

| 设置分类 | Orkas (3 tabs) | MyAgent Spec (8 tabs) | MyAgent Plan | 说明 |
|---------|---------------|----------------------|-------------|------|
| 数据 (Data) | ✅ 工作区 + 路径 + 回收站 + Memory 入口 | — | — | 拆分到 MyAgent 的「路径与权限」+ 上下文 |
| 配置 (Credentials) | ✅ API Keys + **拖拽排序 fallback 链** + OAuth + Search/Image/Video/TTS Keys | ✅ 🤖 模型 (含 Provider 卡片) | Plan B Task 4 + 🆕动态 Provider | 🟢 已覆盖 |
| 通用 (General) | ✅ Language + Avatar + **Tool Execution Access** (Cautious/Standard/Trusted) + Metacognition toggle | ✅ 🎨 外观 | Plan B Task 4 | 🟢 外观已覆盖 |
| 工具 (Tools) | — (分散在 Tool Access 模式 + bash_permission) | ✅ 🔧 工具 | Plan B Task 4 | 🟢 已覆盖 |
| 路径与权限 | — (在 Data tab 内) | ✅ 📁 路径与权限 | Plan B Task 4 | 🟢 已覆盖 |
| 上下文 (Context) | — | ✅ 🧠 上下文 | Plan B Task 4 | 🟢 已覆盖 |
| 开发者 (Developer) | — | ✅ 🧪 开发者 | Plan B Task 4 | 🟢 已覆盖 |
| 定时任务 (Auto) | 独立页面 | ⏰ 侧栏图标 | ❌ Plan B 未覆盖 | 🟡 延后 |
| 日志 (Logs) | — | 📜 侧栏二级导航 | ❌ Plan B 未覆盖 | 🔴 遗漏 |

> ⚠️ **Spec 写了 8 个设置二级导航**（含 ⏰ 定时任务 + 📜 日志），但 **Plan B 只实现了 6 个 tab**（模型/工具/路径/上下文/外观/开发者）。定时任务和日志 tab 在 Plan B settings.js 中未实现。
>
> ⚠️ **Orkas 的 Provider fallback 链支持拖拽排序**（`settings.js` credentials tab），MyAgent 当前 Plan B 的 provider 卡片按 `priority` 字段排序但无拖拽 UI。
>
> ⚠️ **Orkas 支持 OAuth 授权流程**（callback-server + device-code），MyAgent 仅支持 API Key。对个人工具来说 API Key 足够。

### 10.3 对话页功能对比

| 功能 | Orkas | MyAgent Plan | 状态 |
|------|-------|-------------|------|
| 消息气泡 (user/assistant) | ✅ | Plan B chat.js | 🟢 |
| 流式文本接收 (text_delta) | ✅ | Plan B chat.js | 🟢 |
| 工具调用卡片 (折叠/展开/错误) | ✅ + per-line kind icons + runtime/duration | Plan B chat.js | 🟢 |
| 工具执行状态 (running/done/error) | ✅ process pane + expandable rows | Plan B chat.js | 🟢 |
| Markdown 渲染 | ✅ marked + 稳定媒体保留 | Plan A + B | 🟢 |
| 代码高亮 | ✅ highlight.js | Plan A vendor | 🟢 |
| MathJax 数学公式 | ✅ math.js (per-bubble typeset) | ❌ 未计划 | 🟡 |
| 图片 lightbox | ✅ chat-lightbox.js | ❌ 未计划 | 🟡 |
| 文件预览 (pdf/docx) | ✅ chat-file-viewer.js | ❌ 未计划 | 🟡 |
| 附件上传 (拖拽 + 粘贴) | ✅ chat-input-form.js | Plan B 提及 📎 按钮 | 🟡 |
| 会话自动标题 | ✅ auto-title.js | ❌ 未计划 | 🟡 |
| 右键上下文菜单 | ✅ context-menu.js | ❌ 未计划 | 🟡 |
| 消息操作 (复制/重新生成/删除) | ✅ conversation.js selection toolbar | ❌ Plan B 未实现 | 🔴 |
| 消息引用/转发 (多选→引用) | ✅ selection toolbar | ❌ 未计划 | 🟡 |
| 📌 会话置顶 | ✅ conversation.js pinning | ❌ 未计划 | 🟡 |
| 会话分组 (Projects) | ✅ sidebar projects section | ❌ Plan B 只按时段分组 | 🟡 |
| Agent 头像堆叠 (会话列表) | ✅ max 4 avatar slots | ❌ 无 | 🟡 |
| 🗨️ 消息队列 (streaming 期间排队) | ✅ queue-draft.js | ❌ 无 | 🟡 |
| LLM 生成的表单组件 | ✅ chat-input-form.js | ❌ 无 | ⚪ |
| Rich composer (@{skill}/@{connector} chips) | ✅ chat-use.js | ❌ 无 | ⚪ |
| Workspace chip per composer | ✅ user-workspace.js | 静态 📁 chip | 🟡 |
| 对话信息面板 (Tasks/Files/Attachments) | ✅ conversation-info.js | ❌ 无 | 🟡 |
| XSS 防护 | ✅ DOMPurify | escapeHtml 函数 | 🟡 |

### 10.4 Skills 管理页面对比

| 功能 | Orkas | MyAgent Plan | 状态 |
|------|-------|-------------|------|
| Skill 卡片网格 | ✅ skills.js | Plan B skills.js | 🟢 |
| 分类筛选 (chip) | ✅ | Plan B skills.js | 🟢 |
| 启用/禁用 Toggle | ✅ | Plan B skills.js | 🟢 |
| 来源标签 (内置/自定义/市场) | ✅ skills-bindings.js | Plan B skills.js (source 字段) | 🟢 |
| Marketplace 安装 | ✅ marketplace.js | ❌ Plan B 有按钮但无功能 | 🟡 |
| Skill 新建/编辑 | ✅ skills.js (编辑聊天) | ❌ Plan B 有按钮但无功能 | 🟡 |
| Skill 脚本执行入口 | ✅ run-skill.cjs | ❌ Plan C 也未涉及 | 🔴 |
| 打开 Skill 目录 | ✅ | Plan B 有「📂 打开目录」按钮 | 🟢 |

### 10.5 缺失功能汇总（按优先级）

#### 🔴 P0 — 应立即补充到 Plan

| # | 功能 | Orkas 对应 | 建议 |
|---|------|-----------|------|
| 1 | **Provider 动态配置** (API Key 输入/编辑/删除) | `settings.js` credentials tab | ✅ 已补充到 Plan A Task 4.5 + Plan B settings.js |
| 2 | **消息操作菜单** (复制/重新生成/删除) | `context-menu.js` | 需补充到 Plan B chat.js |
| 3 | **设置页日志 tab** | Spec §4.3 写了 📜 日志 | Plan B 遗漏，需补 |

#### 🟡 P1 — 建议后续 Plan 覆盖

| # | 功能 | Orkas 对应 | 建议 |
|---|------|-----------|------|
| 4 | 项目管理页 (列表 + 详情) | `projects.js` + `project-detail.js` | 新增 Plan D |
| 5 | 知识库 Context 管理 | `contexts.js` + `kb-picker.js` | 新增 Plan D |
| 6 | Skill Marketplace 安装 | `marketplace.js` | 补到 Plan C Skill 部分 |
| 7 | 会话自动标题 | `auto-title.js` | 补到 Plan C stream-chat |
| 8 | 全局搜索 (Cmd/Ctrl+K) | `search.js` | 修改快捷键分配 |
| 9 | MathJax 数学公式渲染 | `math.js` | 补到 Plan A vendor |
| 10 | 图片 lightbox | `chat-lightbox.js` | 补到 Plan B chat.js |
| 11 | 拖拽文件上传 | `chat-input-form.js` | 补到 Plan B chat.js |
| 12 | 🔧 Provider 拖拽排序 (fallback 链) | `settings.js` credentials tab | Plan B provider 卡片加拖拽 |
| 13 | 💬 消息引用/转发 (多选 → 引用) | `conversation.js` selection toolbar | 补到 Plan B chat.js |
| 14 | 📌 会话置顶 (pin) | `conversation.js` pinning | 补到 Plan A session-repo + Plan B |
| 15 | 🛡️ DOMPurify XSS 防护 | `vendor/dompurify` | 补到 Plan A vendor (替换 escapeHtml) |
| 16 | 🗨️ Per-conversation 消息队列 | `queue-draft.js` | 补到 Plan B chat.js |
| 17 | 📊 LLM 生成的 dashboard 渲染 | `utils.js` renderDashboard | 可延后 |
| 18 | 🔐 Provider OAuth 授权流程 | `settings.js` OAuth callbacks | 可延后 (先用 API Key) |

#### ⚪ P2 — MyAgent 暂不需要

| 功能 | 原因 |
|------|------|
| Connectors (MCP) | MyAgent 走直接 Provider 配置 |
| Artifacts / Saved Apps | 太重，个人工具不需要 |
| Agents 管理 (自定义 Agent) | 可延后到多 Agent 场景 |
| Auto Tasks / 定时任务 | Spec 已标记"未来" |
| Relay (iOS 遥控) | 单机应用 |
| i18n 国际化 (4 locales) | 个人工具，中文即可 |
| External CLI agent (Claude Code/Codex) | MyAgent 自身就是 Agent |
| Interactive CLI floating panel | 仅 CLI agent 需要 |
| LLM input-form widgets | 太重 |
| Marketplace upload | 个人工具 |
| i18n 国际化 | 个人工具，中文即可 |

### 10.6 快捷键分配对比

| 快捷键 | Orkas | MyAgent Spec | 建议 |
|--------|-------|-------------|------|
| `Cmd/Ctrl+K` | 全局搜索 | 聚焦输入框 | → 改为 `Cmd/Ctrl+L`（浏览器惯例） |
| `Cmd/Ctrl+N` | 新建 Commander | 新建会话 | 🟢 一致 |
| `Cmd/Ctrl+,` | — | 打开设置 | 🟢 可用 |
| `Cmd/Ctrl+B` | — | 切换侧栏 | 🟢 可用（与加粗冲突需处理） |
| `Esc` | 关闭弹层/停止 | 关闭弹层/停止生成 | 🟢 一致 |

---

## 11. 后续步骤 (原 §10)

1. **设计稿评审** ← 当前阶段
2. 调用 `writing-plans` skill，将本设计稿拆分为可执行的实现计划
3. 按 5 周路线图实施：
   - W1：项目骨架 + IPC + 会话/工具基础 API
   - W2：存储层（SQLite + JSONL + 锁）
   - W3：Renderer 骨架 + 路由 + 对话页
   - W4：会话管理 + 设置 + Skills 三页
   - W5：打磨 + 测试 + 打包

---

**附：四屏原型图**

- [chat-page-final.html](../../.superpowers/brainstorm/1004-1785825477/content/chat-page-final.html)
- [sessions-page.html](../../.superpowers/brainstorm/1004-1785825477/content/sessions-page.html)
- [settings-page.html](../../.superpowers/brainstorm/1004-1785825477/content/settings-page.html)
- [skills-page.html](../../.superpowers/brainstorm/1004-1785825477/content/skills-page.html)