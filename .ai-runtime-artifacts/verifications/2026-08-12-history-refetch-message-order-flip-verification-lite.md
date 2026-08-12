---
status: verified
approved: true
task: History refetch 消息顺序颠倒修复（mergePersistedWithOverlay 方案 B + invalidate 收紧）
date: 2026-08-12
tier: 1
spec: .ai-runtime-artifacts/specs/2026-08-12-history-refetch-message-order-flip-spec.md
plan: .ai-runtime-artifacts/plans/2026-08-12-history-refetch-message-order-flip-plan.md
---

# Verification Lite — History Refetch 消息顺序颠倒修复

## 根因（spec §4.1）

`mergePersistedWithOverlay` 旧算法以 persisted（后端 history 快照）为基底，遍历 overlay 时对
identity / runId 都不命中的条目执行 splice 兜底。**当 overlay 中排在首位的 user 消息在 persisted
中不存在（write-through 滞后，user 行尚未落盘）时，向前扫描锚点落空 → insertAt 退回
`result.length` → user 被插到消息列表末尾，排到 assistant 后面。**

触发链路：SSE `done` / `aborted` / `error` → `finishRun` → `ChatPage` useEffect
`invalidateQueries(['sessions'])`（前缀匹配所有 `['sessions', ...]` 子键）→ history refetch →
再次调用 merge → 顺序颠倒在「自动刷新」后可见。

## 修复点

### 1. `mergePersistedWithOverlay` 方案 B（`web/src/features/chat/useChatStream.ts`）

- **骨架反转**：`result = [...overlay]`，以流式顺序为骨架，杜绝 overlay 顺序被 persisted 拖走。
- **匹配就地 merge**：identity 匹配 → merge；assistant 按 runId 二次匹配（保留上一批
  duplicate trace bubble fix 语义）→ merge；**user 按 runId 双身份去重**（同一次发送的 user
  在 overlay / persisted 两侧 identity 可能因 messageId/clientMessageId 时序不同而不一致）。
- **persisted 独有条目锚点插入**：找 persisted 中「下一个已存在锚点」插到其前、或「上一个已
  存在锚点」插到其后；都找不到才 append（极端场景兜底）。
- merge 的 overlay-wins / persisted-wins revision 语义与 `mergeAssistantTextFromOverlay`
  （保留更长 final text）保持不变。

### 2. invalidate 范围收紧（`query-keys.ts` + `ChatPage.tsx` + `useSessions.ts`）

- `queryKeys.sessions.list`（`['sessions', 'list']`）新增，由 `useSessions` / 侧边栏唯一消费。
- `ChatPage` 两处 invalidate 从 `sessions.all` 改为 `sessions.list`，避免前缀匹配波及
  `['sessions', id, 'history']` 等子键（防止 history 迁 React Query 后强制重拉再触发 merge）。
- `useSessions` 的 queryKey 与 invalidate 同步改用 `sessions.list`。

## 验证命令 + 结果

```powershell
Set-Location "d:\studyspace\project\my-agent"
pnpm -C web exec tsc -b
pnpm -C web exec vitest run tests/features/chat/
```

| 检查项 | 结果 |
|--------|------|
| `pnpm -C web exec tsc -b` | **0 errors** |
| 新增 `merge-persisted-with-overlay.test.tsx`（7 用例） | **7/7 PASS** |
| chat 全目录 | **10 文件 / 150 tests 全绿** |
| TDD RED（实现前） | #1/#2（user 被排到 assistant 后）+ #7（invalidate 未用 list）FAIL，其余回归 PASS |
| TDD GREEN（方案 B + invalidate 收紧后） | 7/7 PASS |

## 回归覆盖

- `chat-session-stream-isolation.test.tsx`（25）— 流隔离 / 去重 / 收敛回归全绿。
- `trace-bubble-session-switch.test.tsx`（4）— 切会话重复气泡守卫全绿。
- `message-bubble-cycle` / `run-trace-panel*` / `generating-indicator` / `trace-bubble` — 渲染回归全绿。

## 手动复测建议

1. 新建会话，发一条触发多步工具调用的复杂问题。
2. 等 AI 完成（done）后等 ≥ 3 秒（invalidate / refetch 窗口）。
3. 断言：user 气泡在 AI 完整回复**上方**。
4. 切 B 会话再切回 A，重复 3 次：顺序始终稳定，同 run 仍只有 1 个 trace bubble。

## References 检查

### `harness-kit/references/definition-of-done.md`

| 检查项 | 结论 |
|--------|------|
| 验收标准满足（done 后 user 不再排到 assistant 后） | pass（用例 #1/#2 回归固化） |
| 代码运行/行为经运行时验证 | pass（vitest 150 tests + RED/GREEN 实测） |
| 新行为有「无改动则失败」的测试 | pass（TDD RED 阶段 3 fail 已记录） |
| 既有测试无回归 | pass（chat 全目录 150/150） |
| 边界/错误路径覆盖 | pass（#5 孤立条目兜底、#6 mixed、#4 persisted-only 插入） |
| 命名与结构表达意图 | pass（overlay 骨架 + 锚点插入，无 what 注释） |
| 无重复业务逻辑 / 死代码 | pass（runId 去重逻辑复用 mergeAssistantForSameRun） |
| 变更范围限定在任务 | pass（仅 merge 函数 + query keys + 2 个消费点） |
| 与系统其余部分集成 | pass（runId/messageId/clientMessageId 契约未变，SSE 协议未动） |
| 公开接口向后兼容 | pass（mergePersistedWithOverlay 签名未变） |
| 文档 | pass（本 verification-lite + spec/plan 已落盘） |

### `harness-kit/references/testing-patterns.md`

| 检查项 | 结论 |
|--------|------|
| AAA 结构 | pass（7 用例均 Arrange/Act/Assert 注释分段） |
| 命名表达行为 | pass（如 `user message stays before its assistant when persisted lacks the user row`） |
| Mock 最小化 / 边界处 Mock | pass（前 6 用例直调 `mergePersistedWithOverlay` 零 mock；仅 #7 ChatPage 组件测试 mock useChatStream 与纯 UI 子组件） |
| 反模式规避 | pass（无测试实现细节、无 snapshot、无 test.skip；异步用例均 await waitFor） |

## Next

- 本批为 Tier 1 Leader 直做，已落盘 verification-lite。若需提交 / 分支 / MR，由 Leader 按 `git-xywh` 执行。
