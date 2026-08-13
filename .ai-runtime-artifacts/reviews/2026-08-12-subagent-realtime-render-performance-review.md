---
artifact: review
route: orchestration:dispatcher-workflow -> batch-closeout
skills:
  - requesting-code-review
  - performance-optimization
skills_evidence:
  - .agents/skills/requesting-code-review/SKILL.md
  - .agents/skills/performance-optimization/SKILL.md
source:
  - .ai-runtime-artifacts/plans/2026-08-12-subagent-realtime-render-plan.md
  - harness-kit/references/performance-checklist.md
created_at: 2026-08-12
batch_id: subagent-realtime-render
worktree_id:
worktree_path:
reviewer_instance: perf-auditor
verdict: APPROVE
---

# 子 Agent 实时渲染 — 性能审查

> **写入者：** Leader（收到 perf-auditor 返回后落盘）。Auditor 为 readonly，不 Write 本文件。

## 审查范围

- 批次 `subagent-realtime-render` 4 个 WU 变更文件（WU-01 后端 SSE 事件源 / WU-02 前端 SSE 路由 + 状态机 / WU-03 MessageBubble / WU-04 History 重建 + merge）
- 审查方式：静态源码分析（无 Lighthouse / CrUX / trace 数据），Metric-Honesty 遵守

## Scorecard

| Metric | Value | Source | Target | Status |
|--------|-------|--------|--------|--------|
| LCP | not measured | static analysis | ≤ 2.5s | - |
| INP | not measured | static analysis | ≤ 200ms | - |
| CLS | not measured | static analysis | ≤ 0.1 | - |

> Stack: React 18 + Vite（前端），Node HTTP + SSE（后端），Zustand 5。Artifacts: none — source analysis only。

## Findings

### Critical

- 无（无实测数据支撑 CWV 直接失败判定）

### High

1. **`worker_text_delta` 绕过 rAF 文本缓冲，逐事件全量 setState**（`web/src/features/chat/useChatStream.ts:1527-1539` handler；事件源 `src/orchestration/dispatch.ts:133-142`、`bin/my-agent-web.ts:202-210`）
   - 主 Agent 文本走 `store.appendTextBuffer`（rAF 每帧一次 setState），worker 路径对**每个** `worker_text_delta` 直接 `updateMessages` → 字符串拼接 + `[...messages]` 拷贝 + setState。SSE 事件在独立微任务中逐个处理，React 18 自动批处理无法跨事件合并 → 每帧多次全量渲染。
   - Impact: 潜在 INP 恶化 + O(n²) 字符串累积。热路径上唯一未节流的 setState 来源，节流基建（per-run rAF buffer）已存在未复用。
   - Recommendation: 复用 `appendTextBuffer`/`flushTextBuffer` 机制，为 agent 文本追加引入独立 rAF 缓冲槽（key `runId + actorId`）。

2. **AgentBubble 每个 delta 全量 Markdown 重解析**（`web/src/components/chat/MessageBubble.tsx:290-299` `<Markdown text={textContent} />`；`web/src/components/chat/Markdown.tsx` react-markdown + remarkGfm + rehype-sanitize + rehype-highlight）
   - `textContent` 为累积全文，无 memo/防抖；每个未节流 delta 都触发全量 markdown 解析、sanitize、高亮。
   - Impact: 潜在长任务（>50ms），与 High-1 叠加为主渲染开销。
   - Recommendation: 流式期间（`working`）渲染纯文本 `whitespace-pre-wrap`，`done` 后切 `<Markdown>`。

### Medium

3. **MessageBubble 未 memo，每个 SSE 事件重渲染整条消息列表**（`MessageList.tsx:92-104`、`MessageBubble.tsx:33-145`）— 非本批引入，worker 事件流放大 N×事件数 reconciliation 成本。建议 `React.memo(MessageBubble)`。
4. **`mergePersistedWithOverlay` 多次线性 findIndex，最坏 O(P×R)**（`useChatStream.ts:435-570`、`insertPersistedOnlyAtAnchor`、`rebuildDispatchAgentMessages`）— **仅冷路径**（history 加载 + run done 后 refetch），不在 SSE 热路径；消息量小时影响有限。建议 Map 索引化。

### Low

5. 后端每个 worker 文本 delta 独立 SSE 帧带完整 envelope 开销（随 High-1 一并处理）
6. bundle 增长 + MessageBubble 从 useChatStream 导入纯函数（`buildAgentSummary`/`messageText`）拖入大型 hook 模块进 chunk（建议纯函数下沉独立模块）
7. AgentBubble 每个实例内联注入重复 `<style>` 标签（`MessageBubble.tsx:151-166,301`，建议移入全局样式）

### Positive Observations

- 主 Agent 文本流已正确使用 per-run rAF 缓冲，节流基座完善
- `updateMessages`/`updateAssistantForRun`/`updateAgentForActor` 有 no-op 保护
- SSE envelope 身份校验 + seq 去重，过期/重复事件静默丢弃
- Zustand selector 工厂化 + useMemo 缓存
- `worker_step_start/end` 用 stepId 精确配对；`buildAgentSummary` 仅在块变更时重建
- History 重建/合并全部位于冷路径；`run_worker` 不 emit dispatch 事件避免无效事件量
- `<Markdown>` React.lazy 分包加载

## 证据

- perf-auditor 已读：`useChatStream.ts`（appendTextBuffer/flushTextBuffer 对比、worker_text_delta handler、merge 各函数）、`MessageBubble.tsx`、`Markdown.tsx`、`MessageList.tsx`、`dispatch.ts`/`tools.ts`/`my-agent-web.ts`/`messages.ts` 事件源
- 全部标注 `Source: static analysis`，未编造 CWV 数值

## 未验证项

- 无真实浏览器 trace / Lighthouse 数据（INP/LCP/CLS 未测量）
- High-1/High-2 的实际渲染开销幅度未量化

## 结论

**verdict:** APPROVE（无 Critical；High-1/High-2 建议合并前处理）

## Next

- High-1/High-2 是否开 review-fix：待 Reviewer 五轴审查返回后统一决策（避免同批文件重复修改）
- APPROVE → 可合并/提测；更新 execution-log
