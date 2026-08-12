---
artifact: spec
route: superpowers:brainstorming -> systematic-debugging
skills:
  - brainstorming
  - systematic-debugging
  - source-driven-development
skills_evidence:
  - skipped: brainstorming (not found at .agents/skills/)
  - systematic-debugging@harness-kit/.agents/skills/systematic-debugging/SKILL.md
  - source-driven-development@harness-kit/.agents/skills/source-driven-development/SKILL.md
source:
  - harness-kit/core/routing.md
  - harness-kit/core/artifacts.md
  - .ai-runtime-artifacts/specs/2026-08-11-run-trace-dual-layout-spec.md
  - .ai-runtime-artifacts/specs/2026-08-11-message-cycle-grouping-spec.md
  - .ai-runtime-artifacts/verifications/2026-08-12-duplicate-trace-bubble-fix-verification-lite.md
  - web/src/features/chat/useChatStream.ts (mergePersistedWithOverlay, applySessionHistory)
  - web/src/features/chat/chatRuntimeStore.ts (applySessionHistory, updateMessages)
  - web/src/pages/ChatPage.tsx (useEffect on status → invalidateQueries)
  - web/src/lib/query-keys.ts (sessions.all = ['sessions'])
created_at: 2026-08-12
status: draft
approved: false
---

# Chat — History Refetch 把 user message 排到 assistant 后面（消息顺序颠倒）

## 1. 背景

用户在浏览器实测发现：在同一会话里发一条问题 → AI 完整回复完 → **"过一会自动刷新了一下"** → 整页布局看似没变，但**用户气泡跑到了 AI 完整回复的下面**（即 AI 在上、user 在下）。截图存于本会话上下文。

这与 `2026-08-12-duplicate-trace-bubble-fix-verification-lite.md` 修复的「同 run 多 trace bubble」是**同一个 merge 函数**（`mergePersistedWithOverlay`）的**另一种 bug**——上次只解决了"重复"，没有解决"顺序"。

### 1.1 与已有产物的关系

| 产物 | 关系 |
|---|---|
| `2026-08-11-run-trace-dual-layout-spec.md` | 双布局设计意图（trace 灰气泡 + final 裸内容）**没问题**；颠倒发生在数据层，不是 DOM 层 |
| `2026-08-11-message-cycle-grouping-spec.md` | GeneratingIndicator 位置（final 之后）也**没问题**；颠倒与 indicator 无关 |
| `2026-08-12-duplicate-trace-bubble-fix-verification-lite.md` | 上次修复加的「runId 二次去重」**正是本次 bug 的元凶**——见 §4 根因 |

## 2. 目标

1. **核心**：done / aborted / error 后 history refetch 把 user message 排到 assistant 后面的 bug 彻底修复，回归测试覆盖。
2. **次要（合并做）**：收紧 `ChatPage` 的 `queryClient.invalidateQueries` 范围（不污染其他 `['sessions', ...]` 前缀的 query）。
3. **不引入**：不重排 assistant 消息内部结构（trace → final → indicator 是设计意图，保留）。

## 3. 非目标

- 不重写整个 chat store / useChatStream（避免大爆炸）。
- 不改 SSE 协议 / `runId` / `messageId` / `clientMessageId` 身份契约。
- 不动 `MessageBubble.tsx` / `MessageList.tsx` 的渲染逻辑（颠倒发生在数据层）。
- 不优化 history refetch 的频次（已通过 `persistedRevision` 收敛保护）。

## 4. 设计

### 4.1 根因（systematic-debugging Phase 1-3 结论）

**触发链路**：

```
SSE case 'done' / 'aborted' / 'error' 分支
  → finishRun('succeeded', 'done') / ('aborted', 'aborted') / ('failed', 'error')
  → 触发 ChatPage.tsx:86-90 useEffect:
       queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
     （queryKeys.sessions.all = ['sessions']，前缀匹配所有 ['sessions', *]）
  → useChatStream done / dedup 分支内已并发触发:
       apiGet('/api/sessions/:id/history')
         → applySessionHistory(sessionId, revision, merge)
            → mergePersistedWithOverlay(persisted, overlay, ...)
            → ChatRuntimeState.sessions[id].messages = result
```

**bug 现场（`useChatStream.ts:269-351`）**：

```ts
export function mergePersistedWithOverlay(persisted, overlay, historyRevision, ...) {
  const result = [...persisted];             // ① 以 persisted 服务端顺序为基底
  // ...
  for (let overlayIndex = 0; overlayIndex < overlay.length; overlayIndex += 1) {
    const candidate = overlay[overlayIndex];
    // ② identity 匹配（messageId / clientMessageId）
    const persistedIndex = result.findIndex(...identity === candidateIdentity);
    if (persistedIndex >= 0) { /* merge */ continue; }
    // ③ 上次新增：runId 二次去重（避免同 run 重复气泡）
    if (candidate.role === 'assistant' && candidate.runId) {
      const runIndex = result.findIndex(...);
      if (runIndex >= 0) { /* merge */ continue; }
    }
    // ④ 关键 bug：找不到任何匹配时，insertAt 兜底为 result.length
    let insertAt = result.length;
    for (let previous = overlayIndex - 1; previous >= 0; previous -= 1) {
      // 扫描 overlay 之前的项，看它在 result 里有没有位置
      // ...如果没有就一路扫到 overlay[0]，insertAt 仍为 result.length
    }
    result.splice(insertAt, 0, candidate);   // ← 插到末尾
  }
  return result;
}
```

**为什么 user message 跑到 assistant 后面**：

| 时刻 | overlay（前端流式状态） | persisted（后端 history） |
|---|---|---|
| done 触发时 | `[user1, assistant1(runId=runA, 流式 final 已写)]` | `[user1, assistant1(runId=runA, 可能已写或滞后)]` |
| refetch 完成 | overlay 未变 | persisted 已包含完整 assistant1 |
| merge 调用 | overlay[0]=user1, overlay[1]=assistant1 | persisted[0]=user1, persisted[1]=assistant1 |

正常情况：两条都通过 ② 命中，merge 走"同 run / 同 id"分支，不动位置。

**异常情况（导致 bug）**：

- 后端 write-through 还没把这条 assistant 的 `messageId` 写进 JSONL → persisted 里 assistant1 **还没出现**（或还在上一轮）
- 或者后端 user message 还在 pending flush，persisted 比 overlay **少** 1 条 user1
- 此时 overlay 中 user1 / assistant1 在 ② ③ 都不命中 → 走 ④ splice 兜底
- 因为 user1 是 overlay[0]，往前扫 overlay[-1] 不存在，`insertAt = result.length`，user1 被插到 result 末尾

但 assistant1 反而命中了 ② 或 ③（persisted 中通常 assistant 先于 user 落盘，或反之；顺序由后端决定）→ assistant1 留在原位 / 被 merge 进原位。结果：**assistant 在上、user 在下**。

**为什么"过一会自动刷新"才触发**：

- 流结束瞬间：`status='done'` → `applySessionHistory` 的 `merge` 被调用，persisted 还没写好 user message，splice 兜底。
- 用户看到 "AI 完整回复" 还在原位、user 还在原位——因为 overlay 还没被 history 替换。
- **几秒后**（后端 write 延迟），ChatPage 的 `useEffect [status]` 触发 → `invalidateQueries(['sessions'])` → 重新 fetch 整个会话状态 → **再次调用 merge** → 这次 persisted 已包含完整数据，但 overlay 与 persisted 的 identity 不再一致（overlay 端的 assistant1 有了真正的 messageId 但 persisted 端的还没刷）→ splice 兜底再次触发。
- 实际表现："自动刷新了一下" 后顺序才颠倒。

### 4.2 修复策略（按 systematic-debugging Phase 4：root cause 而非症状）

**根因修复**：让 `mergePersistedWithOverlay` 在 identity / runId 都不命中时，**按 overlay 原始顺序兜底**，而不是 `result.length`。

#### 方案 B（推荐）：overlay 顺序作为骨架，persisted 补全

- 算法：先按 overlay 顺序生成 `result = [...overlay]`；然后遍历 persisted，**对于 persisted 中 identity 与 overlay 不匹配的新条目（典型：旧历史里上一轮就完成的 run）**，按 overlay 中已有的稳定锚点（前后已存在的 message）插入到正确位置；persisted 与 overlay identity 匹配的条目则 merge。
- 优点：彻底杜绝「overlay 顺序被 persisted 拖走」。已存在的重复 trace bubble 修复（runId 二次去重）依然有效，因为 assistant 的 runId 在 overlay / persisted 间稳定。
- 缺点：实现略复杂（需要处理 persisted 独有的"旧历史"条目插入位置）。

#### 方案 A（保守）：最小改动 — 修复 splice 兜底

- 算法：把第 ④ 段 `insertAt = result.length` 改为：**优先插在 overlay 中「上一个已存在于 result 的 message」的 `previousResultIndex + 1`**；如果 overlay 中没有这样的锚点（例如 overlay 整段都是新增），再 `insertAt = 0`（插到开头，而不是末尾），保持 user 在 assistant 前。
- 优点：改动小（< 20 行），回归测试容易写。
- 缺点：边界场景多（overlay 中前 N 条都没命中 persisted 时），需要更多断言覆盖。

**选 B 方案**。理由：彻底消除 splice 兜底，根因层修；A 方案的边界条件太多，长期维护成本高。

### 4.3 修复 2：收紧 invalidate 范围（次要）

**位置**：`web/src/pages/ChatPage.tsx:86-90`

**当前**：
```tsx
useEffect(() => {
  if (status === 'done' || status === 'error' || status === 'aborted') {
    queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all }); // ['sessions']
  }
}, [status, queryClient]);
```

**问题**：`['sessions']` 作为 prefix 会让任何 `['sessions', ...]` 子键的 query 都失效。目前 `useChatStream` 走 Zustand store 不走 React Query，所以**当前不会复现二次 refetch**；但一旦将来把 history 也迁到 React Query，**这条 effect 会强制重拉 history，再次触发 merge**。

**修法**：
- 在 `queryKeys.sessions` 下新增 `list: ['sessions', 'list']`（侧边栏列表专用）
- ChatPage invalidate 只刷 list

**契约**：`queryKeys.sessions.list` 由 useSessions / Sidebar 唯一消费；其他 `['sessions', ...]` 子键（如 `detail`、`history`）不受影响。

### 4.4 数据 / 接口

无新增接口。无 SSE 协议变更。无 store schema 变更（仅实现细节）。

### 4.5 验收

| # | 验收 | 测量方式 |
|---|---|---|
| 1 | done 后 user message 不再被排到 assistant 后面 | 回归测试：`mergePersistedWithOverlay` 单元 + 集成（vitest） |
| 2 | 同 run 仍只有 1 个 trace bubble | 不回归上一批 `duplicate-trace-bubble-fix-verification-lite.md` |
| 3 | 上一轮已完成的 run 历史仍能正确合并 | 切会话回来 + 老历史有 N 个 run 的场景 |
| 4 | invalidate 只刷侧边栏 list | vitest / 浏览器 dev tools network 验证 |
| 5 | tsc -b 零误差 | `pnpm -C web exec tsc -b` |
| 6 | vitest chat 相关全绿 | `pnpm -C web exec vitest run tests/features/chat/` |
| 7 | 360 px / 1440 px 视觉无变化 | Playwright 截图对比 |

### 4.6 不在范围

- 不实现 "streamState 重试 / 断点续传"（与本 bug 无关）。
- 不优化 history refetch 频次（已有 `persistedRevision` 收敛保护）。
- 不重构 `chatRuntimeStore` 的整体架构。

## 5. 风险点

1. **方案 B 改动 `mergePersistedWithOverlay` 的核心顺序逻辑** — 必须先有 failing test，再改实现。
2. **回归上一批 trace bubble 修复** — 改动 merge 函数可能破坏 `2026-08-12-duplicate-trace-bubble-fix-verification-lite.md` 已落地的「runId 二次去重」逻辑；要保留并新增对应测试。
3. **persisted 中「overlay 没有的旧条目」插入位置** — 必须按 overlay 锚点决定，不允许默认插到末尾。
4. **`queryKeys.sessions.list` 命名约定** — 项目内尚未有 list 命名，本次新增需保持一致。

## 6. References 检查

- `harness-kit/references/definition-of-done.md` — Tier 1 修复必对照（5 段 20+ 项）。
- `harness-kit/references/testing-patterns.md` — AAA、Mock 层次；回归测试必覆盖原 bug。
- `harness-kit/references/orchestration-patterns.md` — 本批非编排，但 fix-as-architecture 反模式自检（避免堆防御代码）。

## 7. Next

写入 `.ai-runtime-artifacts/plans/2026-08-12-history-refetch-message-order-flip-plan.md`，FM `dispatch: n/a`（单 WU，Tier 1 范围内可 Leader 直做，无需 orchestration）。

等用户说「写计划」或「直接做」。
