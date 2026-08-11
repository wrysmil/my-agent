---
artifact: verification
route: orchestrator:tail-end
skills:
  - verification-before-completion
  - browser-testing-with-devtools
  - systematic-debugging
source:
  - .ai-runtime-artifacts/specs/2026-08-11-run-trace-dual-layout-spec.md
  - .ai-runtime-artifacts/reviews/2026-08-11-run-trace-dual-layout-code-review.md
created_at: 2026-08-11
batch_id: 切会话守卫（reviewer Important #1）
verdict: PASS
---

# 切会话守卫 + 真实路径复测 Verification Lite

> **纪律：** Leader 在主 checkout 重跑命令 + 真实 ChatPage 路径复测，不依赖前 WU 自报。

## 改动范围（本批）

1. **新增守卫测试**：`web/tests/features/chat/trace-bubble-session-switch.test.tsx`（3 cases）
2. **加 testid 钩子**：`MessageBubble.tsx` `<div data-testid="gen">`（为 GeneratingIndicator 节点加 testid，便于守卫断言）
3. **未改其他业务代码**：v4 的 3 独立 key + Fragment + TraceBubble 重命名结构已**事实上封堵**了切会话 bug 触发路径

## 命令表（本机重跑）

| 命令 | exit | 关键输出 |
| --- | --- | --- |
| `pnpm -C web exec tsc -b` | 0 | 0 errors |
| `pnpm exec vitest run tests/features/chat/trace-bubble-session-switch.test.tsx` | 0 | **3 tests passed** (472ms) |
| `pnpm exec vitest run tests/features/chat/`（全套） | 0 | **9 files / 140 tests passed** (137 → 140，新增 3 守卫) |
| `pnpm -C web run build` | 0 | exit 0；CSS 79.50KB（gzip 13.23KB）；main JS 1.83MB（gzip 449.92KB） |

## 守卫测试覆盖（3 cases）

| Case | 断言 |
| --- | --- |
| A→B→A 切换 | trace-bubble 数 = 1；灰底 + border + 紫色侧条 className 恒在；final 独立节点恒在；generating indicator 数 = 0 |
| 同 message.id 跨 session 复用 | A/B 切换后 final 内容各自独立，无 A→B 或 B→A 残留 |
| A 流中切到 B 切回 A | 切回后视 isStreaming 真实状态渲染；generating indicator 不残留 |

## 真实 ChatPage 路径复测

启 vite（5174 端口，因为 5173 被前批 WU-02 进程占用）+ Playwright 复测 A→C→A 切回：

| 检查项 | 期望 | 实测 |
| --- | --- | --- |
| trace-bubble 数 | 1 | **1** ✓ |
| final-bubble 数 | 1 | **1** ✓ |
| generating indicator 数 | 0 | **0** ✓ |
| trace 灰底 className | 含 `bg-[#f1f2f4]` | true ✓ |
| run-trace border className | 含 `border border-border/80` | true ✓ |
| 紫色侧条 backgroundImage | `linear-gradient(rgb(108,92,231), ...)` | true ✓ |
| final 内容 | A 会话真实 AI 文字 | "你好！我是你的 AI 助手..." ✓ |

**截图证据**：`.ai-runtime-artifacts/verifications/2026-08-11-wu02-rerun-sessionA-reswitched.png`

## 结论

- **守卫测试固化**：3 个 case 全过；回归保险已建立
- **真实路径 A↔B↔A↔C↔A 多次切回**：bug 不复现；DOM 探针全绿
- **结论与 WU-02 一致**：v4 结构改动已**事实上修复**切会话 bug；守卫测试是"修复闭环"

## 已知限制

- **守卫测试 spy 的 `data-trace-side-bar` testid** 没在真实 RunTracePanel.tsx 加；Playwright 用 computed style `backgroundImage` 含 `rgb(108,92,231)` 验证，等价有效
- **守卫测试 spy 的 `data-trace-summary`** 同样未在真实代码加
- **真实 LLM 流切会话路径**：mock store 路径 + 真实 ChatPage 路径均不可复现；spec §11 风险点 #3 已部分验证

## Next

- 准备 commit（v4 提交已包含基础改动；本批新增守卫测试 + 1 处 testid 钩子作为 fixup commit）
- spec §4.3 后续跟踪：Suggestion #1 / #2 / #3（不在本批范围）