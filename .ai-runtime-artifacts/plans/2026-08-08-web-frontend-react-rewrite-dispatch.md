---
artifact: dispatch
route: orchestration
source_plan: .ai-runtime-artifacts/plans/2026-08-08-web-frontend-react-rewrite-plan.md
created_at: 2026-08-08
status: in_progress
tier: 2
worktree: feature/web-react-rewrite
---

# my-agent Web 前端 React 重写 — 调度执行图

> 来源 plan：`2026-08-08-web-frontend-react-rewrite-plan.md`（M1-M8 八阶段）
> 执行策略：Leader 直做基础 GROUP（无并行收益），后续 GROUP 按文件不相交原则并行派发 coder。

## 执行图

```
GROUP-1（Leader 直做，顺序）—— 无并行收益，全项目基石:
  WU-01: M1.1 Vite+React+TS 脚手架 + cn utility
         | 文件: web/package.json, vite.config.ts, tsconfig.json, index.html,
         |       vitest.config.ts, src/main.tsx, src/App.tsx, src/lib/cn.ts,
         |       src/test-setup.ts, tests/unit/cn.test.ts
         | 依赖: 无
  WU-02: M1.2 Tailwind v4 + shadcn Button（手拷）
         | 文件: web/postcss.config.js, src/styles/globals.css, src/styles/tokens.ts,
         |       src/components/ui/button.tsx, tests/unit/button.test.tsx
         | 依赖: WU-01

GROUP-2（Leader 直做，部分并行但文件少）:
  WU-03: M2.1 csp.ts font-src 'self'
         | 文件: src/web/server/csp.ts, web/tests/unit/csp-font-src.test.ts
         | 依赖: 无（改后端文件）
  WU-04: M2.2 static.ts ALLOWED_EXTS + cache-control hash split
         | 文件: src/web/server/static.ts, web/tests/unit/static-ext.test.ts
         | 依赖: 无（改后端文件，与 WU-03 文件不相交）
  WU-05: M2.3 自托管 woff2 + @font-face
         | 文件: web/public/fonts/*.woff2, src/styles/globals.css,
         |       tests/unit/font-face.test.ts
         | 依赖: WU-01（需 web/ 就绪）、WU-03（CSP 验证）
  WU-06: M3.1 路由表 + 8 page 空壳 + HashRouter
         | 文件: web/src/routes.tsx, src/pages/*.tsx, src/App.tsx,
         |       tests/unit/routes-table.test.ts
         | 依赖: WU-01
  WU-07: M3.2 AppShell + Sidebar + Topbar 静态版
         | 文件: web/src/components/layout/*.tsx, src/hooks/useTheme.ts,
         |       src/hooks/useKeyMap.ts, src/lib/keymap.ts,
         |       tests/unit/app-shell.test.tsx
         | 依赖: WU-06（需路由就绪）

GROUP-3（Leader 直做，2 WU 文件不相交可并行但量小）:
  WU-08: M4.1 api.ts + Zod + 27 错误码 + QueryClient
         | 文件: web/src/lib/{api,error,query-keys}.ts, src/main.tsx,
         |       tests/unit/api.test.ts
         | 依赖: WU-01
  WU-09: M4.2 sse.ts fetch+ReadableStream 13 事件解析
         | 文件: web/src/lib/sse.ts, tests/unit/sse.test.ts
         | 依赖: WU-01

GROUP-4（Leader 直做，顺序依赖强）:
  WU-10: M5.1 useChatStream 7 态状态机
         | 文件: web/src/features/chat/useChatStream.ts, tests/unit/chat-stream-state.test.ts
         | 依赖: WU-08, WU-09
  WU-11: M5.2 Composer + MessageList + Markdown + MessageBubble copy
         | 文件: web/src/components/chat/*.tsx, features/chat/composerDraftStore.ts,
         |       tests/unit/message-copy.test.tsx
         | 依赖: WU-10
  WU-12: M5.3 ChatPage e2e + XSS 5 vectors + auto-scroll
         | 文件: web/src/pages/ChatPage.tsx, tests/unit/markdown-xss.test.tsx,
         |       tests/e2e/chat-stream.spec.ts
         | 依赖: WU-11

GROUP-5（并行派发 coder × 3）:
  WU-13: M6.1 ProvidersPage + ProviderForm + setQueryData
         | 文件: web/src/features/providers/*.tsx, pages/ProvidersPage.tsx,
         |       tests/unit/provider-form.test.tsx
         | 依赖: WU-06, WU-08
  WU-14: M6.2 SessionsPage + 搜索 + 归档切换
         | 文件: web/src/features/sessions/*.tsx, pages/SessionsPage.tsx,
         |       tests/unit/sessions-page.test.tsx
         | 依赖: WU-06, WU-08
  WU-15: M6.3 SkillsPage + AgentList + SkillCard
         | 文件: web/src/features/skills/*.tsx, features/agents/*.tsx,
         |       pages/{Skills,Agents}Page.tsx, tests/unit/skills-agents.test.tsx
         | 依赖: WU-06, WU-08

GROUP-6（并行派发 coder × 3）:
  WU-16: M7.1 i18n Provider + zh/en.json + toast 文案
         | 文件: web/src/i18n/*.json, src/lib/i18n.ts, tests/unit/i18n.test.ts
         | 依赖: WU-11, WU-13, WU-14, WU-15
  WU-17: M7.2 主题切换 + 防 FOUC + 暗色 token
         | 文件: web/src/features/ui/*.ts, src/styles/globals.css,
         |       tests/unit/theme.test.ts
         | 依赖: WU-07
  WU-18: M7.3 Playwright axe 8 路由扫描 + size-limit CI
         | 文件: web/playwright.config.ts, tests/e2e/a11y.spec.ts,
         |       web/.size-limit.json, tests/unit/bundle.test.ts
         | 依赖: WU-12, WU-13, WU-14, WU-15

GROUP-7（Leader 直做，尾盘）:
  WU-19: M8.1 删除旧 web + verification-lite + code-review + 合流
         | 文件: web/{index.html,style.css,js/*}（删除）, test/web-legacy（删除）
         | 依赖: 全部 GROUP
```

## 执行策略

| GROUP | 策略 | 原因 |
|-------|------|------|
| GROUP-1 | Leader 直做 | 基石，后续全依赖 |
| GROUP-2 | Leader 直做 | 文件少，后端+前端联动紧 |
| GROUP-3 | Leader 直做 | 2 WU 量小 |
| GROUP-4 | Leader 直做 | 顺序依赖链紧 |
| GROUP-5 | 并行 coder × 3 | 文件不相交，独立 feature |
| GROUP-6 | 并行 coder × 3 | 文件不相交，独立关注点 |
| GROUP-7 | Leader 直做 | 尾盘门禁不可委派 |

## 委派约束

- WU-13/14/15 coder 派发：包含 spec 对应章节 + api 契约 + 完整文件清单
- WU-16/17/18 coder 派发：包含 i18n/主题/性能 spec 章节
- 所有 coder prompt 含 `### Skills 使用` 返回要求
- cwd = worktree_path

## Next

写 dispatch 后 → EnterWorktree → 开始 GROUP-1 实现
