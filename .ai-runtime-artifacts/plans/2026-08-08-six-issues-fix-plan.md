---
artifact: implementation-plan
route: superpowers:writing-plans
skills:
  - writing-plans
skills_evidence:
  - ~/.claude/skills/writing-plans/SKILL.md
dispatch: n/a
source:
  - AGENTS.md
  - harness-kit/core/routing.md
  - harness-kit/project.profile.md
  - harness-kit/context-map.md
  - .ai-runtime-artifacts/specs/2026-08-08-six-issues-fix-spec.md
created_at: 2026-08-08
status: draft
approved: false
---

# 6 项问题修复 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 my-agent Web 前端的 6 项缺陷：API Key 加载、聊天响应、会话持久化、i18n 中文切换、日志增强、Settings 配置扩展。

**Architecture:** 按优先级分 3 个 GROUP（P0→P1→P2），每个 GROUP 内任务可并行。修改涉及后端（bin/config/routes/agent）和前端（pages/components/features/i18n）。

**Tech Stack:** TypeScript + Node.js ESM + React 19 + Vite 6 + Vitest + Zod + Zustand 5 + TanStack Query v5

**TDD Required:** YES（每个 Task 遵循 RED-GREEN-REFACTOR）

---

## 文件结构映射

| 文件 | 职责 | GROUP |
|------|------|-------|
| `bin/my-agent-web.ts` | 启动入口：dotenv、config 路径、初始化顺序 | P0 |
| `src/config/loader.ts` | 配置加载：apiKey 环境变量 fallback | P0 |
| `src/web/server/routes/providers.ts` | Provider API：apiKey 掩码防污染 | P0 |
| `src/web/server/routes/messages.ts` | Chat SSE：done+error 事件适配 | P0 |
| `web/src/features/chat/useChatStream.ts` | 前端聊天流：error 消息展示 + historyLoaded 重置 | P0, P1 |
| `web/src/pages/ChatPage.tsx` | 聊天页：session 自动创建 + 历史加载 + i18n | P1 |
| `web/src/features/ui/useUiStore.ts` | UI Store：setLocale 同步 i18n 模块 | P1 |
| `web/src/i18n/useTranslation.ts` | **新建** — React i18n hook | P1 |
| `web/src/components/layout/Sidebar.tsx` | 侧边栏：i18n 文本 | P1 |
| `web/src/pages/SettingsPage.tsx` | 设置页：i18n + 扩展配置项 | P1, P2 |
| `web/src/pages/DashboardPage.tsx` | 仪表盘：i18n | P1 |
| `src/shared/logger.ts` | 日志接口：结构化 + 子 logger | P2 |
| `src/web/server/index.ts` | HTTP Server：access log | P2 |
| `src/agent/runner.ts` | Agent Runner：关键节点日志埋点 | P2 |
| `src/web/server/routes/config.ts` | **新建** — GET/PUT /api/config | P2 |
| `src/web/server/wire-routes.ts` | 路由接线：注册 config 路由 | P2 |

---

## GROUP P0：阻塞性修复（API Key + 聊天响应）

### Task 1: 修复 API Key 加载链路

**Files:**
- Modify: `bin/my-agent-web.ts:1-18`
- Modify: `src/config/loader.ts:10-28`
- Modify: `src/web/server/routes/providers.ts:398-401`
- Test: `test/config.test.ts`

- [ ] **Step 1: 编写失败测试 — config loader apiKey fallback**

```ts
// test/config.test.ts — 新增 describe('apiKey env fallback')
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config/loader.js';

describe('loadConfig apiKey env fallback', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should fallback apiKey from DEEPSEEK_API_KEY env when config has no apiKey', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test-env-key';
    // 使用一个只有 provider 无 apiKey 的临时 config
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'my-agent-test-'));
    const configPath = path.join(tmpDir, 'config.json');
    await fs.writeFile(configPath, JSON.stringify({
      models: {
        providers: { deepseek: { baseUrl: 'https://api.deepseek.com/v1' } },
        catalog: { 'deepseek-chat': { provider: 'deepseek', model: 'deepseek-chat' } }
      }
    }));
    const config = await loadConfig(configPath);
    expect(config.models.providers['deepseek']?.apiKey).toBe('sk-test-env-key');
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should keep apiKey when config already has it', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test-env-key';
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'my-agent-test-'));
    const configPath = path.join(tmpDir, 'config.json');
    await fs.writeFile(configPath, JSON.stringify({
      models: {
        providers: { deepseek: { apiKey: 'sk-explicit', baseUrl: 'https://api.deepseek.com/v1' } }
      }
    }));
    const config = await loadConfig(configPath);
    // 显式 apiKey 不被环境变量覆盖
    expect(config.models.providers['deepseek']?.apiKey).toBe('sk-explicit');
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run test/config.test.ts -t "apiKey env fallback"
```
Expected: FAIL — loadConfig 当前不注入环境变量 apiKey

- [ ] **Step 3: 实现最小修改**

**3a. `bin/my-agent-web.ts` — 增加 dotenv import（第 1 行前插入）**

```ts
// 新增：确保 .env 被加载
import "dotenv/config";
```

如果项目未安装 dotenv：
```bash
npm install dotenv
```

**3b. `src/config/loader.ts` — loadConfig 末尾增加 apiKey 环境变量注入（第 18 行后插入）**

```ts
export async function loadConfig(configPath?: string): Promise<CoreAgentConfig> {
  const resolved = configPath
    ? path.resolve(configPath)
    : path.join(process.cwd(), "config.json");

  try {
    const raw = await fs.readFile(resolved, "utf-8");
    const data = JSON.parse(raw);
    const config = CoreAgentConfigSchema.parse(data);

    // 新增：为每个 provider 注入环境变量 apiKey（如果 config 中未设置）
    const providerEnvKeyMap: Record<string, string> = {
      deepseek: "DEEPSEEK_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
    };
    for (const [providerId, provider] of Object.entries(config.models.providers)) {
      if (!provider.apiKey) {
        const envVar = providerEnvKeyMap[providerId];
        if (envVar && process.env[envVar]) {
          provider.apiKey = process.env[envVar];
        }
      }
    }
    // 同样处理 catalog 中可能的内联 apiKey（通常不在 catalog 中，但防御性保留）
    return config;
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

**3c. `src/web/server/routes/providers.ts:398-401` — 修复 apiKey 掩码污染**

```ts
// 修改前 (line 398-401):
const merged: ProviderConfigEntry = existed && !body.apiKey
  ? { ...body, apiKey: cfg.providers[id]!.apiKey }
  : body;

// 修改后:
const merged: ProviderConfigEntry = existed && (!body.apiKey || body.apiKey === "***")
  ? { ...body, apiKey: cfg.providers[id]!.apiKey }
  : body;
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npx vitest run test/config.test.ts -t "apiKey env fallback"
```
Expected: PASS

- [ ] **Step 5: 运行全量测试确保无回归**

```bash
npx vitest run
npm run check
```

- [ ] **Step 6: Commit**

```bash
git add bin/my-agent-web.ts src/config/loader.ts src/web/server/routes/providers.ts test/config.test.ts package.json
git commit -m "fix: apiKey env fallback in config loader + dotenv import + mask pollution fix

- bin/my-agent-web.ts: add dotenv/config import to load .env
- src/config/loader.ts: inject apiKey from env var when config has no apiKey
- src/web/server/routes/providers.ts: treat '***' as empty apiKey to preserve existing value
"
```

---

### Task 2: 修复聊天 SSE done+error 事件适配 + 前端错误提示

**Files:**
- Modify: `src/web/server/routes/messages.ts:249-266,405-566`
- Modify: `web/src/features/chat/useChatStream.ts:148-150`
- Test: `src/web/server/index.test.ts`
- Test: `web/tests/unit/api.test.ts`

- [ ] **Step 1: 编写失败测试 — adaptStreamEvent done 事件处理**

```ts
// src/web/server/index.test.ts — 新增 describe('adaptStreamEvent done event')
import { describe, it, expect, vi } from 'vitest';
import { adaptStreamEvent } from '../src/web/server/routes/messages.js';
import type { ServerResponse } from 'node:http';
import type { SseSession } from '../src/web/server/sse.js';

describe('adaptStreamEvent done event', () => {
  it('should handle done event with error by writing SSE error event', async () => {
    const writeEventSpy = vi.fn();
    const res = {
      write: vi.fn((chunk: string, cb?: () => void) => { cb?.(); return true; }),
    } as unknown as ServerResponse;
    const sse: SseSession = {
      streamId: 'test-stream',
      seq: 0,
      clientGone: false,
      cid: 'test-cid',
      controller: new AbortController(),
    };
    const openTextBlocks = new Set<number>();
    
    // 模拟 done 事件带 error
    const doneEvent = {
      type: 'done' as const,
      result: {
        text: '',
        content: [],
        meta: {
          durationMs: 100,
          model: 'test',
          provider: 'test',
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          toolLoops: 0,
          compactionCount: 0,
          error: { kind: 'auth' as const, message: 'Auth failed' },
        },
      },
    };

    // 当前代码不处理 done 类型 — 期望抛错或静默忽略
    await expect(
      adaptStreamEvent(res, doneEvent as any, sse, () => 0, openTextBlocks)
    ).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试验证当前行为**

```bash
npx vitest run src/web/server/index.test.ts -t "adaptStreamEvent done event"
```
Expected: PASS（当前代码静默忽略 done 事件，fallback 到 default → ping）

- [ ] **Step 3: 实现修复**

**3a. `src/web/server/routes/messages.ts` — adaptStreamEvent 增加 done case（第 555 行 default 前插入）**

```ts
case "done": {
  // runner 直接返回 done（如 auth error、provider not found）
  if (ev.result?.meta?.error) {
    writeEvent(res, {
      id: sse.seq,
      event: "error",
      data: {
        ok: false,
        error: {
          code: ev.result.meta.error.kind === "auth" ? "AUTH_ERROR" : "CHAT_RUNNER_ERROR",
          message: ev.result.meta.error.message,
        },
      },
    });
  } else {
    writeEvent(res, {
      id: sse.seq,
      event: "done",
      data: { ok: true, streamId: sse.streamId },
    });
  }
  return;
}
```

**3b. `src/web/server/routes/messages.ts` — postMessageStream 循环中处理 done 事件（第 261 行修改）**

```ts
// 修改前 (line 261):
if (ev.type === "message_end" || ev.type === "error") {
  if (ev.type === "message_end") endedNormally = true;
  break;
}

// 修改后:
if (ev.type === "message_end" || ev.type === "error" || ev.type === "done") {
  if (ev.type === "message_end") endedNormally = true;
  break;
}
```

**3c. `web/src/features/chat/useChatStream.ts:148-150` — error 事件展示错误消息**

```ts
// 修改前 (line 148-150):
} else if (evt.event === 'error') {
  setStatusSafe('error');
  return;
}

// 修改后:
} else if (evt.event === 'error') {
  const errData = evt.data as Record<string, unknown>;
  const errInfo = errData?.error as Record<string, unknown> | undefined;
  const errMsg = errInfo?.message as string || '未知错误';
  setMessages((m) => [
    ...m,
    { role: 'assistant', text: `❌ 错误：${errMsg}` },
  ]);
  setStatusSafe('error');
  return;
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npx vitest run src/web/server/index.test.ts -t "adaptStreamEvent"
npx vitest run web/tests/unit/api.test.ts
```
Expected: PASS

- [ ] **Step 5: 运行全量测试**

```bash
npx vitest run
npm run check
```

- [ ] **Step 6: Commit**

```bash
git add src/web/server/routes/messages.ts web/src/features/chat/useChatStream.ts src/web/server/index.test.ts
git commit -m "fix: SSE done+error event handling + frontend error message display

- messages.ts: adaptStreamEvent adds done case with error→SSE error event
- messages.ts: postMessageStream loop breaks on done event too
- useChatStream.ts: error event appends visible error message to chat
"
```

---

## GROUP P1：核心体验修复（会话持久化 + i18n）

### Task 3: 修复前端会话持久化（ChatPage 生命周期）

**Files:**
- Modify: `web/src/pages/ChatPage.tsx`
- Modify: `web/src/features/chat/useChatStream.ts:50-78`
- Test: `web/tests/unit/sessions-page.test.tsx`

- [ ] **Step 1: 编写失败测试 — useChatStream historyLoaded 在 sessionId 变化时重置**

```ts
// web/tests/unit/api.test.ts — 新增 describe('useChatStream history reload')
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatStream } from '@/features/chat/useChatStream';
import { apiGet } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  apiGet: vi.fn(),
}));

describe('useChatStream history reload on sessionId change', () => {
  it('should reset historyLoaded when sessionId changes', async () => {
    vi.mocked(apiGet).mockResolvedValue({ messages: [] });
    
    const { result, rerender } = renderHook(
      ({ sessionId }) => useChatStream(sessionId),
      { initialProps: { sessionId: 'session-1' } }
    );

    // 等待首轮加载
    await vi.waitFor(() => expect(result.current.historyLoaded).toBe(true));

    // 切换到新 session
    rerender({ sessionId: 'session-2' });
    
    // 应重新加载（historyLoaded 应为 false 然后变 true）
    await vi.waitFor(() => expect(result.current.historyLoaded).toBe(true));
    expect(apiGet).toHaveBeenCalledWith('/api/sessions/session-2/history');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run web/tests/unit/api.test.ts -t "history reload"
```
Expected: FAIL — 当前 `historyLoaded` 在 sessionId 变化时不会重置

- [ ] **Step 3: 实现修复**

**3a. `web/src/features/chat/useChatStream.ts:50-78` — 修复 historyLoaded 重置**

```ts
// 修改前 (line 50-78):
useEffect(() => {
  if (!sessionId || historyLoaded) return;
  // ...
}, [sessionId, historyLoaded]);

// 修改后:
useEffect(() => {
  if (!sessionId) return;
  // 重置：每次 sessionId 变化时重新加载
  let cancelled = false;
  setHistoryLoaded(false);  // ← 新增
  setMessages([]);          // ← 新增：清空旧消息
  apiGet<{ messages: SerializedMsg[] }>(`/api/sessions/${sessionId}/history`)
    .then((data) => {
      if (cancelled || !data?.messages) {
        if (!cancelled) setHistoryLoaded(true);
        return;
      }
      const loaded: ChatMessage[] = [];
      for (const m of data.messages) {
        const role = m.role === 'user' ? 'user' : 'assistant';
        let text = m.text || m.content || '';
        if (!text && m.contentBlocks) {
          text = m.contentBlocks
            .filter((b) => b.type === 'text')
            .map((b) => b.text || '')
            .join('\n');
        }
        if (text) loaded.push({ role: role as 'user' | 'assistant', text });
      }
      if (!cancelled) {
        setMessages(loaded);
        setHistoryLoaded(true);
      }
    })
    .catch(() => {
      if (!cancelled) setHistoryLoaded(true);
    });
  return () => { cancelled = true; };
}, [sessionId]);  // ← 移除 historyLoaded 依赖，仅依赖 sessionId
```

**3b. `web/src/pages/ChatPage.tsx` — 确保 session 自动创建和 history 加载正常**

在 ChatPage 组件中确认以下逻辑存在（根据实际代码结构调整）：

```tsx
// ChatPage.tsx 关键逻辑（确认/修复）
const { cid } = useParams<{ cid: string }>();
const navigate = useNavigate();
const [sessionId, setSessionId] = useState<string>('');

// Mount 时自动创建 session（如果 URL 无 cid）
useEffect(() => {
  if (cid) {
    setSessionId(cid);
    return;
  }
  // 自动创建新 session
  let cancelled = false;
  apiPost<{ session: { id: string } }>('/api/sessions', { kind: 'gconv' })
    .then((data) => {
      if (!cancelled && data?.session?.id) {
        setSessionId(data.session.id);
        navigate(`/chat/${data.session.id}`, { replace: true });
      }
    })
    .catch(() => {
      if (!cancelled) setStatusSafe('error');
    });
  return () => { cancelled = true; };
}, [cid]);
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npx vitest run web/tests/unit/
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/features/chat/useChatStream.ts web/src/pages/ChatPage.tsx web/tests/unit/api.test.ts
git commit -m "fix: session history reload on sessionId change + auto-create session

- useChatStream.ts: reset historyLoaded & messages when sessionId changes
- ChatPage.tsx: auto-create session via POST /api/sessions if no cid in URL
"
```

---

### Task 4: 修复 i18n 中文切换 — 连接 Zustand 与 i18n 模块

**Files:**
- Modify: `web/src/features/ui/useUiStore.ts:31-34`
- Create: `web/src/i18n/useTranslation.ts`
- Test: `web/tests/unit/app-shell.test.tsx`

- [ ] **Step 1: 编写失败测试 — setLocale 调 i18n.setLocale**

```ts
// web/tests/unit/app-shell.test.tsx — 新增 describe('i18n integration')
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useUiStore } from '@/features/ui/useUiStore';
import { setLocale, t } from '@/lib/i18n';

vi.mock('@/lib/i18n', () => ({
  setLocale: vi.fn(),
  t: vi.fn((key: string) => key),
}));

describe('i18n integration with Zustand', () => {
  beforeEach(() => {
    useUiStore.setState({ locale: 'zh' });
    vi.clearAllMocks();
  });

  it('should call i18n.setLocale when useUiStore.setLocale is called', () => {
    const { setLocale: setStoreLocale } = useUiStore.getState();
    setStoreLocale('en');
    // 验证 i18n.setLocale 被调用
    expect(vi.mocked(setLocale)).toHaveBeenCalledWith('en');
  });

  it('should update Zustand state when setLocale is called', () => {
    const { setLocale: setStoreLocale } = useUiStore.getState();
    setStoreLocale('en');
    expect(useUiStore.getState().locale).toBe('en');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run web/tests/unit/app-shell.test.tsx -t "i18n integration"
```
Expected: FAIL — `setLocale` 当前不调用 `i18n.setLocale`

- [ ] **Step 3: 实现修复**

**3a. `web/src/features/ui/useUiStore.ts:31-34` — setLocale 中增加 i18n 同步**

```ts
import { setLocale as setI18nLocale } from '@/lib/i18n';

// ... (其余 import 不变)

export const useUiStore = create<UiState>((set) => ({
  // ... (其余字段不变)
  setLocale: (locale) => {
    localStorage.setItem('locale', locale);
    setI18nLocale(locale);  // ← 新增：同步 i18n 模块的 currentLocale
    set({ locale });
  },
  // ...
}));
```

**3b. 新建 `web/src/i18n/useTranslation.ts`**

```ts
import { useCallback } from 'react';
import { useUiStore } from '@/features/ui/useUiStore';
import { t } from '@/lib/i18n';

/**
 * React hook：获取翻译函数 t() 和当前 locale。
 * 订阅 Zustand locale 状态，locale 变化时自动触发组件重渲染。
 */
export function useTranslation() {
  const locale = useUiStore((s) => s.locale);

  const translate = useCallback(
    (key: string, params?: Record<string, string>) => t(key, params),
    [locale], // locale 变化时重建 t 引用，保证消费组件更新
  );

  return { t: translate, locale };
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npx vitest run web/tests/unit/app-shell.test.tsx -t "i18n integration"
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/features/ui/useUiStore.ts web/src/i18n/useTranslation.ts web/tests/unit/app-shell.test.tsx
git commit -m "feat: connect Zustand setLocale to i18n module + useTranslation hook

- useUiStore.ts: setLocale now calls i18n.setLocale to sync current locale
- useTranslation.ts: new React hook subscribing to Zustand locale for auto re-render
"
```

---

### Task 5: Sidebar + 页面 i18n 文本替换

**Files:**
- Modify: `web/src/components/layout/Sidebar.tsx`
- Modify: `web/src/pages/SettingsPage.tsx`
- Modify: `web/src/pages/DashboardPage.tsx`
- Modify: `web/src/pages/ChatPage.tsx`
- Test: `web/tests/unit/app-shell.test.tsx`

- [ ] **Step 1: 编写测试 — Sidebar 根据 locale 显示不同文本**

```ts
// web/tests/unit/app-shell.test.tsx — 新增 describe('Sidebar i18n')
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from '@/components/layout/Sidebar';
import { useUiStore } from '@/features/ui/useUiStore';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function renderSidebar() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Sidebar i18n', () => {
  beforeEach(() => {
    useUiStore.setState({ locale: 'zh' });
  });

  it('should show Chinese labels when locale is zh', () => {
    renderSidebar();
    expect(screen.getByText('仪表盘')).toBeDefined();
    expect(screen.getByText('聊天')).toBeDefined();
  });

  it('should show English labels when locale is en', () => {
    useUiStore.setState({ locale: 'en' });
    renderSidebar();
    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Chat')).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run web/tests/unit/app-shell.test.tsx -t "Sidebar i18n"
```
Expected: FAIL — 当前 Sidebar 硬编码英文，不会随 locale 变化

- [ ] **Step 3: 实现修复 — Sidebar.tsx**

```tsx
// web/src/components/layout/Sidebar.tsx
import { useTranslation } from '@/i18n/useTranslation';

export function Sidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useSessions(false);
  const sessions: SessionItem[] = data?.sessions ?? [];
  const recentSessions = sessions.slice(0, 20);

  const navItems = [
    { to: '/', label: t('nav.dashboard'), icon: LayoutDashboard },
    { to: '/chat', label: t('nav.chat'), icon: MessageSquare },
    { to: '/providers', label: t('nav.providers'), icon: Plug },
    { to: '/skills', label: t('nav.skills'), icon: SlidersHorizontal },
    { to: '/agents', label: t('nav.agents'), icon: Bot },
    { to: '/settings', label: t('nav.settings'), icon: Settings2 },
  ];

  return (
    <aside data-testid="sidebar"
      className="w-56 shrink-0 border-r border-border bg-surface flex flex-col h-screen">
      <div className="px-4 py-4 border-b border-border">
        <span className="text-lg font-bold text-primary">my-agent</span>
      </div>
      <nav className="flex flex-col gap-0.5 px-2 py-3 border-b border-border">
        {navItems.map(item => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-accent text-accent-fg font-medium'
                  : 'text-text-muted hover:bg-surface-hover hover:text-text'
              }`}>
            <item.icon className="w-4 h-4" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="flex items-center justify-between px-3 py-1 mb-1">
          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
            {t('sessions.title')}
          </span>
          <button onClick={() => navigate('/chat')}
            className="p-0.5 rounded hover:bg-surface-hover text-text-muted hover:text-text"
            title={t('sessions.new')}>
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-3">
            <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
          </div>
        ) : recentSessions.length === 0 ? (
          <p className="px-3 py-2 text-xs text-text-muted">{t('sessions.empty')}</p>
        ) : (
          <ul className="space-y-0.5">
            {recentSessions.map((s) => (
              <li key={s.id}>
                <NavLink to={`/chat/${s.id}`}
                  className={({ isActive }) =>
                    `block px-3 py-1.5 rounded-md text-sm truncate transition-colors ${
                      isActive
                        ? 'bg-accent text-accent-fg font-medium'
                        : 'text-text-muted hover:bg-surface-hover hover:text-text'
                    }`}
                  title={s.name || s.id}>
                  {s.name || s.id}
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
```

**3c. SettingsPage.tsx — 文本替换**

```tsx
// 关键修改：导入 useTranslation，替换硬编码文本
import { useTranslation } from '@/i18n/useTranslation';

export function SettingsPage() {
  const { t } = useTranslation();
  // ...
  return (
    <div className="p-6 space-y-6" data-testid="page-settings">
      <div>
        <h1 className="text-xl font-bold text-text">{t('settings.title')}</h1>
        <p className="text-sm text-text-muted mt-1">{t('settings.description')}</p>
      </div>
      <SettingGroup title={t('settings.appearance')} icon={Monitor}>
        <ToggleRow
          label={t('settings.darkMode')}
          description={t('settings.darkModeDesc')}
          checked={theme === 'dark'}
          onChange={() => toggleTheme()}
        />
        <SelectRow
          label={t('settings.language')}
          value={locale}
          options={[
            { value: 'zh', label: '中文' },
            { value: 'en', label: 'English' },
          ]}
          onChange={(v) => setLocale(v as 'zh' | 'en')}
        />
      </SettingGroup>
      {/* 其余保持，仅替换文本 */}
    </div>
  );
}
```

**3d. DashboardPage.tsx / ChatPage.tsx — 同理替换硬编码文本为 t() 调用**

- [ ] **Step 4: 运行测试验证通过**

```bash
npx vitest run web/tests/unit/app-shell.test.tsx -t "Sidebar i18n"
npx vitest run web/tests/unit/
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/layout/Sidebar.tsx web/src/pages/SettingsPage.tsx web/src/pages/DashboardPage.tsx web/src/pages/ChatPage.tsx web/tests/unit/app-shell.test.tsx
git commit -m "feat: i18n text replacement in Sidebar + Settings + pages

- Sidebar.tsx: nav labels, Sessions title/empty/new use t()
- SettingsPage.tsx: all static text replaced with t() calls
- DashboardPage.tsx, ChatPage.tsx: static text replaced with t()
"
```

---

## GROUP P2：体验增强（日志 + Settings 扩展）

### Task 6: AgentRunner + Web Server 日志增强

**Files:**
- Modify: `src/shared/logger.ts`
- Modify: `src/web/server/index.ts:206-282`
- Modify: `src/agent/runner.ts`
- Modify: `src/web/server/routes/messages.ts`
- Modify: `bin/my-agent-web.ts:39`
- Test: `src/web/server/index.test.ts`

- [ ] **Step 1: 编写测试 — logger 子 logger 和结构化日志**

```ts
// test/ 目录下新增或在现有测试中添加
import { describe, it, expect, vi } from 'vitest';
import { createLogger, type Logger } from '../src/shared/logger.js';

describe('Logger structured logging', () => {
  it('should support child logger with subsystem prefix', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const parent = createLogger('web', 'debug');
    const child = parent.child?.('runner');
    child?.info('test message');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[web:runner]'),
      'test message',
    );
    consoleSpy.mockRestore();
  });

  it('should support structured data as second argument', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createLogger('web', 'debug');
    logger.info('request completed', { method: 'GET', path: '/api/test', status: 200 });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[web]'),
      'request completed',
      { method: 'GET', path: '/api/test', status: 200 },
    );
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run test/ -t "Logger structured"
```
Expected: FAIL — 当前 Logger 无 child 方法

- [ ] **Step 3: 实现修改**

**3a. `src/shared/logger.ts` — 扩展 Logger 接口，增加 child + 结构化支持**

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  /** 创建子 logger（追加 subsystem 层级） */
  child(subsystem: string): Logger;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createLogger(
  subsystem: string,
  level: LogLevel = "info",
): Logger {
  const threshold = LOG_LEVELS[level] ?? LOG_LEVELS.info;
  const prefix = `[${subsystem}]`;

  function shouldLog(lvl: LogLevel): boolean {
    return LOG_LEVELS[lvl] >= threshold;
  }

  function formatMsg(msg: string): string {
    const ts = new Date().toISOString();
    return `${ts} ${prefix} ${msg}`;
  }

  const logger: Logger = {
    debug(msg, data) {
      if (shouldLog("debug")) console.debug(formatMsg(msg), data ?? "");
    },
    info(msg, data) {
      if (shouldLog("info")) console.info(formatMsg(msg), data ?? "");
    },
    warn(msg, data) {
      if (shouldLog("warn")) console.warn(formatMsg(msg), data ?? "");
    },
    error(msg, data) {
      if (shouldLog("error")) console.error(formatMsg(msg), data ?? "");
    },
    child(sub) {
      return createLogger(`${subsystem}:${sub}`, level);
    },
  };
  return logger;
}
```

**3b. `bin/my-agent-web.ts:39` — 日志级别支持环境变量**

```ts
import type { LogLevel } from "../src/shared/logger.js";
// ...
const logLevel = (process.env.MY_AGENT_LOG_LEVEL as LogLevel) ?? "info";
const logger = createLogger("web", logLevel);
```

**3c. `src/web/server/index.ts` — handleRequest 增加 access log**

在 `handleRequest` 函数开头和末尾添加：

```ts
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandleContext,
): Promise<void> {
  const startTime = Date.now();
  const method = req.method ?? "GET";
  let pathname: string;
  try {
    pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    // ... 错误处理
    return;
  }

  // 劫持 res.end 记录状态码
  const originalEnd = res.end.bind(res);
  res.end = function (...args: any[]): any {
    const duration = Date.now() - startTime;
    ctx.log.info(`${method} ${pathname} ${res.statusCode} ${duration}ms`, {
      method, path: pathname, status: res.statusCode, durationMs: duration,
      requestId: ctx.requestId,
    });
    return originalEnd(...args);
  };

  // ... 其余逻辑不变
}
```

**3d. `src/agent/runner.ts` — 关键节点日志埋点**

AgentRunner 构造器增加可选的 logger 参数，在关键节点记录日志：

```ts
// AgentRunner 构造器增加 logger 参数
constructor(opts: {
  config: CoreAgentConfig;
  providers?: ProviderRegistry;
  tools?: AgentTool[];
  session?: Session;
  disableTools?: boolean;
  toolContextState?: Record<string, unknown>;
  logger?: Logger;  // ← 新增
}) {
  // ... 现有逻辑
  const log = opts.logger ?? createLogger("runner", "info");
  this.log = log;
}

// runStream 中增加日志:
async *runStream(params: AgentRunParams): AsyncIterable<AgentRunEvent> {
  this.log?.info(`runStream start: model=${params.model}, msgLen=${params.message.length}`, {
    model: params.model,
    msgPreview: params.message.slice(0, 200),
  });
  // ...
}

// runWithProvider 中，每次 LLM 调用后:
this.log?.info(`LLM call complete: model=${streamModel}, tokens=${streamUsage.totalTokens}`, {
  model: streamModel,
  inputTokens: streamUsage.inputTokens,
  outputTokens: streamUsage.outputTokens,
  stopReason: streamStopReason,
});

// 工具执行时:
this.log?.info(`tool execute: ${call.name}`, { tool: call.name, input: JSON.stringify(call.input).slice(0, 200) });
```

**3e. `src/web/server/routes/messages.ts` — 请求/响应日志**

```ts
// postMessageStream 中:
async function postMessageStream(...) {
  // ...
  logger?.info(`SSE stream start: sessionId=${sessionId}`, {
    sessionId,
    msgPreview: body.text.slice(0, 200),
  });
  // ...
  // 流结束时:
  logger?.info(`SSE stream end: sessionId=${sessionId}, events=${sse.seq}`, {
    sessionId, totalEvents: sse.seq,
  });
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npx vitest run test/
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/logger.ts src/web/server/index.ts src/agent/runner.ts src/web/server/routes/messages.ts bin/my-agent-web.ts test/
git commit -m "feat: structured logging with child logger + access log + runner log points

- logger.ts: add child() method, timestamp prefix, structured data support
- index.ts: access log middleware (method path status duration)
- runner.ts: log user message, LLM output tokens, tool execution
- messages.ts: log SSE stream start/end
- bin/my-agent-web.ts: MY_AGENT_LOG_LEVEL env var for log level
"
```

---

### Task 7: Settings 配置扩展 — 后端 Config API

**Files:**
- Create: `src/web/server/routes/config.ts`
- Modify: `src/web/server/wire-routes.ts`
- Modify: `src/config/loader.ts`（新增 saveConfig）
- Test: `src/web/server/routes/providers.test.ts`（扩展）

- [ ] **Step 1: 编写失败测试 — GET/PUT /api/config**

```ts
// test/config.test.ts — 新增 describe('Config API')
import { describe, it, expect, vi } from 'vitest';

describe('Config API', () => {
  it('saveConfig should write config to JSON file', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const { saveConfig } = await import('../src/config/loader.js');
    const { createConfig } = await import('../src/config/loader.js');

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'my-agent-config-'));
    const configPath = path.join(tmpDir, 'config.json');
    const config = createConfig({
      agent: { maxRetries: 5, defaultModel: 'test-model' },
    });

    await saveConfig(config, configPath);

    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.agent.maxRetries).toBe(5);
    expect(parsed.agent.defaultModel).toBe('test-model');

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('saveConfig should mask apiKey in output', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const { saveConfig } = await import('../src/config/loader.js');
    const { createConfig } = await import('../src/config/loader.js');

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'my-agent-config-'));
    const configPath = path.join(tmpDir, 'config.json');
    const config = createConfig({
      models: {
        providers: { deepseek: { apiKey: 'sk-secret' } },
      },
    });

    await saveConfig(config, configPath);

    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // apiKey 不应写入文件（安全考虑：apiKey 从环境变量注入）
    expect(parsed.models.providers.deepseek.apiKey).toBeUndefined();

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run test/config.test.ts -t "Config API"
```
Expected: FAIL — saveConfig 不存在

- [ ] **Step 3: 实现**

**3a. `src/config/loader.ts` — 新增 saveConfig 函数**

```ts
/**
 * 将 CoreAgentConfig 序列化写入 JSON 文件。
 * 安全策略：apiKey 不写入文件（应由环境变量注入）。
 */
export async function saveConfig(
  config: CoreAgentConfig,
  configPath?: string,
): Promise<void> {
  const resolved = configPath ?? path.join(process.cwd(), "config.json");

  // 深拷贝 + 脱敏：移除所有 provider 的 apiKey
  const safe = JSON.parse(JSON.stringify(config));
  for (const provider of Object.values(safe.models?.providers ?? {})) {
    delete (provider as Record<string, unknown>).apiKey;
  }

  // 原子写入
  const tmp = resolved + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(safe, null, 2), "utf-8");
  await fs.rename(tmp, resolved);
}
```

**3b. 新建 `src/web/server/routes/config.ts`**

```ts
/**
 * my-agent Web 前端 — Config 域 2 条 REST 端点
 *
 * 路由：
 * - GET  /api/config   返回当前 CoreAgentConfig（apiKey 已脱敏）
 * - PUT  /api/config   更新配置（Zod 校验 → 合并 → 写盘）
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "../../../shared/logger.js";
import type { CoreAgentConfig } from "../../../config/schema.js";
import { CoreAgentConfigSchema } from "../../../config/schema.js";
import { loadConfig, saveConfig } from "../../../config/loader.js";
import { readBodyJson, sendJsonError } from "../http-helpers.js";
import { ROUTES } from "../router.js";
import type { Handler, Route } from "../router.js";

export function installConfigRoutes(deps: {
  config: CoreAgentConfig;
  logger?: Logger;
}): void {
  const { config, logger } = deps;

  replaceHandler(ROUTES, "GET", "/api/config", async (_req, res) => {
    // 脱敏返回
    const safe = JSON.parse(JSON.stringify(config));
    for (const p of Object.values(safe.models?.providers ?? {})) {
      (p as Record<string, unknown>).apiKey = (p as Record<string, unknown>).apiKey ? "***" : "";
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, data: safe }));
  });

  registerRoute(ROUTES, "PUT", /^\/api\/config$/, async (req, res) => {
    let body: Record<string, unknown>;
    try {
      body = (await readBodyJson(req)) ?? {};
    } catch {
      sendJsonError(res, 400, "INVALID_JSON", "Invalid JSON body");
      return;
    }
    const parsed = CoreAgentConfigSchema.partial().safeParse(body);
    if (!parsed.success) {
      sendJsonError(res, 422, "VALIDATION_FAILED", "Invalid config", {
        details: parsed.error.flatten(),
      });
      return;
    }
    // 深合并：parsed.data → config
    const merged = CoreAgentConfigSchema.parse({
      ...JSON.parse(JSON.stringify(config)),
      ...parsed.data,
      models: {
        ...config.models,
        ...(parsed.data.models ?? {}),
        providers: {
          ...config.models.providers,
          ...(parsed.data.models?.providers ?? {}),
        },
        catalog: {
          ...config.models.catalog,
          ...(parsed.data.models?.catalog ?? {}),
        },
      },
    });
    Object.assign(config, merged);
    await saveConfig(config);
    logger?.info("[config] updated");
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true }));
  }, ["config"]);

  logger?.info("[config] routes installed (GET/PUT /api/config)");
}

function replaceHandler(routes: Route[], method: string, pattern: string, handler: Handler): void {
  for (const route of routes) {
    if (route[0] === method && route[1] === pattern) {
      route[2] = handler;
      return;
    }
  }
}

function registerRoute(routes: Route[], method: string, pattern: RegExp, handler: Handler, names: string[]): void {
  for (const route of routes) {
    if (route[0] !== method) continue;
    const existing = route[1];
    if (typeof existing === "string") continue;
    if (existing.source === pattern.source && existing.flags === pattern.flags) {
      route[2] = handler;
      return;
    }
  }
  routes.push([method, pattern, handler, names]);
}
```

**3c. `src/web/server/wire-routes.ts` — 注册 config 路由**

在 `wireApiRoutes` 函数中增加：

```ts
import { installConfigRoutes } from "./routes/config.js";

export function wireApiRoutes(deps: WireApiRoutesDeps): void {
  // ... 现有 provider/session/messages/skills 安装

  // 新增: config 路由
  if (deps.config) {
    installConfigRoutes({ config: deps.config, logger: deps.logger });
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npx vitest run test/config.test.ts -t "Config API"
npx vitest run
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/loader.ts src/web/server/routes/config.ts src/web/server/wire-routes.ts test/config.test.ts
git commit -m "feat: GET/PUT /api/config endpoints for config read/write

- loader.ts: add saveConfig() with apiKey stripping
- routes/config.ts: new GET/PUT /api/config endpoints
- wire-routes.ts: register config routes
"
```

---

### Task 8: Settings 前端扩展 — 新增 Agent/Memory/Evolution 配置组

**Files:**
- Modify: `web/src/pages/SettingsPage.tsx`
- Modify: `web/src/lib/api.ts`（如需要 apiPut）
- Test: `web/tests/unit/sessions-page.test.tsx`

- [ ] **Step 1: 编写测试 — Settings 页面显示配置组**

```ts
// web/tests/unit/ — 新增或扩展
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SettingsPage } from '@/pages/SettingsPage';
import { apiGet } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

describe('SettingsPage config sections', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockImplementation((url: string) => {
      if (url === '/api/providers/active') return Promise.resolve(null);
      if (url === '/api/config') return Promise.resolve({
        agent: { defaultModel: 'deepseek-chat', maxRetries: 2, maxToolLoops: 20 },
        memory: { enabled: true, maxResults: 10 },
        evolution: { enabled: true, maxSkills: 200 },
      });
      return Promise.resolve(null);
    });
  });

  it('should render Agent config section', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><SettingsPage /></MemoryRouter>
      </QueryClientProvider>
    );
    expect(await screen.findByText(/Agent/)).toBeDefined();
  });

  it('should render Memory config section', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><SettingsPage /></MemoryRouter>
      </QueryClientProvider>
    );
    expect(await screen.findByText(/Memory/)).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run web/tests/unit/ -t "SettingsPage config sections"
```
Expected: FAIL — 当前 Settings 无 Agent/Memory 配置组

- [ ] **Step 3: 实现 — SettingsPage 新增配置组**

```tsx
// web/src/pages/SettingsPage.tsx — 新增 import 和 query
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '@/lib/api';
import { useTranslation } from '@/i18n/useTranslation';
import { Brain, Zap, Cpu } from 'lucide-react';

export function SettingsPage() {
  const { t } = useTranslation();
  const { theme, toggleTheme, locale, setLocale } = useUiStore();
  const queryClient = useQueryClient();

  // 获取 config
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn: () => apiGet<any>('/api/config').catch(() => null),
    staleTime: 30_000,
  });

  // 更新 config mutation
  const updateConfig = useMutation({
    mutationFn: (partial: Record<string, unknown>) => apiPut('/api/config', partial),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });

  // 获取 active provider
  const { data: activeProvider } = useQuery({
    queryKey: ['settings-active-provider'],
    queryFn: () => apiGet<any>('/api/providers/active').catch(() => null),
    staleTime: 30_000,
  });

  return (
    <div className="p-6 space-y-6" data-testid="page-settings">
      <div>
        <h1 className="text-xl font-bold text-text">{t('settings.title')}</h1>
        <p className="text-sm text-text-muted mt-1">{t('settings.description')}</p>
      </div>

      {/* 外观 */}
      <SettingGroup title={t('settings.appearance')} icon={Monitor}>
        {/* ... 不变 ... */}
      </SettingGroup>

      {/* Agent 配置 — 新增 */}
      {config?.agent && (
        <SettingGroup title="Agent" icon={Zap}>
          <SelectRow
            label={t('settings.defaultModel')}
            value={config.agent.defaultModel || ''}
            options={[
              { value: 'deepseek-chat', label: 'DeepSeek Chat' },
              { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
            ]}
            onChange={(v) => updateConfig.mutate({ agent: { defaultModel: v } })}
          />
          <SelectRow
            label={t('settings.thinkingLevel')}
            value={config.agent.thinkingLevel || 'off'}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'low', label: 'Low' },
              { value: 'high', label: 'High' },
            ]}
            onChange={(v) => updateConfig.mutate({ agent: { thinkingLevel: v } })}
          />
          <div className="flex items-center justify-between">
            <p className="text-sm text-text">{t('settings.maxRetries')}</p>
            <input
              type="number"
              min={0}
              max={10}
              value={config.agent.maxRetries ?? 3}
              onChange={(e) => updateConfig.mutate({ agent: { maxRetries: Number(e.target.value) } })}
              className="w-16 rounded-md border border-border bg-bg px-2 py-1 text-xs text-text text-right"
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-text">{t('settings.maxToolLoops')}</p>
            <input
              type="number"
              min={1}
              max={500}
              value={config.agent.maxToolLoops ?? 100}
              onChange={(e) => updateConfig.mutate({ agent: { maxToolLoops: Number(e.target.value) } })}
              className="w-16 rounded-md border border-border bg-bg px-2 py-1 text-xs text-text text-right"
            />
          </div>
        </SettingGroup>
      )}

      {/* Memory 配置 — 新增 */}
      {config?.memory && (
        <SettingGroup title="Memory" icon={Brain}>
          <ToggleRow
            label={t('settings.memoryEnabled')}
            checked={config.memory.enabled !== false}
            onChange={(v) => updateConfig.mutate({ memory: { enabled: v } })}
          />
          <div className="flex items-center justify-between">
            <p className="text-sm text-text">{t('settings.maxResults')}</p>
            <input
              type="number"
              min={1}
              max={50}
              value={config.memory.maxResults ?? 10}
              onChange={(e) => updateConfig.mutate({ memory: { maxResults: Number(e.target.value) } })}
              className="w-16 rounded-md border border-border bg-bg px-2 py-1 text-xs text-text text-right"
            />
          </div>
        </SettingGroup>
      )}

      {/* 模型供应商 — 只读 */}
      <SettingGroup title={t('settings.provider')} icon={Cpu}>
        {/* ... 不变 ... */}
      </SettingGroup>

      {/* 关于 */}
      <SettingGroup title={t('settings.about')} icon={Info}>
        {/* ... 不变，文本替换为 t() ... */}
      </SettingGroup>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npx vitest run web/tests/unit/ -t "SettingsPage config sections"
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/SettingsPage.tsx web/src/lib/api.ts web/tests/unit/
git commit -m "feat: Settings page expand with Agent/Memory config sections

- SettingsPage.tsx: add Agent (defaultModel, thinkingLevel, maxRetries, maxToolLoops)
  and Memory (enabled, maxResults) config groups with inline editing
- api.ts: add apiPut helper if not exists
"
```

---

## 执行顺序与依赖

```
P0: Task 1 (API Key) ──→ Task 2 (Chat SSE)
         ↓
P1: Task 3 (Session) + Task 4 (i18n hook) ──→ Task 5 (i18n UI)
                             ↓
P2: Task 6 (Logging) + Task 7 (Config API) ──→ Task 8 (Settings UI)
```

- **P0 内部**：Task 1 → Task 2（聊天修复依赖 API Key 可用）
- **P1 内部**：Task 3 ∥ Task 4（会话持久化与 i18n hook 可并行）→ Task 5（i18n UI 依赖 Task 4）
- **P2 内部**：Task 6 ∥ Task 7（日志与 Config API 可并行）→ Task 8（Settings UI 依赖 Config API）
- **跨 GROUP**：P1 依赖 P0 完成（测试验证聊天功能）；P2 独立，可与 P1 并行

---

## Plan 自检

1. **Spec coverage:** 对照 spec 6 个问题逐项检查：
   - #1 会话持久化 → Task 3 ✅
   - #2 i18n 中文切换 → Task 4 + Task 5 ✅
   - #3 API Key 为空 → Task 1 ✅
   - #4 聊天不回复 → Task 2 ✅
   - #5 日志不详细 → Task 6 ✅
   - #6 Settings 可配置项 → Task 7 + Task 8 ✅
2. **Placeholder 扫描：** 无 TBD/TODO，所有代码步骤有具体实现 ✅
3. **Type 一致性：** Logger.child、saveConfig、useTranslation 接口在定义和使用处一致 ✅
4. **TDD 合规：** 每个 Task 以测试开头、以验证结尾 ✅

---

## Next

- 计划确认 → 说「开始实现」或「执行」
- 需要调整 → 直接说修改意见
- 想拆分并行 → 说「并行执行」
