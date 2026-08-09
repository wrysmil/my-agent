---
artifact: implementation-plan
route: superpowers:writing-plans
skills:
  - writing-plans
skills_evidence:
  - ~/.agents/skills/writing-plans/SKILL.md
dispatch: n/a
source:
  - AGENTS.md
  - core/routing.md
  - project.profile.md
  - context-map.md
created_at: 2026-08-08
status: draft
approved: false
---

# Chat 修复 + Provider 联通测试 + UI 优化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Chat 页面无响应问题（config 加载路径），添加 Provider 联通测试功能，优化 Chat UI（空状态文案、模型选择器移到输入框下方）

**Architecture:** 4 个独立 Task：T1 修复 config 加载（根因修复，影响最大）、T2 添加 Provider test 端点+前端按钮、T3 优化 Chat UI 布局（空状态+模型选择器下移）、T4 修复静态文件服务（webRoot 指向 dist）

**Tech Stack:** TypeScript + Node.js ESM + React + Vite + Vitest + Zod

**TDD Required:** YES（每个 Task 遵循 RED-GREEN-REFACTOR）

---

## 问题诊断

### 根因 A：`loadConfig()` 未传 configPath（Chat 无响应 + 模型下拉为空）

`bin/my-agent-web.ts:48` 中：
```ts
const config = await loadConfig(); // 未传参 → 使用 Zod 默认值（空 models.catalog）
```

`src/config/loader.ts:10-11` 中：
```ts
export async function loadConfig(configPath?: string): Promise<CoreAgentConfig> {
  if (!configPath) return CoreAgentConfigSchema.parse({}); // ← 返回空配置
```

结果链：
- `models.catalog` = `{}` → `/api/models` 返回空数组 → 前端模型下拉为空
- AgentRunner 构造时 `ProviderRegistry(config)` 无 provider → `resolveForModel` 失败 → `runStream` yield `done` + error → SSE 流发回 `error` 事件 → 前端 `useChatStream` 收到 HTTP 200 但 SSE 里是 error → `setStatusSafe('error')` → 用户看到发送后无响应

服务器环境变量 `MY_AGENT_CONFIG` 未设置，且 `bin/my-agent-web.ts` 未提供默认 config 路径。

### 根因 B：`webRoot` 指向源码而非构建产物（`/src/main.tsx` 404）

`src/web/server/index.ts:139-141`：
```ts
const webRoot = path.resolve(
  deps.webRoot ?? path.join(process.cwd(), "web"), // → web/ （源码目录）
);
```

`web/index.html` 是 Vite 开发文件（`<script type="module" src="/src/main.tsx">`），构建产物在 `web/dist/`。浏览器加载 `web/index.html` 后请求 `/src/main.tsx` → 404。

---

## Task 分解

### Task 1: 修复 config 加载路径（根因 A）

**Files:**
- Modify: `bin/my-agent-web.ts:48`
- Modify: `src/config/loader.ts:10-13`

- [ ] **Step 1: 修改 `bin/my-agent-web.ts` 传入默认 config 路径**

```ts
// 修改前 (line 48):
const config = await loadConfig();

// 修改后:
const configPath = process.env.MY_AGENT_CONFIG ?? path.join(process.cwd(), "config.json");
const config = await loadConfig(configPath);
```

- [ ] **Step 2: 增强 `src/config/loader.ts` 的 fallback 逻辑**

在 `loadConfig` 中，当 `configPath` 未传时，自动尝试项目根目录的 `config.json`：

```ts
export async function loadConfig(configPath?: string): Promise<CoreAgentConfig> {
  const resolved = configPath
    ? path.resolve(configPath)
    : path.join(process.cwd(), "config.json");

  try {
    const raw = await fs.readFile(resolved, "utf-8");
    const data = JSON.parse(raw);
    return CoreAgentConfigSchema.parse(data);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return CoreAgentConfigSchema.parse({});
    }
    throw new Error(
      `Failed to load config from "${resolved}": ${formatError(err)}`,
      { cause: err as Error },
    );
  }
}
```

- [ ] **Step 3: 运行服务器验证 config 加载**

```bash
# 重启服务器后检查日志
curl -s http://localhost:4321/api/models | jq '.data.models | length'
# 预期：2（deepseek-chat, deepseek-reasoner）
```

- [ ] **Step 4: 运行现有测试确保无回归**

```bash
npx vitest run test/config/
```

---

### Task 2: Provider 联通测试功能

**Files:**
- Create: `web/src/features/providers/ProviderTestButton.tsx`（测试按钮组件）
- Modify: `web/src/pages/ProvidersPage.tsx`（添加测试按钮）
- Modify: `web/src/lib/api.ts`（确认 `apiPost` 可用）
- Modify: `src/web/server/routes/providers.ts`（添加 test 端点）

**背景：** `LLMProvider` 接口已有 `validateAuth(): Promise<boolean>` 方法，DeepSeekProvider 已实现（调用 `/models` 端点验证 API key）。只需添加 HTTP 端点桥接。

- [ ] **Step 1: Write failing test — backend test endpoint**

File: `src/web/server/routes/providers.test.ts`（追加）

```ts
describe("POST /api/providers/:id/test", () => {
  it("returns ok when provider validates successfully", async () => {
    const store = createMockStore({ deepseek: { apiKey: "sk-test", baseUrl: "https://api.deepseek.com/v1" } });
    // mock provider.validateAuth → true
    const res = await simulateRequest("POST", "/api/providers/deepseek/test", store);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 404 when provider not found", async () => {
    const store = createMockStore({});
    const res = await simulateRequest("POST", "/api/providers/nonexistent/test", store);
    expect(res.status).toBe(404);
  });

  it("returns auth_failed when validateAuth returns false", async () => {
    const store = createMockStore({ deepseek: { apiKey: "bad-key" } });
    // mock provider.validateAuth → false
    const res = await simulateRequest("POST", "/api/providers/deepseek/test", store);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe("PROVIDER_AUTH_FAILED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/web/server/routes/providers.test.ts -t "POST /api/providers/:id/test"
# Expected: FAIL — route not yet registered
```

- [ ] **Step 3: Write minimal implementation — 后端 test 端点**

在 `src/web/server/routes/providers.ts` 中添加：

```ts
// 在 HANDLERS 表中添加：
"POST /api/providers/:id/test": testProviderConnectivity,

// 新增 handler：
async function testProviderConnectivity(ctx: HandlerCtx): Promise<void> {
  const id = validateProviderId(ctx.params.id ?? "");
  const cfg = ctx.store.getConfig();
  const entry = cfg.providers[id];
  if (!entry) {
    throw new ApiError(ApiErrorCode.PROVIDER_NOT_FOUND, `Provider "${id}" not found`);
  }

  // 构造临时 provider 实例进行验证
  const apiKey = entry.apiKey || process.env.DEEPSEEK_API_KEY || "";
  const provider = new DeepSeekProvider({ apiKey, baseUrl: entry.baseUrl });

  const ok = await provider.validateAuth();
  if (!ok) {
    sendJson(ctx.res, 200, {
      ok: false,
      error: { code: "PROVIDER_AUTH_FAILED", message: "API key validation failed" },
    });
    return;
  }
  sendJson(ctx.res, 200, { ok: true, data: { tested: id, reachable: true } });
}
```

在 `registerProviderRoutes` 的 `routeKey` 函数中添加 regex 映射：

```ts
if (pattern.source === "^\\/api\\/providers\\/([^/]+)\\/test$") {
  return `${method} /api/providers/:id/test`;
}
```

在 `src/web/server/router.ts` 的 ROUTES 表中添加路由：

```ts
["POST", /^\/api\/providers\/([^/]+)\/test$/, routeNotFoundPlaceholder, ["id"]],
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/web/server/routes/providers.test.ts -t "POST /api/providers/:id/test"
# Expected: PASS
```

- [ ] **Step 5: Write failing test — 前端测试按钮**

File: `web/tests/unit/provider-form.test.tsx`（追加）

```tsx
describe("ProviderTestButton", () => {
  it("shows testing state when clicked", async () => {
    render(<ProviderTestButton providerId="deepseek" />);
    const btn = screen.getByRole("button", { name: /测试|test/i });
    fireEvent.click(btn);
    expect(screen.getByText(/测试中|testing/i)).toBeInTheDocument();
  });

  it("shows success after valid response", async () => {
    // mock apiPost → { ok: true, data: { reachable: true } }
    render(<ProviderTestButton providerId="deepseek" />);
    fireEvent.click(screen.getByRole("button", { name: /测试|test/i }));
    await waitFor(() => expect(screen.getByText(/联通|connected/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
npx vitest run web/tests/unit/provider-form.test.tsx -t "ProviderTestButton"
# Expected: FAIL — component not created yet
```

- [ ] **Step 7: Write minimal implementation — 前端组件**

创建 `web/src/features/providers/ProviderTestButton.tsx`：

```tsx
import { useState } from 'react';
import { apiPost } from '@/lib/api';
import { Wifi, Loader2, CheckCircle, XCircle } from 'lucide-react';

type TestStatus = 'idle' | 'testing' | 'success' | 'failed';

export function ProviderTestButton({ providerId }: { providerId: string }) {
  const [status, setStatus] = useState<TestStatus>('idle');
  const [message, setMessage] = useState('');

  async function handleTest() {
    setStatus('testing');
    setMessage('');
    try {
      const res = await apiPost<{ tested: string; reachable: boolean }>(
        `/api/providers/${providerId}/test`
      );
      if (res.reachable) {
        setStatus('success');
        setMessage('连接成功');
      } else {
        setStatus('failed');
        setMessage('认证失败');
      }
    } catch {
      setStatus('failed');
      setMessage('请求失败');
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={handleTest}
        disabled={status === 'testing'}
        className="text-xs text-text-muted hover:text-text px-2 py-1 rounded border border-border hover:bg-surface-hover inline-flex items-center gap-1"
      >
        {status === 'testing' ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Wifi className="w-3 h-3" />
        )}
        {status === 'testing' ? '测试中...' : '测试联通'}
      </button>
      {status === 'success' && (
        <span className="text-xs text-success flex items-center gap-0.5">
          <CheckCircle className="w-3 h-3" /> {message}
        </span>
      )}
      {status === 'failed' && (
        <span className="text-xs text-danger flex items-center gap-0.5">
          <XCircle className="w-3 h-3" /> {message}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 8: 在 ProvidersPage 中集成测试按钮**

在 `web/src/pages/ProvidersPage.tsx` 的 provider 卡片按钮区域（编辑按钮旁）添加：

```tsx
import { ProviderTestButton } from '@/features/providers/ProviderTestButton';

// 在编辑按钮后添加：
<ProviderTestButton providerId={provider.id} />
```

- [ ] **Step 9: Run tests to verify**

```bash
npx vitest run web/tests/unit/provider-form.test.tsx
```

- [ ] **Step 10: 端到端验证**

```bash
# 启动服务器后
curl -X POST http://localhost:4321/api/providers/deepseek/test
# Expected: {"ok":true,"data":{"tested":"deepseek","reachable":true}}
```

---

### Task 3: Chat UI 优化 — 空状态文案 + 模型选择器下移

**Files:**
- Modify: `web/src/components/chat/MessageList.tsx`
- Modify: `web/src/pages/ChatPage.tsx`
- Modify: `web/src/components/chat/Composer.tsx`

- [ ] **Step 1: Write failing test — MessageList 空状态**

File: `web/tests/unit/app-shell.test.tsx`（追加）

```tsx
describe("MessageList empty state", () => {
  it("shows welcome text when no messages", () => {
    render(<MessageList messages={[]} />);
    expect(screen.getByText(/开始对话/i)).toBeInTheDocument();
    expect(screen.getByText(/选择一个模型/i)).toBeInTheDocument();
  });

  it("hides welcome text when messages exist", () => {
    render(<MessageList messages={[{ role: 'user', text: 'hello' }]} />);
    expect(screen.queryByText(/开始对话/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run web/tests/unit/app-shell.test.tsx -t "MessageList empty state"
# Expected: FAIL
```

- [ ] **Step 3: Write minimal implementation — MessageList 空状态**

修改 `web/src/components/chat/MessageList.tsx`：

```tsx
import { MessageSquare, Cpu } from 'lucide-react';

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" role="log" aria-live="polite">
        <div className="text-center space-y-3 max-w-md px-6">
          <div className="flex justify-center">
            <MessageSquare className="w-12 h-12 text-text-muted/30" />
          </div>
          <h3 className="text-lg font-medium text-text-muted">开始对话</h3>
          <p className="text-sm text-text-muted/70 leading-relaxed">
            在下方输入框输入消息，按 <kbd className="px-1 py-0.5 text-xs bg-surface-hover border border-border rounded">⌘+Enter</kbd> 发送。
            可以在输入框下方选择模型和思考级别。
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-text-muted/50">
            <Cpu className="w-3 h-3" />
            <span>支持 DeepSeek Chat / Reasoner 模型</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2" role="log" aria-live="polite">
      {messages.map((m, i) => (
        <MessageBubble key={i} role={m.role} text={m.text} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run web/tests/unit/app-shell.test.tsx -t "MessageList empty state"
# Expected: PASS
```

- [ ] **Step 5: 模型选择器移入 Composer**

修改 `web/src/components/chat/Composer.tsx`，在输入框下方添加模型/思考级别选择行：

```tsx
// Composer props 扩展
export function Composer({ onSend, onAbort, status, modelSelector }: {
  onSend: (text: string) => void;
  onAbort: () => void;
  status: ChatStatus;
  modelSelector?: React.ReactNode;  // 由 ChatPage 注入
}) {
  // ... 原有逻辑 ...

  return (
    <form onSubmit={handleSubmit} className="border-t border-border p-4 bg-surface">
      <div className="flex gap-2 items-end">
        <textarea ... />
        {isStreaming ? <Button ...停止 /> : <Button ...发送 />}
      </div>
      {modelSelector && (
        <div className="flex items-center gap-2 mt-2">
          {modelSelector}
        </div>
      )}
    </form>
  );
}
```

- [ ] **Step 6: 修改 ChatPage 将模型选择器从 header 移到 Composer**

在 `web/src/pages/ChatPage.tsx` 中：
- 移除 header 中的模型/effort 选择器代码（`Cpu`、`Brain` 按钮及下拉菜单）
- 将这些选择器作为 `modelSelector` prop 传入 Composer
- header 仅保留标题和状态指示器

```tsx
// 构建 modelSelector JSX
const modelSelector = (
  <>
    {/* Model selector dropdown */}
    <div className="relative">...</div>
    {/* Thinking effort selector */}
    <div className="relative">...</div>
  </>
);

// render
<MessageList messages={messages} />
<Composer
  onSend={handleSend}
  onAbort={abort}
  status={status}
  modelSelector={modelSelector}
/>
```

- [ ] **Step 7: 运行现有测试确保无回归**

```bash
npx vitest run web/tests/unit/
```

---

### Task 4: 修复静态文件服务指向 dist

**Files:**
- Modify: `bin/my-agent-web.ts:44-45`
- Modify: `src/web/server/index.ts:139-141`

- [ ] **Step 1: 修改 webRoot 默认值**

在 `bin/my-agent-web.ts` 中：

```ts
// 修改前 (lines 44-45):
const webRoot =
  process.env.MY_AGENT_WEB_ROOT ?? path.join(process.cwd(), "web");

// 修改后:
const defaultWebRoot = path.join(process.cwd(), "web");
const distPath = path.join(defaultWebRoot, "dist");
const webRoot =
  process.env.MY_AGENT_WEB_ROOT ??
  (fs.existsSync(distPath) ? distPath : defaultWebRoot);
```

需要添加 `import * as fs from "node:fs";`。

- [ ] **Step 2: 修复 `src/web/server/index.ts` 默认值同步**

保持 `src/web/server/index.ts:139-141` 不变（它从 `deps.webRoot` 读取，由 `bin/my-agent-web.ts` 传入）。

- [ ] **Step 3: 验证静态文件服务**

```bash
# 确保 dist 存在
ls web/dist/index.html
# 启动服务器
curl -s http://localhost:4321/ | head -5
# 应该返回 web/dist/index.html 内容（包含 ./assets/index-xxx.js 引用）
```

- [ ] **Step 4: 清理** `web/index.html` **避免混淆（可选）**

如果不再需要 Vite dev 模式，可将 `web/index.html` 替换为构建产物副本，或添加注释说明这是 Vite 开发入口。

---

## 验证方案

### 端到端验证步骤

1. **重启服务器**：
   ```bash
   # 终止现有进程（PID 文件在 /tmp，不在项目目录）
   kill $(cat /tmp/my-agent.pid 2>/dev/null) 2>/dev/null
   # 重新构建前端（如有修改）
   cd web && npm run build && cd ..
   # 启动
   npm run web
   ```

2. **验证模型数据**：
   ```bash
   curl -s http://localhost:4321/api/models | jq '.data.models | length'
   # 预期：2
   ```

3. **验证 Provider 测试**：
   ```bash
   curl -X POST http://localhost:4321/api/providers/deepseek/test
   # 预期：{"ok":true,"data":{"tested":"deepseek","reachable":true}}
   ```

4. **验证 Chat 发送消息**：
   - 浏览器访问 `http://localhost:4321`
   - 应看到 Chat 页面 + 空状态欢迎文案
   - 模型选择器应在输入框下方
   - 发送消息后应有回复

5. **验证 Provider 页面**：
   - 访问设置 → 模型供应商
   - 每个供应商卡片上有「测试联通」按钮
   - 点击后显示测试结果

### 测试命令

```bash
# 全部单测
npm test

# 前端单测
cd web && npx vitest run

# 类型检查
npm run check
```

---

## 参考资料检查

- [x] `definition-of-done.md` — 单测通过 + 类型检查通过 + 端到端验证
- [x] `testing-patterns.md` — TDD RED-GREEN-REFACTOR
- [x] `security-checklist.md` — apiKey 脱敏（已有 `stripEnvKey`），test 端点不泄露真实 key

---

## Next

**（计划确认后执行）**

- 计划确认 → 说「开始实现」或「执行」
- 需要调整 → 直接说修改意见
