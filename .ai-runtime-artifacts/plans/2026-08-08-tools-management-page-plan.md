---
artifact: implementation-plan
route: superpowers:brainstorming -> superpowers:writing-plans
skills:
  - brainstorming
  - writing-plans
skills_evidence:
  - ~/.claude/skills/brainstorming/SKILL.md
  - ~/.claude/skills/writing-plans/SKILL.md
dispatch: n/a
source:
  - AGENTS.md
  - core/routing.md
  - .ai-runtime-artifacts/specs/2026-08-08-tools-management-page-spec.md
created_at: 2026-08-08
status: draft
approved: false
---

# 工具管理页面（只读查看）— 实施计划

> **For agentic workers:** 使用 `orchestration` skill 委派 `implementer` 子 Agent 逐 task 执行。Steps 使用 checkbox (`- [ ]`) 语法追踪进度。

**Goal:** 为 my-agent Web 前端新增只读工具管理页面，展示 8 个内置工具的元信息。

**Architecture:** 后端新增 `routes/tools.ts` 提供 `GET /api/tools`（列表）+ `GET /api/tools/:name`（详情），数据源为 `BUILTIN_TOOLS` 常量。前端新增 `ToolsPage`（卡片网格 + DetailPanel），完全仿 `SkillsPage` 布局但去掉所有 CRUD 操作。Sidebar 新增 Tools 导航项。

**Tech Stack:** TypeScript (Node.js ESM), React 18 + React Router 6 + TanStack Query, Vitest + @testing-library/react

**TDD Required:** YES（每个 Task 遵循 RED-GREEN-REFACTOR）

**范围：** 6 个 Task，约 60-90 分钟

---

## 文件映射

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/web/server/routes/tools.ts` | **新建** | `listToolsHandler` + `getToolHandler`，从 `BUILTIN_TOOLS` 读取数据 |
| `src/web/server/router.ts` | 修改 | ROUTES 追加 2 条占位路由 |
| `src/web/server/wire-routes.ts` | 修改 | 接入 tools handler |
| `test/tools-page-api.test.ts` | **新建** | 后端 API 测试（3 条） |
| `web/src/features/tools/useTools.ts` | **新建** | `useTools()` + `useToolDetail(name)` hooks |
| `web/src/lib/query-keys.ts` | 修改 | 新增 `tools` 查询 key |
| `web/src/pages/ToolsPage.tsx` | **新建** | 页面组件（卡片网格 + DetailPanel） |
| `web/src/routes.tsx` | 修改 | 新增 `/tools` 路由 |
| `web/src/components/layout/Sidebar.tsx` | 修改 | navItems 追加 Tools 项 |
| `web/src/i18n/zh.json` | 修改 | 新增 `nav.tools` + `tools.*` 中文 key |
| `web/src/i18n/en.json` | 修改 | 新增 `nav.tools` + `tools.*` 英文 key |
| `web/tests/unit/tools-page.test.tsx` | **新建** | 前端页面测试（7 条） |

---

### Task 1: 后端 API — `GET /api/tools` 列表 + 详情

**Files:**
- Create: `src/web/server/routes/tools.ts`
- Modify: `src/web/server/router.ts`
- Modify: `src/web/server/wire-routes.ts`
- Create: `test/tools-page-api.test.ts`

- [ ] **Step 1: 写入后端 API 测试**

```typescript
// test/tools-page-api.test.ts
import { describe, it, expect } from 'vitest';
import { BUILTIN_TOOLS } from '../src/tools/builtin.js';
import { listToolsHandler, getToolHandler } from '../src/web/server/routes/tools.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createMockReqRes } from './helpers/http.js'; // 项目已有

describe('Tools API', () => {
  describe('GET /api/tools (list)', () => {
    it('返回 8 个内置工具的摘要列表', async () => {
      const { req, res } = createMockReqRes('GET', '/api/tools');
      await listToolsHandler(req, res, {});
      const body = JSON.parse(res._getData());
      expect(body.ok).toBe(true);
      expect(body.data.tools).toHaveLength(8);
      for (const t of body.data.tools) {
        expect(t).toHaveProperty('name');
        expect(t).toHaveProperty('description');
        // 摘要不应包含 inputSchema
        expect(t).not.toHaveProperty('inputSchema');
      }
    });

    it('每个工具包含 name, description, executionMode 字段', async () => {
      const { req, res } = createMockReqRes('GET', '/api/tools');
      await listToolsHandler(req, res, {});
      const { data } = JSON.parse(res._getData());
      for (const t of data.tools) {
        expect(typeof t.name).toBe('string');
        expect(typeof t.description).toBe('string');
        expect(['sequential', 'parallel', undefined]).toContain(t.executionMode);
      }
    });
  });

  describe('GET /api/tools/:name (detail)', () => {
    it('返回存在的工具的完整信息（含 inputSchema）', async () => {
      const { req, res } = createMockReqRes('GET', '/api/tools/read_file');
      await getToolHandler(req, res, { name: 'read_file' });
      const body = JSON.parse(res._getData());
      expect(body.ok).toBe(true);
      expect(body.data.tool.name).toBe('read_file');
      expect(body.data.tool).toHaveProperty('description');
      expect(body.data.tool).toHaveProperty('inputSchema');
      expect(body.data.tool.inputSchema).toHaveProperty('type', 'object');
      expect(body.data.tool.inputSchema).toHaveProperty('properties');
    });

    it('不存在的工具返回 404', async () => {
      const { req, res } = createMockReqRes('GET', '/api/tools/nonexistent');
      await getToolHandler(req, res, { name: 'nonexistent' });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res._getData());
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('TOOL_NOT_FOUND');
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run test/tools-page-api.test.ts
```
预期：全部 FAIL，因为 `routes/tools.ts` 不存在。

- [ ] **Step 3: 创建 `src/web/server/routes/tools.ts`**

```typescript
// src/web/server/routes/tools.ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BUILTIN_TOOLS } from '../../../src/tools/builtin.js';

export async function listToolsHandler(
  _req: IncomingMessage,
  res: ServerResponse,
  _params: Record<string, string>,
): Promise<void> {
  const tools = BUILTIN_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    ...(t.executionMode ? { executionMode: t.executionMode } : {}),
  }));

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true, data: { tools } }));
}

export async function getToolHandler(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): Promise<void> {
  const name = params.name;
  const tool = BUILTIN_TOOLS.find((t) => t.name === name);

  if (!tool) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        ok: false,
        error: { code: 'TOOL_NOT_FOUND', message: `工具不存在: ${name}` },
      }),
    );
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(
    JSON.stringify({
      ok: true,
      data: {
        tool: {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
        },
      },
    }),
  );
}
```

- [ ] **Step 4: 修改 `src/web/server/router.ts`** — ROUTES 数组末尾追加：

```typescript
// ---- Tools 域（只读查看） ----
["GET", "/api/tools", routeNotFoundPlaceholder, []],
["GET", /^\/api\/tools\/([^/]+)$/, routeNotFoundPlaceholder, ["name"]],
```

插入位置：`["DELETE", ...skills...]` 之后、`];` 之前。

- [ ] **Step 5: 修改 `src/web/server/wire-routes.ts`** — 在 `wireApiRoutes()` 末尾的 skills 接线之后、函数结束 `}` 之前插入：

```typescript
// ── Tools 域 (2 条) ──
const { listToolsHandler, getToolHandler } = await import("./routes/tools.js");
replaceHandler("GET", "/api/tools", listToolsHandler);
replaceHandler(
  "GET",
  /^\/api\/tools\/([^/]+)$/,
  (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) =>
    getToolHandler(req, res, params),
);
if (logger) logger.info("[wire] tools: 2 handlers wired");
```

注意：由于 `wireApiRoutes` 不是 async 函数，改用顶层 dynamic import 或同步 require。实际采用**顶层 static import**（在文件头部添加 import 语句）：

```typescript
// 在现有 import 块末尾追加:
import { listToolsHandler, getToolHandler } from "./routes/tools.js";
```

然后接线部分简化为：

```typescript
// ── Tools 域 (2 条) ──
replaceHandler("GET", "/api/tools", listToolsHandler);
replaceHandler(
  "GET",
  /^\/api\/tools\/([^/]+)$/,
  (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) =>
    getToolHandler(req, res, params),
);
if (logger) logger.info("[wire] tools: 2 handlers wired");
```

- [ ] **Step 6: 运行测试验证通过**

```bash
npx vitest run test/tools-page-api.test.ts
```
预期：5 条测试全部 PASS。

- [ ] **Step 7: 提交**

```bash
git add src/web/server/routes/tools.ts \
        src/web/server/router.ts \
        src/web/server/wire-routes.ts \
        test/tools-page-api.test.ts
git commit -m "feat(api): add GET /api/tools list + detail endpoints

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 前端数据层 — `useTools` hook + query key

**Files:**
- Create: `web/src/features/tools/useTools.ts`
- Modify: `web/src/lib/query-keys.ts`

- [ ] **Step 1: 写入前端数据层测试**

`web/tests/unit/tools-page.test.tsx` 中先写入 hook 相关测试（后续 Task 4 追加页面测试）：

```typescript
// web/tests/unit/tools-page.test.tsx (第一部分 — hook 测试)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTools, useToolDetail } from '../../src/features/tools/useTools';

// fetch mock
const mockFetch = vi.fn();
global.fetch = mockFetch;

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => { mockFetch.mockReset(); });
afterEach(() => { mockFetch.mockReset(); });

describe('useTools', () => {
  it('成功时返回工具摘要列表', async () => {
    const mockTools = [
      { name: 'read_file', description: 'Read file', executionMode: 'sequential' },
      { name: 'bash', description: 'Run shell', executionMode: 'sequential' },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        ok: true,
        data: { tools: mockTools },
      })),
    });

    const { result } = renderHook(() => useTools(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0].name).toBe('read_file');
  });

  it('API 错误时 isError 为 true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'fail' },
      })),
    });

    const { result } = renderHook(() => useTools(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useToolDetail', () => {
  it('enabled=false 时不发起请求', () => {
    const { result } = renderHook(
      () => useToolDetail('read_file', false),
      { wrapper },
    );
    expect(result.current.isPending).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('成功时返回完整工具信息', async () => {
    const toolDetail = {
      name: 'read_file',
      description: 'Read file content',
      inputSchema: { type: 'object', properties: {} },
      executionMode: 'sequential',
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        ok: true,
        data: { tool: toolDetail },
      })),
    });

    const { result } = renderHook(
      () => useToolDetail('read_file', true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(toolDetail);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run web/tests/unit/tools-page.test.tsx
```
预期：全部 FAIL，因为 `useTools.ts` 不存在。

- [ ] **Step 3: 修改 `web/src/lib/query-keys.ts`** — 在 `agents` 块之后追加：

```typescript
tools: {
  all: ['tools'] as const,
  detail: (name: string) => ['tools', name] as const,
},
```

- [ ] **Step 4: 创建 `web/src/features/tools/useTools.ts`**

```typescript
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface ToolSummary {
  name: string;
  description: string;
  executionMode?: 'sequential' | 'parallel';
}

export interface ToolDetail {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  executionMode?: 'sequential' | 'parallel';
}

interface ToolsListResponse {
  tools: ToolSummary[];
}

interface ToolDetailResponse {
  tool: ToolDetail;
}

export function useTools() {
  return useQuery({
    queryKey: queryKeys.tools.all,
    queryFn: () => apiGet<ToolsListResponse>('/api/tools'),
    select: (data) => data.tools,
  });
}

export function useToolDetail(name: string, enabled: boolean = false) {
  return useQuery({
    queryKey: queryKeys.tools.detail(name),
    queryFn: () => apiGet<ToolDetailResponse>(`/api/tools/${name}`),
    select: (data) => data.tool,
    enabled,
  });
}
```

- [ ] **Step 5: 运行测试验证通过**

```bash
npx vitest run web/tests/unit/tools-page.test.tsx
```
预期：5 条测试全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add web/src/features/tools/useTools.ts \
        web/src/lib/query-keys.ts \
        web/tests/unit/tools-page.test.tsx
git commit -m "feat(web): add useTools + useToolDetail hooks and query keys

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 前端页面 — ToolsPage 组件

**Files:**
- Create: `web/src/pages/ToolsPage.tsx`

- [ ] **Step 1: 追加页面组件测试**

在 `web/tests/unit/tools-page.test.tsx` 末尾追加：

```typescript
// ====== Task 3: 页面组件测试 ======
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToolsPage } from '../../src/pages/ToolsPage';

describe('ToolsPage', () => {
  const mockTools = [
    { name: 'read_file', description: 'Read file contents', executionMode: 'sequential' },
    { name: 'bash', description: 'Execute shell commands', executionMode: 'sequential' },
    { name: 'web_fetch', description: 'Fetch web page content', executionMode: 'sequential' },
  ];

  const toolDetail = {
    name: 'read_file',
    description: 'Read file contents with offset/limit support',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to file' },
        offset: { type: 'number', description: 'Start line number' },
      },
      required: ['filePath'],
    },
    executionMode: 'sequential',
  };

  function renderPage() {
    mockFetch.mockReset();
    // 列表响应
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        ok: true,
        data: { tools: mockTools },
      })),
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><ToolsPage /></MemoryRouter>
      </QueryClientProvider>
    );
  }

  it('渲染 Loading 骨架屏', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // 永远 pending
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><ToolsPage /></MemoryRouter>
      </QueryClientProvider>
    );
    expect(screen.getByTestId('tools-loading')).toBeDefined();
  });

  it('成功加载后渲染工具卡片列表', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('read_file')).toBeDefined();
      expect(screen.getByText('bash')).toBeDefined();
      expect(screen.getByText('web_fetch')).toBeDefined();
    });
    // 每个卡片应该有描述
    expect(screen.getByText('Read file contents')).toBeDefined();
  });

  it('点击卡片打开 DetailPanel', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('read_file')).toBeDefined());

    // mock detail 请求
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        ok: true,
        data: { tool: toolDetail },
      })),
    });

    fireEvent.click(screen.getByText('read_file'));

    await waitFor(() => {
      expect(screen.getByText('Read file contents with offset/limit support')).toBeDefined();
    });
    // inputSchema 应该以 JSON 形式展示
    expect(screen.getByText(/"type"/)).toBeDefined();
  });

  it('API 错误时渲染 ErrorState + 重试按钮', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'server error' },
      })),
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><ToolsPage /></MemoryRouter>
      </QueryClientProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId('tools-error')).toBeDefined();
      expect(screen.getByText('重试')).toBeDefined();
    });
  });

  it('空列表时渲染 EmptyState', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        ok: true,
        data: { tools: [] },
      })),
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><ToolsPage /></MemoryRouter>
      </QueryClientProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId('tools-empty')).toBeDefined();
    });
  });

  it('DetailPanel 点击关闭按钮关闭弹窗', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('read_file')).toBeDefined());

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        ok: true,
        data: { tool: toolDetail },
      })),
    });
    fireEvent.click(screen.getByText('read_file'));

    await waitFor(() => expect(screen.getByText(/"type"/)).toBeDefined());

    // 点击遮罩关闭
    const overlay = document.querySelector('.fixed.inset-0');
    if (overlay) fireEvent.click(overlay);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run web/tests/unit/tools-page.test.tsx
```
预期：Task 2 的 5 条 hook 测试 PASS，Task 3 的 6 条页面测试 FAIL（ToolsPage 不存在）。

- [ ] **Step 3: 创建 `web/src/pages/ToolsPage.tsx`**

```typescript
import { useState } from 'react';
import { useTools, useToolDetail, type ToolSummary, type ToolDetail } from '@/features/tools/useTools';
import { X } from 'lucide-react';

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="tools-loading">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-lg border border-border bg-surface p-5">
          <div className="mb-3 h-5 w-2/3 rounded bg-border" />
          <div className="h-4 w-full rounded bg-border" />
          <div className="mt-2 h-4 w-4/5 rounded bg-border" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-danger/30 bg-danger-bg p-8" data-testid="tools-error">
      <p className="mb-3 text-sm text-danger">{message}</p>
      <button onClick={onRetry} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:opacity-90">
        重试
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12" data-testid="tools-empty">
      <p className="text-sm text-text-muted">暂无可用工具</p>
    </div>
  );
}

function DetailPanel({ tool, onClose }: { tool: ToolDetail; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40" onClick={onClose}>
      <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[70vh] flex flex-col m-4" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">{tool.name}</h2>
            {tool.executionMode && (
              <span className="inline-block mt-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-fg">
                {tool.executionMode}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-hover">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm text-text-muted mb-4">{tool.description}</p>
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Input Schema</h4>
          <pre className="text-sm whitespace-pre-wrap font-mono bg-bg rounded-md p-4 border border-border max-h-80 overflow-y-auto">
            {JSON.stringify(tool.inputSchema, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

export function ToolsPage() {
  const { data: tools, isLoading, isError, error, refetch } = useTools();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const {
    data: toolDetail,
    isLoading: detailLoading,
    isError: detailError,
  } = useToolDetail(selectedName ?? '', !!selectedName);

  // detail 404 → 自动关闭弹窗
  if (detailError && selectedName) {
    setSelectedName(null);
  }

  return (
    <div className="p-6" data-testid="page-tools">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-text">工具</h1>
        <p className="mt-1 text-sm text-text-muted">
          {tools ? `共 ${tools.length} 个工具` : '内置工具列表'}
        </p>
      </div>

      {/* Detail loading overlay */}
      {detailLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {isLoading && <LoadingSkeleton />}
      {isError && (
        <ErrorState
          message={error instanceof Error ? error.message : '加载工具列表失败'}
          onRetry={() => refetch()}
        />
      )}
      {!isLoading && !isError && tools && tools.length === 0 && <EmptyState />}
      {!isLoading && !isError && tools && tools.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool: ToolSummary) => (
            <div
              key={tool.name}
              className="cursor-pointer rounded-lg border border-border bg-surface p-5 transition-shadow hover:shadow-md"
              onClick={() => setSelectedName(tool.name)}
              data-testid="tool-card"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold text-text">{tool.name}</h3>
                {tool.executionMode && (
                  <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-fg">
                    {tool.executionMode}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-text-muted line-clamp-2">
                {tool.description || '无描述'}
              </p>
            </div>
          ))}
        </div>
      )}

      {toolDetail && selectedName && (
        <DetailPanel tool={toolDetail} onClose={() => setSelectedName(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npx vitest run web/tests/unit/tools-page.test.tsx
```
预期：全部 11 条测试 PASS（Task 2 的 5 条 + Task 3 的 6 条）。

- [ ] **Step 5: 提交**

```bash
git add web/src/pages/ToolsPage.tsx web/tests/unit/tools-page.test.tsx
git commit -m "feat(web): add ToolsPage with card grid + detail panel

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 路由 + 侧边栏导航集成

**Files:**
- Modify: `web/src/routes.tsx`
- Modify: `web/src/components/layout/Sidebar.tsx`
- Modify: `web/src/i18n/zh.json`
- Modify: `web/src/i18n/en.json`

- [ ] **Step 1: 写入集成测试**

追加到 `web/tests/unit/tools-page.test.tsx`：

```typescript
// ====== Task 4: 路由与导航集成测试 ======
import { AppShell } from '../../src/components/layout/AppShell';
import { routes } from '../../src/routes';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

describe('Tools route integration', () => {
  it('Sidebar 包含 Tools 导航项', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><AppShell /></MemoryRouter>
      </QueryClientProvider>
    );
    expect(screen.getByText('工具')).toBeDefined();
  });

  it('/tools 路由渲染 ToolsPage', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        ok: true,
        data: { tools: [
          { name: 'read_file', description: 'Read file', executionMode: 'sequential' },
        ]},
      })),
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/tools'] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId('page-tools')).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run web/tests/unit/tools-page.test.tsx
```
预期：Task 2+3 的 11 条测试 PASS，Task 4 的 2 条集成测试 FAIL（Sidebar 无 Tools 项，路由未注册）。

- [ ] **Step 3: 修改 `web/src/routes.tsx`** — 新增 import 和路由条目：

```typescript
// 在现有 import 块追加:
import { ToolsPage } from '@/pages/ToolsPage';

// 在 children 数组中，skills 之后追加:
{ path: 'tools', element: <ToolsPage />, handle: { label: 'Tools' } },
```

- [ ] **Step 4: 修改 `web/src/components/layout/Sidebar.tsx`**

两处修改：

(1) import 添加 `Wrench` 图标：
```typescript
// 从 lucide-react 的 import 中追加 Wrench:
import {
  MessageSquare,
  Bot,
  Plug,
  Settings2,
  SlidersHorizontal,
  Plus,
  LayoutDashboard,
  Loader2,
  Wrench,   // ← 新增
} from 'lucide-react';
```

(2) `navItems` 数组中，skills 之后追加：
```typescript
{ to: '/tools', label: 'Tools', icon: Wrench },
```

- [ ] **Step 5: 修改 `web/src/i18n/zh.json`** — 在 `nav` 块内追加：

```json
"tools": "工具"
```

并在顶层新增 `tools` 块：
```json
"tools": {
  "title": "内置工具",
  "empty": "暂无可用工具"
}
```

- [ ] **Step 6: 修改 `web/src/i18n/en.json`** — 同样追加：

```json
// nav 块内:
"tools": "Tools"

// 顶层新增 tools 块:
"tools": {
  "title": "Built-in Tools",
  "empty": "No tools available"
}
```

- [ ] **Step 7: 运行测试验证通过**

```bash
npx vitest run web/tests/unit/tools-page.test.tsx
```
预期：全部 13 条测试 PASS。

- [ ] **Step 8: 提交**

```bash
git add web/src/routes.tsx \
        web/src/components/layout/Sidebar.tsx \
        web/src/i18n/zh.json \
        web/src/i18n/en.json \
        web/tests/unit/tools-page.test.tsx
git commit -m "feat(web): add /tools route and sidebar navigation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 现有测试回归（不新增测试，仅验证无破坏）

**Files:**
- 无修改（仅验证）

- [ ] **Step 1: 运行全量测试**

```bash
npx vitest run
```
预期：全部已有测试 + 新增测试 PASS，无回归。

- [ ] **Step 2: 如有失败，修复后重新运行直到全部通过**

---

### Task 6: 手动验证（启动应用确认页面可用）

- [ ] **Step 1: 启动开发服务器**

```bash
npm run dev
```

- [ ] **Step 2: 浏览器验证**
  - 打开 http://localhost:<port>
  - 侧边栏确认 "Tools" 导航项存在
  - 点击 Tools → 页面渲染 8 个工具卡片
  - 点击任意卡片 → DetailPanel 弹出，展示 description + inputSchema JSON
  - 点击遮罩或关闭按钮 → DetailPanel 关闭
  - 刷新页面 → 正常加载

---

## Plan 自检

### 1. Spec 覆盖

| Spec 需求 | 对应 Task |
|-----------|----------|
| GET /api/tools 列表端点 | Task 1 |
| GET /api/tools/:name 详情端点 | Task 1 |
| router.ts 追加 2 条路由 | Task 1 |
| wire-routes.ts 接线 | Task 1 |
| useTools hook | Task 2 |
| query-keys 追加 tools key | Task 2 |
| ToolsPage 卡片网格 | Task 3 |
| DetailPanel 弹窗 | Task 3 |
| Loading / Error / Empty 状态 | Task 3 |
| 路由注册 /tools | Task 4 |
| Sidebar 导航项 | Task 4 |
| i18n 中英文 | Task 4 |
| 后端 API 测试 (5 条) | Task 1 |
| 前端 hook 测试 (5 条) | Task 2 |
| 前端页面测试 (6 条) | Task 3 |
| 集成测试 (2 条) | Task 4 |

### 2. 占位符检查
- 无 TBD / TODO / 占位符
- 所有步骤包含实际代码

### 3. 类型一致性
- `ToolSummary` 类型在 Task 2（useTools.ts）定义，Task 3（ToolsPage.tsx）引用 — 一致
- `ToolDetail` 类型在 Task 2 定义，Task 3 引用 — 一致
- `createMockReqRes` 在 Task 1 使用，来自项目已有 `test/helpers/http.js` — 需确认存在

### 4. TDD 合规
- [x] Task 1: Step 1 先写测试，Step 2 验证失败，Step 3-5 实现，Step 6 验证通过
- [x] Task 2: Step 1 先写测试，Step 2 验证失败，Step 3-4 实现，Step 5 验证通过
- [x] Task 3: Step 1 追加测试，Step 2 验证失败，Step 3 实现，Step 4 验证通过
- [x] Task 4: Step 1 追加测试，Step 2 验证失败，Step 3-6 实现，Step 7 验证通过
- [x] Task 5: 全量回归
- [x] Task 6: 手动端到端

## Next

**（写入后须暂停 — 即使用户句末含「然后执行」）**

- 计划确认 → 说「开始实现」或「执行」
- 需要调整 → 直接说修改意见
