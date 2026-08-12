---
artifact: implementation-plan
route: superpowers:writing-plans
skills:
  - writing-plans
  - systematic-debugging
  - source-driven-development
  - test-driven-development
skills_evidence:
  - skipped: writing-plans (not found at .agents/skills/)
  - systematic-debugging@harness-kit/.agents/skills/systematic-debugging/SKILL.md
  - source-driven-development@harness-kit/.agents/skills/source-driven-development/SKILL.md
  - test-driven-development@harness-kit/.agents/skills/test-driven-development/SKILL.md
dispatch: n/a
source:
  - .ai-runtime-artifacts/specs/2026-08-12-history-refetch-message-order-flip-spec.md
  - .ai-runtime-artifacts/verifications/2026-08-12-duplicate-trace-bubble-fix-verification-lite.md
  - harness-kit/core/routing.md
  - harness-kit/references/definition-of-done.md
  - harness-kit/references/testing-patterns.md
created_at: 2026-08-12
status: approved
approved: true
approval_ref: "用户 2026-08-12 会话原话：「按照harness的流程实现」"
tier: 1
---

# Plan — History Refetch 消息顺序颠倒修复

> 单 WU、Tier 1 Leader 直做。dispatch: n/a（不编排）。
> 根因修复走 systematic-debugging Phase 4：先 failing test，再实现，最后验证。

## Goal

修复 chat 流式完成（done / aborted / error）后 history refetch 把 user message 排到 assistant 后面这个 P0 体验 bug。同时收紧 `ChatPage` 的 invalidate 范围，避免未来 history 迁到 React Query 时再次触发同类问题。

## Architecture / Tech Stack

- 前端：React 18 + TypeScript + Zustand 5 + TanStack Query 5
- 测试：vitest + @testing-library/react
- 验证命令（项目实际，与 `harness-kit/project.verification.md` 模板的 npm 命令**不一致**——模板未适配 web 子项目）：
  - 类型：`pnpm -C web exec tsc -b`
  - 单测：`pnpm -C web exec vitest run tests/features/chat/`
  - E2E / 视觉：Playwright MCP（启 vite，端口 5173）

## Task 列表

### Task 1 — failing test（先于实现）

> systematic-debugging Phase 4.1：**failing test first**。禁止先实现再补测试。

**目标文件**：`web/tests/features/chat/merge-persisted-with-overlay.test.ts`（新增）。

**测试用例**（每个一个 `it`，AAA 模式）：

1. **`'preserves overlay order when persisted is missing the latest user message'`**
   - Arrange:
     - overlay = `[user1, assistant1(runA, has final text)]`
     - persisted = `[user1, assistant1(runA, no final text yet)]`（模拟 write-through 滞后，仅 trace blocks）
   - Act: merge
   - Assert: result 顺序仍为 `[user1, assistant1]`，user 在前

2. **`'user message stays before its assistant when persisted lacks the user row'`**
   - Arrange:
     - overlay = `[user1, assistant1]`
     - persisted = `[assistant1]`（user1 还没落盘）
   - Act: merge
   - Assert: result[0].role === 'user' && result[0].text === user1.text

3. **`'does not regress duplicate trace bubble fix - one bubble per run'`**
   - 来自 `2026-08-12-duplicate-trace-bubble-fix-verification-lite.md` 已覆盖的断言。
   - Arrange: overlay 已有 assistant1(asst-${runA}), persisted 出现 hist-${messageId} 同 runA
   - Act: merge
   - Assert: result 里 assistant role 只 1 条

4. **`'persisted-only historical runs are inserted before newer overlay items'`**
   - Arrange:
     - overlay = `[user2, assistant2(runB)]`（新一轮）
     - persisted = `[user1, assistant1(runA), user2, assistant2(runB)]`（含旧 runA + runB 完整）
   - Act: merge
   - Assert: 顺序为 `[user1, assistant1, user2, assistant2]`

5. **`'overlay-only item without persisted anchor inserts at the correct position'`**
   - Arrange:
     - overlay = `[userA]`（孤立 user，无前后）
     - persisted = `[user1, assistant1, user2, assistant2]`（已有 4 条）
   - Act: merge（极端场景：overlay 整段缺失 persisted 锚点）
   - Assert: 不报错；userA 至少被 append（兜底），但 result 长度 ≥ 1，且不会让 assistant 顺序错乱

6. **`'mixed scenario: overlay has 2 turns, persisted has 3 turns, last turn only in overlay'`**
   - 端到端模拟用户场景。
   - Arrange:
     - overlay = `[user1, assistant1, user2, assistant2(runC, 流式 final 半成)]`
     - persisted = `[user1, assistant1, user2]`（user2 已落盘，assistant2(runC) 未落盘）
   - Act: merge
   - Assert: 顺序 `[user1, assistant1, user2, assistant2]`，user2 仍在 assistant2 前

7. **`'invalidate scope change does not touch history query'`**（Task 3）
   - Arrange: spy `queryClient.invalidateQueries`
   - Act: 触发 status 变 done
   - Assert: 收到 `['sessions', 'list']`，**未**收到 `['sessions', 'history']` 或泛 `['sessions']`

**期望**：写完测试后 `pnpm -C web exec vitest run tests/features/chat/merge-persisted-with-overlay.test.ts` 至少 #1 / #2 / #6 fail，#3 / #4 / #5 / #7 PASS（#3 上次修过；#7 还没动）。

### Task 2 — 修复 mergePersistedWithOverlay（方案 B：overlay 顺序作为骨架）

**文件**：`web/src/features/chat/useChatStream.ts:269-351`

**新算法**（伪代码，保留 runId 二次去重 + identity merge）：

```ts
export function mergePersistedWithOverlay(persisted, overlay, historyRevision, requiredRevisionForRun) {
  // 步骤 1：以 overlay 顺序为骨架（保留流式顺序）
  const result = [...overlay];

  // 步骤 2：遍历 persisted，把 persisted 中「overlay 没有的条目」按位置补全；
  //         persisted 中「overlay 已有的条目」做 merge（保留 identity）。
  const overlayIdentities = new Set(result.map(identity));
  const overlayRunIds = new Set(
    result.filter(m => m.role === 'assistant' && m.runId).map(m => m.runId)
  );

  // 步骤 3：先处理 persisted 与 overlay identity / runId 匹配的条目
  for (const persistedMsg of persisted) {
    const idMatch = result.findIndex(m => identity(m) === identity(persistedMsg));
    if (idMatch >= 0) {
      // 已有 identity 匹配：按 overlay-wins / persisted-wins 合并（保留现有逻辑）
      result[idMatch] = mergeForSameIdentity(result[idMatch], persistedMsg, historyRevision, requiredRevisionForRun, persistedMsg.runId);
      continue;
    }
    // runId 二次匹配（assistant）
    if (persistedMsg.role === 'assistant' && persistedMsg.runId && overlayRunIds.has(persistedMsg.runId)) {
      const runMatch = result.findIndex(m => m.role === 'assistant' && m.runId === persistedMsg.runId);
      if (runMatch >= 0) {
        result[runMatch] = mergeForSameRun(result[runMatch], persistedMsg, historyRevision, requiredRevisionForRun);
        continue;
      }
    }
    // 步骤 4：persisted 独有（overlay 中没有的旧历史条目）— 按 overlay 锚点决定插入位置
    insertPersistedOnlyAtAnchor(result, persistedMsg, overlay);
  }

  // 步骤 5：overlay 独有（persisted 中没有的新条目，如流式刚发、还没落盘的 user/assistant）— 已在步骤 1 中按 overlay 顺序放入 result，无需额外处理
  return result;
}
```

**关键函数**：

```ts
function insertPersistedOnlyAtAnchor(result, persistedMsg, overlay) {
  // 思路：在 overlay 中找与 persistedMsg 「最接近」的位置锚点（按 identity 匹配）
  // 然后把 persistedMsg 插到 result 中相应位置。

  let anchorResultIndex = -1; // 在 result 中（即 overlay）的位置
  let anchorDirection: 'before' | 'after' = 'after';

  // 简化：按 identity 在 overlay 中找
  const overlayMatch = overlay.findIndex(m => identity(m) === identity(persistedMsg));
  if (overlayMatch >= 0) {
    // 实际上不会到这里（步骤 3 已处理 identity / runId 匹配），保留兜底
    anchorResultIndex = overlayMatch;
    anchorDirection = 'after';
  }

  // 兜底：如果 persistedMsg 是 overlay 完全没有的旧历史条目（如旧 run），
  // 扫描 overlay 中的 message，找 persistedMsg 在 overlay 时间线上的位置：
  //   - 如果 persistedMsg 出现在 overlay 最早一条之前 → 插到 result[0]
  //   - 否则按 overlay 顺序的尾部追加（仅极端情况）
  // （具体逻辑参考 v3 历史位置推断；本批先按 identity 找；找不到则按时间戳 / turnId 兜底插到末尾）

  if (anchorResultIndex < 0) {
    // 真·兜底：append（这是极端场景，不应影响当前 bug 修复路径）
    result.push(persistedMsg);
    return;
  }

  // 找到锚点：在 result 中按 overlay 顺序插入
  const insertAt = anchorDirection === 'after' ? anchorResultIndex + 1 : anchorResultIndex;
  result.splice(insertAt, 0, persistedMsg);
}
```

**保留现有合并语义**：
- `mergeAssistantForSameRun`（overlay-wins / persisted-wins）保留原逻辑；
- `mergeAssistantTextFromOverlay`（保留更长 final text）保留；
- identity = `messageId ?? clientMessageId ?? id` 不变。

### Task 3 — 收紧 queryKeys.sessions 与 ChatPage invalidate

**文件**：
1. `web/src/lib/query-keys.ts` — 新增 `sessions.list: ['sessions', 'list']`
2. `web/src/pages/ChatPage.tsx:86-90` — invalidate 改用 `queryKeys.sessions.list`

**契约**：
- `queryKeys.sessions.all` 仍保留（作为 sessions 域总前缀），**不要在 ChatPage 直接使用**
- 新增 `sessions.list` 给侧边栏专用
- 若 Sidebar 用了 `sessions.all`，改成 `sessions.list`（如果有）

**操作**：
1. `query-keys.ts` 新增：
   ```ts
   list: () => ['sessions', 'list'] as const,
   ```
2. `ChatPage.tsx:88` 改为：
   ```ts
   queryClient.invalidateQueries({ queryKey: queryKeys.sessions.list() });
   ```
3. grep `queryKeys.sessions.all` 全仓，确认只有需要全量刷新的地方使用（通常是 useSessions），其他改 `list()`

### Task 4 — 视觉与端到端验证（Leader 跑）

**命令**：

```powershell
Set-Location "d:\studyspace\project\my-agent\web"
pnpm exec tsc -b
pnpm exec vitest run tests/features/chat/
```

**期望**：tsc 0 errors；vitest chat 相关全绿（**含 Task 1 新增的 7 个用例**）。

**Playwright 手动验证**（用户已在浏览器复现，本批用 Playwright 复测即可）：
1. 新建会话，发一条触发多步工具调用的复杂问题
2. 等 AI 完成（done）
3. 等 ≥ 3 秒（给 invalidate / refetch 时间）
4. 截图断言：user 气泡在 AI 完整回复**上方**
5. 切到 B 会话再切回 A，重复 3 次：顺序始终稳定

### Task 5 — 写 verification-lite（Tier 1 强制产物）

**路径**：`.ai-runtime-artifacts/verifications/2026-08-12-history-refetch-message-order-flip-verification-lite.md`

模板 `harness-kit/.agents/skills/verification-before-completion/SKILL.md` 的 verification-lite 段；至少包含：
- 根因（指向 spec §4.1）
- 修复点（mergePersistedWithOverlay 算法 + queryKeys.sessions.list）
- 验证命令 + 结果
- `### References 检查`（definition-of-done.md + testing-patterns.md 逐项打勾）

## Plan 自检

- [x] 区分根因修复（merge 算法）vs 次要修复（invalidate 范围）vs 验证（test + e2e）
- [x] failing test 先于实现（Task 1 → Task 2）
- [x] 不动 `runTrace.ts` / `Markdown.tsx` / `MessageBubble.tsx` / `MessageList.tsx`（bug 在数据层）
- [x] 不引入新依赖
- [x] 不修改 SSE 协议 / `runId` / `messageId` / `clientMessageId` 契约
- [x] 风险点已标（merge 算法改动可能回归上批 duplicate trace bubble fix）

## 风险点

1. **merge 算法重构可能回归 duplicate trace bubble fix** — Task 1 #3 显式覆盖。
2. **persisted-only 旧历史插入位置**：方案 B 用 identity / runId 锚点；找不到锚点时 append 兜底（极端场景，不会影响当前 bug 路径）。
3. **`queryKeys.sessions.list` 命名冲突**：项目内目前无 `list` 命名，新增后 grep 全仓防误用。

## References 检查

- `harness-kit/references/definition-of-done.md`：✅ 见 verification-lite §References。
- `harness-kit/references/testing-patterns.md`：✅ AAA、Mock 最小化；本批测试直接调 `mergePersistedWithOverlay` 不引入 mock。

## Next

**（按 harness 阶段门禁：本 plan 写入后须暂停，等用户说「开始实现」/「直接做」/「并行执行」，不得同轮改业务代码。）**

- 确认 plan → 说「开始实现」或「直接做」
- 调整 plan → 直接说修改意见
- 拆分并行 → 写同 stem `*-dispatch.md`（本批单 WU，不需要）
