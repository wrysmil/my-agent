---
artifact: spec
route: superpowers:brainstorming
skills:
  - brainstorming
skills_evidence:
  - ~/.claude/skills/brainstorming/SKILL.md
source:
  - AGENTS.md
  - core/routing.md
created_at: 2026-08-08
status: draft
approved: false
---

# 工具管理页面（只读查看）— 设计方案

## 1. 背景与目标

my-agent 后端 `src/tools/` 已有完整的工具系统：
- `base.ts`：`AgentTool` 接口、`defineTool()` 工厂、`ToolContext`、`ToolResult`
- `builtin.ts`：8 个内置工具（`read_file`、`write_file`、`edit_file`、`list_files`、`search_files`、`grep_files`、`bash`、`web_fetch`），统一导出为 `BUILTIN_TOOLS`

当前前端有 Dashboard、Chat、Sessions、Providers、Skills、Agents、Settings 页面，**缺少工具管理页面**。用户无法在 Web UI 中查看当前可用的工具及其参数定义。

**目标：** 新增只读的工具管理页面，展示 8 个内置工具的元信息，不包含新增/编辑/删除功能。页面风格与现有 SkillsPage 保持一致。

## 2. 用户需求摘要

- **范围：** 只读查看（用户明确选择 A）
- **布局：** 与 SkillsPage 一致的卡片风格（用户明确选择 C）
- **API 模式：** 列表 + 详情分离（用户明确选择 B）
- 卡片展示 name + description（截断），点击弹出 DetailPanel 查看完整 inputSchema

## 3. 方案概述

唯一方案 — **新增只读 Tools 页面，模仿 SkillsPage 布局但去操作功能**：

```
GET /api/tools        → 返回工具摘要列表（name, description, executionMode）
GET /api/tools/:name  → 返回单个工具完整信息（含 inputSchema）
         │
         ▼
ToolsPage 卡片网格 + DetailPanel 弹窗
Sidebar 新增 Tools 导航项（Wrench 图标）
```

### 3.1 备选方案对比

| 维度 | 方案 A：与 SkillsPage 一致 | 方案 B：独立表格页面 | 方案 C：嵌入 Settings |
|------|--------------------------|-------------------|---------------------|
| 一致性 | ✅ 与 Skills/Agents 对齐 | ❌ 风格不一致 | ❌ Settings 已臃肿 |
| 扩展性 | ✅ 未来加 CRUD 可直接参考 SkillsPage | ⚠️ 表格适合批量操作 | ❌ 非独立页面 |
| 实现成本 | ✅ 复用 SkillsPage 结构 | ⚠️ 需新 layout | ✅ 最少文件改动 |
| 用户体验 | ✅ 浏览感好，3 列网格清晰 | ⚠️ 8 个工具用表格显空 | ❌ 位置不直观 |

**选择方案 A**：与 SkillsPage 一致，用户已确认 C。

## 4. 后端设计

### 4.1 新增文件：`src/web/server/routes/tools.ts`

- **`listToolsHandler`（`GET /api/tools`）** — 遍历 `BUILTIN_TOOLS`，返回摘要：

```typescript
// 响应格式
{
  ok: true,
  data: {
    tools: Array<{
      name: string;
      description: string;
      executionMode?: "sequential" | "parallel";
    }>
  }
}
```

- **`getToolHandler`（`GET /api/tools/:name`）** — 按 name 匹配单个工具：

```typescript
// 响应格式
{
  ok: true,
  data: {
    tool: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      executionMode?: "sequential" | "parallel";
    }
  }
}
```

未匹配时返回 `{ ok: false, error: { code: "NOT_FOUND", message: "工具不存在: <name>" } }`（404）。

### 4.2 路由注册

**`router.ts`** — ROUTES 数组追加 2 条占位：

```typescript
["GET", "/api/tools", routeNotFoundPlaceholder, []],
["GET", /^\/api\/tools\/([^/]+)$/, routeNotFoundPlaceholder, ["name"]],
```

**`wire-routes.ts`** — 在 `wireApiRoutes()` 末尾接入：

```typescript
// ── Tools 域 (2 条) ──
replaceHandler("GET", "/api/tools", listToolsHandler);
replaceHandler("GET", /^\/api\/tools\/([^/]+)$/,
  (req, res, params) => getToolHandler(req, res, params));
```

无额外依赖（直接 import `BUILTIN_TOOLS`）。

## 5. 前端设计

### 5.1 新增文件

| 文件 | 说明 |
|------|------|
| `features/tools/useTools.ts` | TanStack Query hooks：`useTools()` 列表、`useToolDetail(name)` 详情 |
| `pages/ToolsPage.tsx` | 页面组件：卡片网格 + DetailPanel 弹窗 |

### 5.2 修改文件

| 文件 | 变更 |
|------|------|
| `routes.tsx` | 新增 `{ path: 'tools', element: <ToolsPage /> }` |
| `Sidebar.tsx` | `navItems` 追加 `{ to: '/tools', label: 'Tools', icon: Wrench }` |
| `lib/query-keys.ts` | 新增 `tools` 查询 key |

### 5.3 ToolsPage 组件结构

```
ToolsPage
├── Header（标题 "工具" + 工具数量统计）
├── 状态处理
│   ├── isLoading → LoadingSkeleton（6 个占位卡片）
│   ├── isError  → ErrorState（重试按钮）
│   └── empty    → EmptyState（"暂无工具"）
└── 卡片网格（grid-cols-1 sm:grid-cols-2 lg:grid-cols-3）
    └── ToolCard × N
        ├── 工具名称（h3）
        ├── executionMode 标签（"sequential" / "parallel"，小 badge）
        ├── 描述（line-clamp-2）
        └── onClick → 加载详情 → 打开 DetailPanel

DetailPanel（弹窗）
├── Header（工具名称 + 关闭按钮）
├── Body
│   ├── 描述（全量）
│   ├── executionMode 标签
│   └── inputSchema（格式化 JSON 展示，pre 块 + 语法高亮类 bg-bg）
└── （无编辑/删除按钮 — 只读）
```

### 5.4 与 SkillsPage 的关键差异

| 维度 | SkillsPage | ToolsPage |
|------|-----------|-----------|
| 新建按钮 | ✅ `+ 新建技能` | ❌ 无 |
| 卡片 source 标签 | ✅ user/marketplace/builtin | ❌ 全部 builtin，不展示 |
| 详情面板操作 | ✅ 删除按钮（仅 user） | ❌ 无操作按钮 |
| 详情内容 | body 文本 | inputSchema JSON（格式化） |
| 数据 hooks | `useSkills()` | `useTools()` / `useToolDetail()` |
| API 端点 | `/api/skills` + `/api/skills/:id` | `/api/tools` + `/api/tools/:name` |

### 5.5 状态处理矩阵

| 状态 | 表现 |
|------|------|
| Loading | 6 个灰色占位卡片（animate-pulse），与 SkillsPage 一致 |
| Empty | 虚线边框居中提示："暂无可用工具" |
| Error | 红色边框提示错误信息 + 重试按钮 |
| Success | 3 列卡片网格，点击卡片加载详情弹窗 |
| Detail loading | 全屏半透明遮罩 + 居中 spinner |
| Detail 404 | toast 提示后关闭弹窗 |

## 6. 测试策略

### 6.1 后端单元测试（`tools.test.ts`，新建或追加到现有 `test/builtin-tools.test.ts`）

- `GET /api/tools` 返回 8 个工具的摘要列表
- `GET /api/tools/:name` 对存在的工具返回完整信息（含 inputSchema）
- `GET /api/tools/:name` 对不存在的工具返回 404 + NOT_FOUND

### 6.2 前端单元测试（`web/tests/unit/tools-page.test.tsx`，新建）

- 加载态渲染 LoadingSkeleton
- 成功态渲染 8 个 ToolCard
- 空列表态渲染 EmptyState
- 错误态渲染 ErrorState + 重试按钮
- 点击卡片打开 DetailPanel
- DetailPanel 展示 inputSchema JSON
- DetailPanel 有关闭按钮

### 6.3 集成测试

- Sidebar 存在 Tools 导航项，点击跳转到 `/tools`
- 路由 `/tools` 渲染 ToolsPage

## 7. 数据流

```
BUILTIN_TOOLS (常量, src/tools/builtin.ts)
  │
  ├── listToolsHandler ──► GET /api/tools ──► useTools() ──► ToolsPage 卡片网格
  │
  └── getToolHandler ───► GET /api/tools/:name ──► useToolDetail(name) ──► DetailPanel
```

## 8. 约束与边界

- **不新增数据库/文件存储** — 工具数据完全来自 `BUILTIN_TOOLS` 常量
- **不修改 `AgentTool` 接口** — 现有接口已满足需求
- **不涉及工具执行** — 纯元数据展示，不触发工具调用
- **不涉及工具启用/禁用** — 本次为只读
- **不修改现有测试** — 新增测试文件独立运行

## Spec 自检

- [x] 无 TBD / TODO / 占位符
- [x] 前后端接口契约一致（列表 + 详情两种响应格式）
- [x] 与 SkillsPage 的差异逐项列清（§5.4）
- [x] 状态处理矩阵覆盖所有路径（Loading / Empty / Error / Success / Detail loading / 404）
- [x] 测试策略覆盖后端 + 前端 + 集成
- [x] 范围锁定为只读查看，无功能蔓延

## Next

**（写入后须暂停，等用户明确继续 — 见 `harness-kit/core/routing.md` § 阶段门禁）**

- 确认方案无误 → 说「写计划」或「制定实施计划」
- 变更范围小、无需计划 → 说「直接实现」或「直接做」
- 需要调整方案 → 直接说修改意见
