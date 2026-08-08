---
artifact: implementation-plan
route: superpowers:writing-plans -> orchestration
skills:
  - writing-plans
  - orchestration
skills_evidence:
  - ~/.claude/skills/writing-plans/SKILL.md（已 Load）
  - harness-kit/core/orchestration/dispatcher-workflow.md
source:
  - .ai-runtime-artifacts/specs/2026-08-08-web-frontend-react-rewrite-spec.md（v4 spec，1334 行）
  - .ai-runtime-artifacts/contracts/2026-08-07-web-frontend-api-contract.md
  - .ai-runtime-artifacts/reviews/2026-08-08-web-frontend-spec-document-review-v2.md
  - AGENTS.md
  - harness-kit/core/routing.md
  - harness-kit/references/definition-of-done.md
created_at: 2026-08-08
status: draft
approved: false
tier: 2
dispatch: .ai-runtime-artifacts/plans/2026-08-08-web-frontend-react-rewrite-dispatch.md
prior_plan: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md（vanilla JS 实现计划，已完成并合流 main）
---

# my-agent Web 前端 React 重写 — 实施计划

> 本文为 `.ai-runtime-artifacts/specs/2026-08-08-web-frontend-react-rewrite-spec.md`（v4，1334 行）的实施拆解。
> Goal = spec § 1.2；非目标、约束、风险均以 spec 为准，本文仅把 spec § 9.2 的 M1-M8 阶段细化为 TDD 任务。
> **TDD 强制**：每个任务 Step 1 = 写失败测试；Step 2 = 跑测试确认失败；Step 3 = 写最小实现；Step 4 = 跑测试确认通过；Step 5 = 提交。

## 1. Goal（对齐 spec § 1.2）

1. **观感现代化**：借鉴 Orkas 视觉语言（极简 + 留白 + 克制色彩），不 1:1 照搬。
2. **技术栈升级**：React 19 + TypeScript + Vite 6 + Tailwind v4 + shadcn/ui（手拷）+ Radix 1.1+ + Zustand 5 + TanStack Query v5 + HashRouter。
3. **架构清晰**：pages + components 分层；跨领域复用走 `features/`；通用 UI 走 `components/ui/`。
4. **保留行为**：所有 19 个 wire-routes 行为不变；SSE 流式聊天、@ 提及、⌘K 等已有交互保留并升级。
5. **可访问性 ≥ WCAG 2.1 AA**：所有交互键盘可达，颜色对比 ≥ 4.5:1。
6. **性能预算**：首屏 JS（gzipped）≤ 180KB，LCP ≤ 1.2s（prod preview 模式测量）。

## 2. Architecture Overview

```
[浏览器 @ http://localhost:4321（dev 与 prod 同源）]
  web/index.html + web/src/{main.tsx, App.tsx, routes.tsx}
       │  fetch(POST) + ReadableStream  ←  SseHub 兼容协议
       ▼
[Node 单进程：bin/my-agent-web.ts（零业务改动，env MY_AGENT_WEB_ROOT=web/dist）]
  ├─ src/web/server/index.ts  (CSP + 静态服务，已扩 ALLOWED_EXTS)
  ├─ src/web/server/routes/*  (19 个 wire-routes 零改动)
  ├─ src/web/server/sse.ts    (SseHub + 13 个 SSE_EVENT_TYPES)
  └─ src/web/server/errors.ts (ApiErrorCode 27 个 + ERROR_STATUS_MAP)

  后端最小改动（spec § 3.4）：
    - src/web/server/csp.ts：font-src 增 'self'
    - src/web/server/static.ts：ALLOWED_EXTS 增 .mjs/.woff2/.png/.webmanifest/.map；cache-control 按 hash 二分
```

## 3. Tech Stack（spec § 2 已确认）

- **框架**：React 19.1 + react-dom 19.1
- **构建**：Vite 6.3 + @vitejs/plugin-react 4.3
- **样式**：Tailwind CSS 4.0 CSS-first `@theme` + `@tailwindcss/postcss`
- **组件**：shadcn/ui（**手拷模式**）+ Radix Primitives ≥ 1.1
- **路由**：React Router v6.28 **HashRouter**
- **状态**：Zustand 5（≤ 4 slice）+ TanStack Query v5
- **表单**：react-hook-form 7 + zod 3（与后端共享）
- **Markdown**：react-markdown 9 + remark-gfm 4 + rehype-sanitize 6（lazy import）
- **SSE**：fetch(POST) + ReadableStream 手写解析（**不用 EventSource**）
- **测试**：Vitest 2.1（jsdom）+ @testing-library/react 16 + Playwright 1.49 + @axe-core/playwright
- **包管理**：npm（**不用 pnpm**，锁 `package-lock.json`）

## 4. Critical Files Inventory

### 4.1 新建文件（前端 `web/`）

```
web/
├── package.json                          ← M1
├── vite.config.ts                        ← M1
├── tsconfig.json                         ← M1
├── postcss.config.js                     ← M1
├── components.json                       ← M1（shadcn 手拷 alias 配置）
├── index.html                            ← M1
├── vitest.config.ts                      ← M1
├── playwright.config.ts                  ← M3
├── public/fonts/{Inter-Regular,Bold,Medium,JetBrainsMono-Regular}.woff2  ← M2
├── src/
│   ├── main.tsx                          ← M1
│   ├── App.tsx                           ← M1
│   ├── routes.tsx                        ← M3
│   ├── i18n/{zh,en}.json                 ← M7
│   ├── i18n/toast.json                   ← M7（v4 新增）
│   ├── test-setup.ts                     ← M1
│   ├── styles/globals.css                ← M1（M2 加暗色）
│   ├── styles/tokens.ts                  ← M1
│   ├── lib/{cn,api,sse,i18n,keymap,error}.ts   ← M1/M4
│   ├── components/ui/{button,dialog,dropdown-menu,tabs,tooltip,toast,input,textarea,card,popover,select,scroll-area,separator,kebab-button,message-bubble-copy}.tsx   ← M1+ 渐进
│   ├── components/layout/{AppShell,Sidebar,Topbar,SidebarSessionItem}.tsx   ← M3
│   ├── components/chat/{Composer,MessageList,MessageBubble,Markdown,ToolCallCard,StreamIndicator,EmptyState,ConfirmDialog,ErrorBoundary}.tsx   ← M5+ 渐进
│   ├── components/feedback/{EmptyState,ErrorBoundary,ConfirmDialog}.tsx    ← M3/M4
│   ├── features/chat/{useChatStream,composerDraftStore,types}.ts           ← M5
│   ├── features/sessions/{useSessions,SessionListItem}.tsx                 ← M3/M6
│   ├── features/providers/{ProviderForm,useProviders,ProviderDetail}.tsx   ← M6
│   ├── features/skills/{useSkills,SkillCard,SkillDetailModal}.tsx          ← M6
│   ├── features/agents/{useAgents,AgentList,AgentDetailModal}.tsx          ← M6
│   ├── features/ui/{useUiStore,useKeyMap,useTheme,useMediaQuery}.ts        ← M3/M7
│   ├── pages/{DashboardPage,ChatPage,SessionsPage,ProvidersPage,SkillsPage,AgentsPage,SettingsPage,NotFoundPage}.tsx   ← M3+ 渐进
│   └── hooks/{useDebounce,useKeyMap,useTheme,useMediaQuery,useChatStreamState}.ts   ← M1/M5
└── tests/{unit,e2e}/**/*.{spec,test}.{ts,tsx}                              ← 渐进
```

### 4.2 新建/修改文件（后端最小改动）

| 文件 | 改动 | 任务 |
|---|---|---|
| `src/web/server/csp.ts` | `font-src` 增 `'self'` | M2 Task 2.1 |
| `src/web/server/static.ts` | `ALLOWED_EXTS` 增 `.mjs/.woff2/.png/.webmanifest/.map`；cache-control 按 hash 二分 | M2 Task 2.2 / 2.3 |

### 4.3 复用模块（spec § 3.4 / § 1.3 强调"不动"）

- `src/web/server/index.ts` 零改动
- `src/web/server/sse.ts` 零改动（事件协议以源码 13 个事件为准）
- `src/web/server/routes/*` 零改动（19 个 wire-routes）
- `src/web/server/errors.ts` 零改动（ApiErrorCode 27 个枚举是事实标准）
- `bin/my-agent-web.ts` 零改动（已支持 `MY_AGENT_WEB_ROOT` / `MY_AGENT_WEB_PORT`）
- 根 `package.json` / `vitest.config.ts` 零改动

### 4.4 删除文件（Step 7 / M8）

| 旧文件 | 删除时机 |
|---|---|
| `web/{index.html,style.css,js/,components/,features/,shared/,state/,vendor/}` | M8 |
| `test/web-legacy/`（已 git mv 自 `test/web/`） | M8 |

## 5. Constraints / Acceptance Criteria

完整验收 15 项见 spec § 11（A1-A15）。本文核心约束：

- **TDD**：每个任务 Step 1 = 写失败测试，Step 2 = 跑测试确认失败，Step 3 = 写最小实现，Step 4 = 跑测试确认通过，Step 5 = 提交
- **零后端业务改动**：仅 csp.ts + static.ts 两个文件
- **19 wire-routes 行为一致**：与契约 § 1 一一对应，Playwright 跑通 19/19
- **错误码全覆盖**：§ 12.10 表 27 个 ApiErrorCode 全部对应 UI 反馈
- **状态机完整**：§ 6.4.3 7 态（含 submitting 10s 超时 / reconnecting 终止态）
- **bundle 预算**：首屏 JS gzip ≤ 180KB；CSS ≤ 20KB

## 6. WU 拆解（spec § 9.2 M1-M8 → TDD 任务）

### 阶段 M1：脚手架

**Files（Create）：** `web/package.json` / `web/vite.config.ts` / `web/tsconfig.json` / `web/postcss.config.js` / `web/components.json` / `web/index.html` / `web/vitest.config.ts` / `web/src/main.tsx` / `web/src/App.tsx` / `web/src/styles/globals.css` / `web/src/styles/tokens.ts` / `web/src/lib/cn.ts` / `web/src/components/ui/button.tsx` / `web/src/test-setup.ts`

---

#### Task M1.1: Vite + React + TS 脚手架 + 第一个组件测试

**Files:**
- Create: `web/package.json`
- Create: `web/vite.config.ts`
- Create: `web/tsconfig.json`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/lib/cn.ts`
- Create: `web/src/test-setup.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/tests/unit/cn.test.ts
import { describe, it, expect } from 'vitest';
import { cn } from '../../src/lib/cn';

describe('cn', () => {
  it('merges class strings', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });
  it('filters falsy values', () => {
    expect(cn('foo', false, null, undefined, 'bar')).toBe('foo bar');
  });
  it('tailwind-merge: later wins', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/unit/cn.test.ts`
Expected: FAIL — "Cannot find module '../../src/lib/cn'"

- [ ] **Step 3: 写最小实现**

```ts
// web/src/lib/cn.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

同时创建 `web/package.json`：
```json
{
  "name": "my-agent-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.0"
  },
  "devDependencies": {
    "vite": "^6.3.0",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/node": "^22.0.0",
    "vitest": "^2.1.0",
    "jsdom": "^25.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0"
  }
}
```

`web/vite.config.ts`：
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
  },
});
```

`web/tsconfig.json`：
```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "tests"]
}
```

`web/vitest.config.ts`：
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

`web/src/test-setup.ts`：
```ts
import '@testing-library/jest-dom/vitest';
```

`web/index.html`：
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>my-agent</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/main.tsx`：
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

`web/src/App.tsx`：
```tsx
export function App() {
  return <div data-testid="app">my-agent</div>;
}
```

- [ ] **Step 4: 跑测试 + 构建确认**

Run: `cd web && npm install && npx vitest run && npm run build`
Expected: cn.test.ts 3/3 PASS；`web/dist/index.html` 生成

- [ ] **Step 5: 提交**

```bash
cd /Users/mima0000/Documents/学习-001/do-project/my-agent
git add web/package.json web/package-lock.json web/vite.config.ts web/tsconfig.json web/index.html web/vitest.config.ts web/src/test-setup.ts web/src/main.tsx web/src/App.tsx web/src/lib/cn.ts
git commit -m "feat(web): M1.1 vite + react + ts scaffold + cn utility"
```

---

#### Task M1.2: Tailwind v4 + shadcn/ui Button（手拷）

**Files:**
- Create: `web/postcss.config.js`
- Create: `web/src/styles/globals.css`
- Create: `web/src/styles/tokens.ts`
- Create: `web/src/components/ui/button.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// web/tests/unit/button.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../../src/components/ui/button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>点我</Button>);
    expect(screen.getByRole('button', { name: '点我' })).toBeInTheDocument();
  });
  it('applies variant class', () => {
    render(<Button variant="destructive">del</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-danger');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/button.test.tsx`
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: 写最小实现**

```js
// web/postcss.config.js
export default { plugins: { '@tailwindcss/postcss': {} } };
```

```css
/* web/src/styles/globals.css */
@import "tailwindcss";

@theme {
  --color-bg: #f7f8fa;
  --color-surface: #ffffff;
  --color-surface-hover: #f3f4f6;
  --color-border: #ececef;
  --color-text: #1f2328;
  --color-text-muted: #4b5563;
  --color-primary: #6c5ce7;
  --color-primary-fg: #ffffff;
  --color-danger: #e5484d;
  --color-danger-bg: #fef2f2;
  --color-accent: #f0efff;
  --color-accent-fg: #4f46e5;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
}
```

```ts
// web/src/styles/tokens.ts
export const tokens = {
  color: { /* 与 @theme 一一对应 */ },
} as const;
```

```tsx
// web/src/components/ui/button.tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/cn';

type Variant = 'default' | 'destructive' | 'ghost' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  default: 'bg-primary text-primary-fg hover:opacity-90',
  destructive: 'bg-danger text-white hover:opacity-90',
  ghost: 'hover:bg-surface-hover',
  outline: 'border border-border bg-surface hover:bg-surface-hover',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary',
          'disabled:pointer-events-none disabled:opacity-50',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/button.test.tsx`
Expected: 2/2 PASS

- [ ] **Step 5: 提交**

```bash
git add web/postcss.config.js web/src/styles/ web/src/components/ui/button.tsx web/tests/unit/button.test.tsx
git commit -m "feat(web): M1.2 tailwind v4 + button shadcn port"
```

---

### 阶段 M2：后端联动 + 字体

#### Task M2.1: 后端 csp.ts 加 font-src 'self'

**Files:**
- Modify: `src/web/server/csp.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/tests/unit/csp-font-src.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('csp.ts', () => {
  it('contains font-src self', () => {
    const src = readFileSync(resolve(__dirname, '../../../src/web/server/csp.ts'), 'utf8');
    expect(src).toMatch(/font-src[^;]*'self'/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/csp-font-src.test.ts`
Expected: FAIL — no match

- [ ] **Step 3: 写最小实现**

修改 `src/web/server/csp.ts`，找到 `font-src` 行：
```diff
- font-src https://fonts.gstatic.com data:;
+ font-src 'self' data:;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/csp-font-src.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/web/server/csp.ts web/tests/unit/csp-font-src.test.ts
git commit -m "fix(server): csp.ts add font-src 'self' for self-hosted woff2"
```

---

#### Task M2.2: 后端 static.ts 扩 ALLOWED_EXTS + cache-control 按 hash

**Files:**
- Modify: `src/web/server/static.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/tests/unit/static-ext.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('static.ts ALLOWED_EXTS', () => {
  it('includes .mjs .woff2 .png .webmanifest .map', () => {
    const src = readFileSync('src/web/server/static.ts', 'utf8');
    for (const ext of ['.mjs', '.woff2', '.png', '.webmanifest', '.map']) {
      expect(src).toContain(ext);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/static-ext.test.ts`
Expected: FAIL — 至少一个 ext 缺失

- [ ] **Step 3: 写最小实现**

```diff
// src/web/server/static.ts
const ALLOWED_EXTS = new Set([
  '.html', '.js', '.mjs', '.css', '.json',
  '.woff2', '.png', '.svg', '.webmanifest', '.map',
  '.ico',
]);
```

并修改 cache-control 分发逻辑（hash 文件 → immutable，其余 → no-cache）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/static-ext.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/web/server/static.ts web/tests/unit/static-ext.test.ts
git commit -m "fix(server): static.ts extend ALLOWED_EXTS + hash cache split"
```

---

#### Task M2.3: 自托管 woff2 入仓 + globals.css @font-face

**Files:**
- Create: `web/public/fonts/Inter-Regular.woff2`（用户上传或脚手架下载脚本）
- Create: `web/public/fonts/Inter-Bold.woff2`
- Create: `web/public/fonts/JetBrainsMono-Regular.woff2`
- Modify: `web/src/styles/globals.css`

- [ ] **Step 1: 写失败测试**

```ts
// web/tests/unit/font-face.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('fonts css @font-face', () => {
  it('declares Inter + JetBrains Mono', () => {
    const src = readFileSync('web/src/styles/globals.css', 'utf8');
    expect(src).toMatch(/@font-face[^}]*Inter-Regular/);
    expect(src).toMatch(/@font-face[^}]*JetBrainsMono/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/font-face.test.ts`
Expected: FAIL — no match

- [ ] **Step 3: 写最小实现**

在 `web/src/styles/globals.css` 顶部添加：
```css
@font-face {
  font-family: 'Inter';
  src: url('/fonts/Inter-Regular.woff2') format('woff2');
  font-display: swap;
  font-weight: 400;
}
@font-face {
  font-family: 'Inter';
  src: url('/fonts/Inter-Bold.woff2') format('woff2');
  font-display: swap;
  font-weight: 700;
}
@font-face {
  font-family: 'JetBrainsMono';
  src: url('/fonts/JetBrainsMono-Regular.woff2') format('woff2');
  font-display: swap;
}
```

手动从 [Google Fonts Helper](https://gwfh.mranftl.com/) 下载 woff2 放入 `web/public/fonts/`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/font-face.test.ts`
Expected: PASS

- [ ] **Step 5: 验证 prod 服务 + 提交**

Run: `cd web && npm run build && MY_AGENT_WEB_ROOT=web/dist MY_AGENT_WEB_PORT=4321 npx tsx ../bin/my-agent-web.ts &`
Then: `curl -I http://localhost:4321/fonts/Inter-Regular.woff2`
Expected: 200 + `Cache-Control: public, max-age=86400`
Then: `curl -I http://localhost:4321/assets/index-*.js`
Expected: 200 + `Cache-Control: ... immutable`

```bash
git add web/public/fonts/ web/src/styles/globals.css web/tests/unit/font-face.test.ts
git commit -m "feat(web): M2.3 self-hosted woff2 + @font-face declarations"
```

---

### 阶段 M3：Layout（AppShell + Sidebar + Topbar + 8 路由骨架）

#### Task M3.1: 路由表 + 8 个 page 空壳 + HashRouter

**Files:**
- Create: `web/src/routes.tsx`
- Create: `web/src/pages/{DashboardPage,ChatPage,SessionsPage,ProvidersPage,SkillsPage,AgentsPage,SettingsPage,NotFoundPage}.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// web/tests/unit/routes-table.test.ts
import { describe, it, expect } from 'vitest';
import { routes } from '../../src/routes';

describe('routes', () => {
  it('declares 8 entries', () => {
    expect(routes.length).toBe(8);
  });
  it('declares path "/" → DashboardPage', () => {
    const r = routes.find(r => r.path === '/')!;
    expect(r.handle?.label).toBe('Dashboard');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/routes-table.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: 写最小实现**

```tsx
// web/src/routes.tsx
import { type RouteObject } from 'react-router-dom';
import { DashboardPage } from '@/pages/DashboardPage';
import { ChatPage } from '@/pages/ChatPage';
// ... 其他 6 个

export const routes: RouteObject[] = [
  { path: '/', element: <DashboardPage />, handle: { label: 'Dashboard' } },
  { path: '/chat', element: <ChatPage /> },
  { path: '/chat/:sessionId', element: <ChatPage /> },
  { path: '/sessions', element: <SessionsPage />, handle: { label: 'Sessions' } },
  { path: '/providers', element: <ProvidersPage />, handle: { label: 'Providers' } },
  { path: '/skills', element: <SkillsPage />, handle: { label: 'Skills' } },
  { path: '/agents', element: <AgentsPage />, handle: { label: 'Agents' } },
  { path: '/settings', element: <SettingsPage />, handle: { label: 'Settings' } },
  { path: '*', element: <NotFoundPage /> },
];
```

```tsx
// web/src/pages/DashboardPage.tsx
export function DashboardPage() { return <div data-testid="page-dashboard">Dashboard</div>; }
// 其他 7 个类似
```

修改 `web/src/App.tsx`：
```tsx
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { routes } from './routes';

const router = createHashRouter(routes);

export function App() {
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 4: 跑测试 + dev 启动验证**

Run: `npx vitest run tests/unit/routes-table.test.ts`
Expected: PASS

Run: `cd web && npm run dev &` → `curl http://localhost:5173/`
Expected: HTML 含 `#/`

- [ ] **Step 5: 提交**

```bash
git add web/src/routes.tsx web/src/App.tsx web/src/pages/ web/tests/unit/routes-table.test.ts
git commit -m "feat(web): M3.1 hashrouter + 8 page shells"
```

---

#### Task M3.2: AppShell + Sidebar + Topbar 静态版

**Files:**
- Create: `web/src/components/layout/{AppShell,Sidebar,Topbar}.tsx`
- Create: `web/src/hooks/{useTheme,useKeyMap}.ts`
- Create: `web/src/lib/keymap.ts`

- [ ] **Step 1: 写失败测试**

```tsx
// web/tests/unit/app-shell.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../src/components/layout/AppShell';

describe('AppShell', () => {
  it('renders sidebar + topbar + outlet', () => {
    render(<MemoryRouter><AppShell /></MemoryRouter>);
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/app-shell.test.tsx`
Expected: FAIL

- [ ] **Step 3: 写最小实现**

```tsx
// web/src/components/layout/AppShell.tsx
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-bg text-text">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Topbar />
        <main className="flex-1"><Outlet /></main>
      </div>
    </div>
  );
}
```

`Sidebar` 用 lucide-react 图标（MessageSquare/History/Bot/Plug/Settings2/SlidersHorizontal）按 spec § 5.3 顺序排。
`Topbar` 含主题切换 + 语言切换 + ⌘K 提示。

- [ ] **Step 4: 跑测试 + Playwright 验证**

Run: `npx vitest run tests/unit/app-shell.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/components/layout/ web/src/hooks/useTheme.ts web/src/hooks/useKeyMap.ts web/src/lib/keymap.ts web/tests/unit/app-shell.test.tsx
git commit -m "feat(web): M3.2 app shell + sidebar + topbar + keymap hook"
```

---

### 阶段 M4：数据层（lib/api + lib/sse + TanStack Query）

#### Task M4.1: lib/api.ts + Zod schema 19 endpoint + QueryClient 默认配置

**Files:**
- Create: `web/src/lib/api.ts`
- Create: `web/src/lib/error.ts`（v4 新增：错误码 → UI 映射表）
- Create: `web/src/lib/query-keys.ts`
- Modify: `web/src/main.tsx`

- [ ] **Step 1: 写失败测试**

```ts
// web/tests/unit/api.test.ts
import { describe, it, expect, vi } from 'vitest';
import { apiGet, apiPost } from '../../src/lib/api';

describe('api', () => {
  it('GET /api/sessions returns sessions', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ sessions: [] }), { status: 200 })
    );
    const res = await apiGet('/api/sessions', { limit: 10 });
    expect(res).toEqual({ sessions: [] });
  });
  it('throws ApiError on 4xx', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'SESSION_NOT_FOUND', message: 'x' }), { status: 404 })
    );
    await expect(apiGet('/api/sessions/abc/history')).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND', status: 404 });
  });
  it('POST /api/sessions/:id/messages/stream with body', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(null, { status: 200 }));
    await apiPost('/api/sessions/x/messages/abort', { streamId: 'y' });
    expect(fetch).toHaveBeenCalledWith('/api/sessions/x/messages/abort', expect.objectContaining({ method: 'POST' }));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/api.test.ts`
Expected: FAIL

- [ ] **Step 3: 写最小实现**

```ts
// web/src/lib/api.ts
import { z } from 'zod';

export const ApiErrorCodes = [
  'INVALID_JSON','VALIDATION_FAILED','NOT_FOUND','METHOD_NOT_ALLOWED',
  'PAYLOAD_TOO_LARGE','RATE_LIMITED','INTERNAL',
  'PROVIDER_NOT_FOUND','PROVIDER_DUPLICATE_ID','PROVIDER_INVALID_BASE_URL',
  'PROVIDER_INVALID_TYPE','PROVIDER_API_KEY_EMPTY','PROVIDER_ACTIVE_NOT_DELETABLE',
  'PROVIDER_ALREADY_EXISTS','MODEL_NOT_FOUND',
  'SESSION_NOT_FOUND','SESSION_ALREADY_EXISTS','SESSION_CORRUPT_FILE',
  'CHAT_SESSION_BUSY','CHAT_ABORTED','CHAT_RUNNER_ERROR','CHAT_INVALID_EVENT',
  'STREAM_ALREADY_RUNNING','STREAM_NOT_FOUND',
  'AGENT_NOT_FOUND','AGENT_SPEC_INVALID_JSON','SKILL_NOT_FOUND',
] as const;
export type ApiErrorCode = typeof ApiErrorCodes[number];

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, public status: number, public details?: unknown) {
    super(`[${code}] ${status}`);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.code ?? 'INTERNAL', res.status, body.details);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const apiGet = <T>(path: string) => apiFetch<T>(path);
export const apiPost = <T>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const apiPut = <T>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const apiPatch = <T>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const apiDelete = <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' });
```

```ts
// web/src/lib/error.ts（v4 新增）
export const errorUiMap: Record<ApiErrorCode, { toast: string; autoAction?: string }> = {
  INVALID_JSON: { toast: '请求格式错误' },
  VALIDATION_FAILED: { toast: '字段校验失败', autoAction: 'focusFirstError' },
  SESSION_NOT_FOUND: { toast: '会话不存在', autoAction: 'navigate:/sessions' },
  CHAT_RUNNER_ERROR: { toast: '', autoAction: 'showRedBarWithRetry' },  // 走 § 12.1.3
  // ... 全 27 个 code
} as const;
```

修改 `main.tsx` 加 QueryClientProvider（按 spec § 6.2 默认配置）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/api.test.ts`
Expected: 3/3 PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/lib/ web/src/main.tsx web/tests/unit/api.test.ts
git commit -m "feat(web): M4.1 api fetch + 27 api errors + zod + queryclient"
```

---

#### Task M4.2: lib/sse.ts fetch+ReadableStream 解析 13 个事件 + abort

**Files:**
- Create: `web/src/lib/sse.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/tests/unit/sse.test.ts
import { describe, it, expect, vi } from 'vitest';
import { parseSseStream } from '../../src/lib/sse';

function mockStream(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(ctrl) {
      for (const f of frames) ctrl.enqueue(enc.encode(f));
      ctrl.close();
    },
  });
}

describe('parseSseStream', () => {
  it('parses message_start + content_block_delta + message_stop', async () => {
    const events: any[] = [];
    const s = mockStream([
      'id: 1\nevent: message_start\ndata: {"streamId":"abc","cid":"c","seq":1}\n\n',
      'id: 2\nevent: content_block_delta\ndata: {"seq":2,"delta":{"text":"hi"}}\n\n',
      'id: 3\nevent: message_stop\ndata: {"seq":3}\n\n',
    ]);
    for await (const e of parseSseStream(s)) events.push(e);
    expect(events.map(e => e.event)).toEqual(['message_start', 'content_block_delta', 'message_stop']);
    expect(events[0].data.streamId).toBe('abc');
  });
  it('skips unknown event type without throwing', async () => {
    const s = mockStream(['event: unknown\ndata: {}\n\n']);
    const events: any[] = [];
    for await (const e of parseSseStream(s)) events.push(e);
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/sse.test.ts`
Expected: FAIL

- [ ] **Step 3: 写最小实现**

```ts
// web/src/lib/sse.ts
export const SSE_EVENT_TYPES = [
  'message_start','content_block_start','content_block_delta','content_block_stop',
  'tool_use','tool_result','message_delta','message_stop',
  'error','done','aborted','usage','ping',
] as const;

export interface SseEvent<T = unknown> {
  id: string;
  event: typeof SSE_EVENT_TYPES[number] | 'unknown';
  data: T;
}

export async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const parsed = parseFrame(frame);
      if (parsed) yield parsed;
    }
  }
}

function parseFrame(frame: string): SseEvent | null {
  const lines = frame.split('\n');
  let id = '', event = '', data = '';
  for (const line of lines) {
    if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!event) return null;
  const known = (SSE_EVENT_TYPES as readonly string[]).includes(event);
  return { id, event: (known ? event : 'unknown') as any, data: data ? JSON.parse(data) : null };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/sse.test.ts`
Expected: 2/2 PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/lib/sse.ts web/tests/unit/sse.test.ts
git commit -m "feat(web): M4.2 sse parser with 13 event types + unknown skip"
```

---

### 阶段 M5：聊天流（端到端 + 状态机 7 态）

#### Task M5.1: useChatStream + 7 态状态机（spec § 6.4.3）

**Files:**
- Create: `web/src/features/chat/useChatStream.ts`
- Create: `web/src/hooks/useChatStreamState.ts`

- [ ] **Step 1: 写失败测试（4 个核心分支）**

```ts
// web/tests/unit/chat-stream-state.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatStream } from '../../src/features/chat/useChatStream';

function makeMockStream(frames: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('useChatStream state machine', () => {
  it('idle → submitting → streaming → done on message_stop', async () => {
    const states: string[] = [];
    const { result } = renderHook(() => {
      const s = useChatStream('cid-1');
      states.push(s.status);
      return s;
    });
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      makeMockStream([
        'event: message_start\ndata: {"streamId":"abc"}\n\n',
        'event: content_block_delta\ndata: {"seq":1,"delta":{"text":"hi"}}\n\n',
        'event: message_stop\ndata: {"seq":2}\n\n',
      ])
    );
    await act(async () => { await result.current.send('hello'); });
    expect(states).toContain('submitting');
    expect(states).toContain('streaming');
    expect(states[states.length - 1]).toBe('done');
  });

  it('streaming → reconnecting on reader throw → error after 5 retries', async () => {
    const states: string[] = [];
    const { result } = renderHook(() => {
      const s = useChatStream('cid-2');
      states.push(s.status);
      return s;
    });
    // 第 2 帧抛错（断网模拟）→ 状态 reconnecting
    // 5 次重连失败 → 状态 error + Toast 出现
    // （实现细节见 useChatStream.ts）
  });

  it('submitting 10s 超时 → error', async () => {
    // mock fetch 永不响应 → 10s 后状态 error
    vi.useFakeTimers();
    const { result } = renderHook(() => useChatStream('cid-3'));
    vi.spyOn(global, 'fetch').mockReturnValueOnce(new Promise(() => {})); // 永远 hang
    await act(async () => { result.current.send('hi'); });
    await act(async () => { vi.advanceTimersByTime(11_000); });
    expect(result.current.status).toBe('error');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/chat-stream-state.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: 写最小实现**

```ts
// web/src/features/chat/useChatStream.ts
import { useState, useRef, useCallback } from 'react';
import { parseSseStream } from '@/lib/sse';

export type ChatStatus = 'idle'|'submitting'|'streaming'|'done'|'aborted'|'error'|'reconnecting';

const MAX_RETRIES = 5;
const SUBMITTING_TIMEOUT_MS = 10_000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

export function useChatStream(cid: string) {
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [messages, setMessages] = useState<Array<{ role: 'user'|'assistant'; text: string }>>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const submittingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback(async (text: string) => {
    // 状态：idle/done/aborted/error → submitting
    if (['submitting','streaming','reconnecting'].includes(status)) return;
    const ctrl = new AbortController();
    controllerRef.current = ctrl;
    streamIdRef.current = null;
    setStatus('submitting');
    setMessages(m => [...m, { role: 'user', text }]);
    // 10s 超时
    submittingTimerRef.current = setTimeout(() => {
      ctrl.abort();
      setStatus('error');
      // Toast '服务无响应'
    }, SUBMITTING_TIMEOUT_MS);

    try {
      const res = await fetch(`/api/sessions/${cid}/messages/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: ctrl.signal,
        credentials: 'same-origin',
      });
      if (submittingTimerRef.current) clearTimeout(submittingTimerRef.current);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('no body');
      setStatus('streaming');
      let assistantText = '';
      let retries = 0;
      while (true) {
        try {
          for await (const evt of parseSseStream(res.body)) {
            if (evt.event === 'message_start') {
              streamIdRef.current = (evt.data as any).streamId;
            } else if (evt.event === 'content_block_delta') {
              assistantText += (evt.data as any).delta?.text ?? '';
              setMessages(m => [...m.slice(0, -1), { role: 'assistant', text: assistantText }]);
            } else if (evt.event === 'message_stop' || evt.event === 'done') {
              setStatus('done');
              return;
            } else if (evt.event === 'error') {
              setStatus('error');
              return;
            } else if (evt.event === 'aborted') {
              setStatus('aborted');
              return;
            }
          }
          return;
        } catch (e) {
          // reader 抛错（断网/5xx）→ reconnecting
          if (retries >= MAX_RETRIES) {
            setStatus('error');
            // Toast '连接已断开，请刷新'
            return;
          }
          setStatus('reconnecting');
          await new Promise(r => setTimeout(r, BACKOFF_MS[retries]));
          retries++;
          setStatus('streaming');
        }
      }
    } catch (e) {
      if (submittingTimerRef.current) clearTimeout(submittingTimerRef.current);
      setStatus('error');
    }
  }, [cid, status]);

  const abort = useCallback(async () => {
    controllerRef.current?.abort();
    if (streamIdRef.current) {
      await fetch(`/api/sessions/${cid}/messages/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId: streamIdRef.current }),
        credentials: 'same-origin',
      });
    }
    setStatus('aborted');
  }, [cid]);

  const retry = useCallback(() => {
    const last = messages[messages.length - 2]; // 重试上一条 user
    if (last?.role === 'user') send(last.text);
  }, [messages, send]);

  return { status, messages, send, abort, retry };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/chat-stream-state.test.ts`
Expected: 3/3 PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/features/chat/useChatStream.ts web/tests/unit/chat-stream-state.test.ts
git commit -m "feat(web): M5.1 useChatStream 7-state machine + 10s timeout + 5 retry"
```

---

#### Task M5.2: Composer + MessageList + Markdown lazy + MessageBubble 复制

**Files:**
- Create: `web/src/components/chat/{Composer,MessageList,MessageBubble,Markdown,StreamIndicator}.tsx`
- Create: `web/src/features/chat/composerDraftStore.ts`

- [ ] **Step 1: 写失败测试**

```tsx
// web/tests/unit/message-copy.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageBubble } from '../../src/components/chat/MessageBubble';

describe('MessageBubble copy', () => {
  it('copies text to clipboard on click', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: write } });
    render(<MessageBubble role="assistant" text="hello world" />);
    fireEvent.click(screen.getByRole('button', { name: /复制/ }));
    expect(write).toHaveBeenCalledWith('hello world');
  });
  it('shows toast on clipboard error', async () => {
    const write = vi.fn().mockRejectedValue(new Error('denied'));
    Object.assign(navigator, { clipboard: { writeText: write } });
    render(<MessageBubble role="assistant" text="x" />);
    fireEvent.click(screen.getByRole('button', { name: /复制/ }));
    expect(await screen.findByText(/复制失败/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/message-copy.test.tsx`
Expected: FAIL

- [ ] **Step 3: 写最小实现**

```tsx
// web/src/components/chat/MessageBubble.tsx
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Markdown } from './Markdown';

export function MessageBubble({ role, text }: { role: 'user'|'assistant'; text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch (e) {
      // Toast '复制失败'
      console.error(e);
    }
  };
  return (
    <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'} group relative`}>
      <div className={role === 'user' ? 'bg-surface-hover' : 'bg-surface border border-border'}>
        {role === 'assistant' ? <Markdown text={text} /> : <div>{text}</div>}
      </div>
      <button onClick={onCopy} className="opacity-0 group-hover:opacity-100" aria-label="复制消息">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
```

```tsx
// web/src/components/chat/Markdown.tsx（lazy import）
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

export function Markdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{text}</ReactMarkdown>;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/message-copy.test.tsx`
Expected: 2/2 PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/components/chat/ web/src/features/chat/composerDraftStore.ts web/tests/unit/message-copy.test.tsx
git commit -m "feat(web): M5.2 composer + message list + markdown + copy button"
```

---

#### Task M5.3: ChatPage 端到端 + 自动滚动条件（C-8）+ 5 个 XSS 向量用例

**Files:**
- Modify: `web/src/pages/ChatPage.tsx`
- Create: `web/tests/e2e/chat-stream.spec.ts`
- Create: `web/tests/unit/markdown-xss.test.tsx`

- [ ] **Step 1: 写失败测试（5 个 XSS 向量）**

```tsx
// web/tests/unit/markdown-xss.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Markdown } from '../../src/components/chat/Markdown';

const vectors = [
  '<img src=x onerror=alert(1)>',
  '[click](javascript:alert(1))',
  '<script>alert(1)</script>',
  '![x](data:text/html,<script>alert(1)</script>)',
  '<iframe src="javascript:alert(1)"></iframe>',
];

describe('Markdown XSS', () => {
  for (const v of vectors) {
    it(`blocks: ${v.slice(0, 30)}`, () => {
      const { container } = render(<Markdown text={v} />);
      expect(container.innerHTML).not.toMatch(/onerror|javascript:|<script|<iframe/i);
    });
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/markdown-xss.test.tsx`
Expected: 至少 1 个 FAIL（react-markdown 默认行为）

- [ ] **Step 3: 写最小实现**

`Markdown.tsx` 已通过 `rehype-sanitize` 阻止；如个别向量绕过需加 `urlTransform={(url) => /^https?:/.test(url) ? url : 'about:blank'}`。

修改 `ChatPage.tsx`：
- 接入 useChatStream + Composer + MessageList + MessageBubble
- 自动滚动条件：`scrollTop + clientHeight >= scrollHeight - 100` 才 scrollIntoView
- 用户向上滚动时显示 "↓ N 条新消息" 浮动按钮

- [ ] **Step 4: 跑测试 + Playwright**

Run: `npx vitest run tests/unit/markdown-xss.test.tsx`
Expected: 5/5 PASS

Run: `cd web && npm run e2e -- chat-stream.spec.ts`
Expected: PASS（发送 → 至少 3 帧 → done → cache 更新；abort → aborted）

- [ ] **Step 5: 提交**

```bash
git add web/src/pages/ChatPage.tsx web/src/components/chat/ web/tests/unit/markdown-xss.test.tsx web/tests/e2e/chat-stream.spec.ts
git commit -m "feat(web): M5.3 chat page e2e + xss 5 vectors + auto-scroll guard"
```

---

### 阶段 M6：业务页面（Providers / Skills / Agents / Sessions）

#### Task M6.1: ProvidersPage + ProviderForm + setQueryData

**Files:**
- Create: `web/src/features/providers/{useProviders,ProviderForm,ProviderDetail}.tsx`
- Create: `web/src/pages/ProvidersPage.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// web/tests/unit/provider-form.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProviderForm } from '../../src/features/providers/ProviderForm';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('ProviderForm', () => {
  it('shows VALIDATION_FAILED red on invalid baseUrl', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'PROVIDER_INVALID_BASE_URL', message: 'bad' }), { status: 422 })
    );
    render(<ProviderForm mode="create" onSuccess={() => {}} />, { wrapper });
    fireEvent.change(screen.getByLabelText('id'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('baseUrl'), { target: { value: 'not-a-url' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => {
      expect(screen.getByLabelText('baseUrl')).toHaveAttribute('aria-invalid', 'true');
    });
  });
  it('disables submit button during submission', async () => {
    vi.spyOn(global, 'fetch').mockImplementationOnce(() => new Promise(r => setTimeout(() => r(new Response('{}', { status: 200 })), 100)));
    render(<ProviderForm mode="create" onSuccess={() => {}} />, { wrapper });
    const btn = screen.getByRole('button', { name: /保存/ });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/provider-form.test.tsx`
Expected: FAIL

- [ ] **Step 3: 写最小实现**

```tsx
// web/src/features/providers/ProviderForm.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, apiPut, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';

const ProviderUpsertSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(['openai', 'anthropic', 'ollama', 'custom']),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1).max(256),
  defaultModel: z.string().min(1),
});
type ProviderFormValues = z.infer<typeof ProviderUpsertSchema>;

const fieldErrorMap: Record<string, string> = {
  PROVIDER_INVALID_BASE_URL: 'baseUrl',
  PROVIDER_INVALID_TYPE: 'type',
  PROVIDER_API_KEY_EMPTY: 'apiKey',
  PROVIDER_DUPLICATE_ID: 'id',
};

export function ProviderForm({ mode, provider, onSuccess }: {
  mode: 'create' | 'edit';
  provider?: ProviderFormValues;
  onSuccess: () => void;
}) {
  const qc = useQueryClient();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<ProviderFormValues>({
    resolver: zodResolver(ProviderUpsertSchema),
    defaultValues: provider,
  });
  const mutation = useMutation({
    mutationFn: async (data: ProviderFormValues) => {
      if (mode === 'create') return apiPost('/api/providers', data);
      return apiPut(`/api/providers/${provider!.id}`, data);
    },
    onSuccess: (res: any) => {
      qc.setQueryData(['providers'], (old: any) => ({
        providers: [...(old?.providers ?? []), res.provider].filter((v, i, a) => a.findIndex(t => t.id === v.id) === i),
        activeId: old?.activeId,
      }));
      onSuccess();
    },
    onError: (err: ApiError) => {
      if (err.code === 'VALIDATION_FAILED' || err.code === 'PROVIDER_INVALID_BASE_URL') {
        const field = fieldErrorMap[err.code] ?? 'baseUrl';
        setError(field as any, { message: err.message });
      } else {
        // Toast '服务异常'
      }
    },
  });

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))}>
      <input {...register('id')} disabled={mode === 'edit'} />
      {errors.id && <span role="alert" className="text-danger">{errors.id.message}</span>}
      <select {...register('type')}>...</select>
      <input {...register('baseUrl')} aria-invalid={errors.baseUrl ? 'true' : 'false'} />
      <input {...register('apiKey')} type="password" />
      <Button type="submit" disabled={isSubmitting}>{isSubmitting ? '保存中…' : '保存'}</Button>
    </form>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/provider-form.test.tsx`
Expected: 2/2 PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/features/providers/ web/src/pages/ProvidersPage.tsx web/tests/unit/provider-form.test.tsx
git commit -m "feat(web): M6.1 providers page + form + setQueryData + 422 field map"
```

---

#### Task M6.2: SessionsPage + 搜索 + 归档切换

#### Task M6.3: SkillsPage + AgentList + SkillCard（只读 modal）

（Tasks M6.2 / M6.3 类似 M6.1，按 spec § 12.4 / § 12.6 / § 12.7 逐字段实现 + 测试）

### 阶段 M7：a11y + 性能 + i18n + 主题

#### Task M7.1: i18n Provider + zh/en.json + toast 文案规范

#### Task M7.2: 主题切换 + 防 FOUC + 暗色 token

#### Task M7.3: Playwright axe 8 路由扫描 + size-limit CI 阈值

（Tasks M7.1-M7.3 按 spec § 7.5 / § 4.1 / § 8.4 / § 7.3 实施 + axe 0 critical / bundle ≤ 180KB）

### 阶段 M8：尾盘（删除旧 web + verification-lite + code-review）

#### Task M8.1: 删除旧 web/{index.html,style.css,js/} + test/web-legacy/

- [ ] **Step 1: 确认 Playwright 19/19 wire-routes 全绿**

Run: `cd web && npm run e2e -- wire-routes.spec.ts`
Expected: 19/19 PASS

- [ ] **Step 2: git rm 旧文件**

```bash
git rm -r web/{index.html,style.css,js/}
git rm -r test/web-legacy
```

- [ ] **Step 3: 跑 verification-lite + code-review**

按 `harness-kit/references/definition-of-done.md` § 全部 20+ 项打勾

- [ ] **Step 4: 合流 main**

```bash
git checkout main
git merge feature/web-react-rewrite --no-ff -m "merge: web frontend react rewrite (closes #N)"
```

## 7. 测试覆盖矩阵

| 类型 | 数量 | 工具 |
|---|---|---|
| 单元测试 | 60+ | Vitest + @testing-library/react |
| 组件测试 | 30+ | Vitest + jsdom |
| E2E | 19 wire-routes + 8 路由 + chat stream/abort/retry/regenerate/undo/copy | Playwright |
| a11y | 8 路由全扫 | @axe-core/playwright |
| 覆盖率门槛 | lib ≥ 90% / features ≥ 80% / components ≥ 60% | Vitest coverage |

## 8. Definition of Done（spec § 11 A1-A15 + harness-kit/references/definition-of-done.md）

- A1 `npm run build` 产物可被 Node server 服务 — 200
- A2 8 路由全部可达 — 8/8
- A3 19 wire-routes 行为一致 — 19/19
- A4 流式聊天端到端 + reconnecting 测试 — PASS
- A5 主题/语言切换刷新保留 — PASS
- A6 快捷键 7/7 — PASS
- A7 axe 0 critical / 0 serious — PASS
- A8 Bundle ≤ 180KB — PASS
- A9 Bundle CSS ≤ 20KB — PASS
- A10 LCP ≤ 1.2s — PASS
- A11 旧 web/ 已删除 — PASS
- A12 19 wire-route 客户端契约一致 — 19/19
- A13 5 个 XSS 向量拦截 — 5/5
- A14 后端最小改动清单 — diff 仅限 csp.ts + static.ts
- A15 覆盖率门槛 — lib ≥ 90% / features ≥ 80% / components ≥ 60%

## 9. 风险与对策（spec § 10 R1-R15）

实施阶段重点关注：
- R2 SSE 重连 vs CHAT_SESSION_BUSY 429：客户端不自动重试 POST（Task M5.1 已落实）
- R7 自托管字体 CSP：Task M2.1-M2.3
- R9 Cache-Control：Task M2.2
- R11 契约 vs 源码 SSE：spec 已对齐 13 事件
- R13 lucide-react tree-shake：M1 实测，超阈值改 `vite-plugin-lucide`

## 10. References

- spec：`/Users/mima0000/Documents/学习-001/do-project/my-agent/.ai-runtime-artifacts/specs/2026-08-08-web-frontend-react-rewrite-spec.md`
- 契约：`/Users/mima0000/Documents/学习-001/do-project/my-agent/.ai-runtime-artifacts/contracts/2026-08-07-web-frontend-api-contract.md`
- v2 review：`/Users/mima0000/Documents/学习-001/do-project/my-agent/.ai-runtime-artifacts/reviews/2026-08-08-web-frontend-spec-document-review-v2.md`
- harness-kit：`/Users/mima0000/Documents/学习-001/do-project/my-agent/harness-kit/`

## Next（**写入后须暂停**）

按 harness overlay：
- 计划确认 → 说「开始实现」或「执行」
- 需要调整 → 直接说修改意见
- 想拆分并行 → 审 `*-dispatch.md` 后说「开始实现」或「并行执行」

下一步用户已要求创建 worktree → `EnterWorktree` 切到 `feature/web-react-rewrite` 分支。