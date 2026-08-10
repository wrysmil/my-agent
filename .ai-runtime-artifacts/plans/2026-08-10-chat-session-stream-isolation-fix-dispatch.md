---
artifact: implementation-dispatch
route: orchestration:dispatcher-workflow
source:
  - .ai-runtime-artifacts/specs/2026-08-10-chat-session-stream-isolation-spec.md
  - .ai-runtime-artifacts/plans/2026-08-10-chat-session-stream-isolation-plan.md
  - 用户实现授权：「可以的」
created_at: 2026-08-10
status: in_progress
---

# Chat 会话流隔离修复 Dispatch

## 执行图

GROUP-1（并行）：

- WU-01：贯通 route → runner → persistence 的 run/message 身份；修复终态事件与后端测试。  
  文件：`src/agent/types.ts`、`src/agent/runner.ts`、`src/web/server/routes/messages.ts`、相关后端测试。  
  依赖：无。`wu_type: bugfix`，`agent_role: debugger`。
- WU-02：修复 history/overlay 收敛、placeholder 顺序、run 生命周期和跨会话 ref；补 A→B→A 前端回归测试。  
  文件：`web/src/features/chat/useChatStream.ts`、`web/src/features/chat/chatRuntimeStore.ts`、相关前端测试。  
  依赖：现有 P0 envelope。`wu_type: ui-bug`，`agent_role: debugger`。

## Done Criteria

- 前端生成的 runId/clientMessageId 与 Runner 持久化 history 一致。
- SSE assistantMessageId 与最终 JSONL assistant id 一致。
- A streaming → B → A 不删除 partial assistant，不丢后续 rAF token。
- history 只在 persisted revision/ID 足够新时替换 overlay。
- done/error/aborted 清理 activeRunId、controller、timer/ref，不污染其他会话。
- 新增测试在修复前失败、修复后通过；现有相关测试同步到新协议。

## GROUP 收尾

集体测试 → 独立代码审查 + 安全审查 → Leader 落盘 closeout 产物。
