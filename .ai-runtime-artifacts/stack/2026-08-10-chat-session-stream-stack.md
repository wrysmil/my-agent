---
artifact: stack-detection
route: source-driven-development
skills:
  - source-driven-development
skills_evidence:
  - .agents/skills/source-driven-development/SKILL.md
source:
  - package.json
  - web/package.json
created_at: 2026-08-10
---

# Chat 会话流修复技术栈

- 前端：React 19.1.0、React DOM 19.1.0、React Router DOM 7.18.2
- 服务端状态缓存：TanStack React Query 5.101.4
- 本地 UI 状态：Zustand 5.0.14
- 构建：Vite 6.3.0、TypeScript 5.7.0
- 测试：Vitest 2.1.0、Testing Library React 16.0.0、Playwright 1.62.1
- 后端运行时：Node.js ESM、TypeScript 5.7.0

## 本次相关官方资料

- React Effect 生命周期：https://react.dev/reference/react/useEffect
- React state 保留与 key 重置：https://react.dev/learn/preserving-and-resetting-state
- TanStack Query 唯一 query key：https://tanstack.com/query/v5/docs/framework/react/guides/query-keys

## 约束结论

- React 会在组件处于相同树位置时保留 state；路由参数变化不等于组件必然卸载。
- Effect 的 setup 使用新依赖值，cleanup 才持有旧依赖值，不能在新 effect 中假定 `sessionId` 仍是旧会话。
- 任何按会话缓存的数据都必须以稳定 `sessionId` 为 key；运行流还需额外以 `streamId` 或 `runId` 隔离。
