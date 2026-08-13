---
type: verification-lite
title: trace 隐藏调度工具本尊 + 切会话清 creating
date: 2026-08-12
owner: leader
scope: chat 渲染微调（不写 SPEC/PLAN，Tier 1 Leader 直做）
status: passed
---

## 范围

回应用户即时反馈两条：

1. **trace 中不再出现调度工具本尊** —— `run_worker` / `dispatch_to` / `hand_off_to` 本身不出现在 RunTracePanel，trace 只展示子 Agent 内部步骤（思考、stat_file 等）。
2. **切会话时清 `creating`** —— Composer 的「红色停止按钮」不会因上一会话的懒创建残留状态而错误延续。

不写 spec/plan/dispatch：范围明确、单文件级微调、用户已经看到截图并明确表达「把那些只展现结果和的那些调用子 Agent 的工具不要注入」。

## 改动文件

- `web/src/features/chat/runTrace.ts`
  - 新增 `DISPATCH_TOOL_NAMES` 常量（Set：`run_worker` / `dispatch_to` / `hand_off_to`）。
  - 新增 `dispatchToolCallIds` 集合：扫描 `tool_call` 时记录被过滤掉的 dispatch 工具的 `toolId`。
  - `buildRunTrace` 的 `tool_call` 分支：调度工具直接 `continue`，不入 `toolIndex`、不入 `steps`，但把 `toolId` 加进 `dispatchToolCallIds`。
  - `buildRunTrace` 的 `tool_result` 分支：**两道兜底**——`block.toolName` 是 dispatch 时跳过；或对应 `toolCallId` 在 `dispatchToolCallIds` 中时也跳过。
    - **修复用户截图 bug**：「已完成」孤儿 step。JSONL history 路径下，tool_result row 的 content block 没有 `name` 字段（`parseHistoryBlocks` 解析为 `cb.name ?? ''`），光看 `block.toolName` 无法识别 dispatch；只能通过 `toolCallId` 反查父 tool_use。
  - 移除 `tool_result` 分支里原本的 `isDispatchLike` / `stripWorkerEnvelope` 三路分流 —— 不再需要（所有 dispatch 工具已在上层被过滤）。
- `web/src/features/chat/runTrace.ts` 中的 `TOOL_ACTION_LABELS` 保留 dispatch 工具的中文名（用于将来若打开降级路径仍可读）。
- `web/tests/features/chat/runTrace.test.ts`
  - **流式路径测试**（保留）：「run_worker / dispatch_to / hand_off_to 不进 trace」3 个 + 混合场景 1 个。
  - **history 路径测试**（新增 3 个）：模拟 JSONL 解析场景，tool_result 的 `toolName=''`：
    - 「dispatch_to history 路径：tool_result toolName 缺，靠 toolCallId 反查」
    - 「run_worker history 路径：tool_result toolName 缺，靠 toolCallId 反查」
    - 「history 路径混合：dispatch_to 被过滤 + 子 Agent stat_file 保留」
- `web/src/pages/ChatPage.tsx`
  - 新增 `useEffect(() => setCreating(false), [sessionId])`：会话切换时显式释放 `creating`，避免红色停止按钮跨会话残留。

## 验证

### 自动化测试

| 文件 | 命令 | 结果 |
| --- | --- | --- |
| `tests/features/chat/runTrace.test.ts` | `pnpm exec vitest run tests/features/chat/runTrace.test.ts`（web 目录） | **43/43 通过**（流式路径 4 + history 路径 3 + 旧契约 36） |
| `web tsc -b` | `pnpm exec tsc -b`（web 目录） | **0 错误** |
| `vitest run`（全 web） | `pnpm exec vitest run`（web 目录） | 309/313 通过；4 个失败均为 baseline 已存在（`bundle.test.ts` × 2 gzip 体积超限；`chat-stream-state.test.ts` × 2 sessionId 视图重置），**与本次改动无关** |

> 验证：未变更 baseline 失败项、未引入新失败。

### 契约核对

| 契约点 | 期望 | 实测 |
| --- | --- | --- |
| run_worker tool_call 不进 trace（流式路径） | `vm.steps` 不含该 tool | 测试通过 |
| dispatch_to tool_call 不进 trace（流式路径） | `vm.steps` 不含该 tool | 测试通过 |
| hand_off_to tool_call 不进 trace（流式路径） | `vm.steps` 不含该 tool | 测试通过 |
| dispatch_to tool_result 不进 trace（流式路径，toolName 自带） | `vm.steps.length === 0` | 测试通过 |
| dispatch_to tool_result 不进 trace（history 路径，toolName=''） | `vm.steps.length === 0` | 测试通过 |
| run_worker tool_result 不进 trace（history 路径，toolName=''） | `vm.steps.length === 0` | 测试通过 |
| history 路径混合：dispatch_to 被过滤 + 子 Agent stat_file 保留 | `vm.steps.length === 1`，stat_file 带 actorName | 测试通过 |
| 子 Agent 内部工具（stat_file 带 actorName='coder'）保留进 trace | step 带 actorName='coder' / actorKind='agent' | 测试通过 |
| 切换 sessionId 时清 `creating` | ChatPage.tsx 新增 `useEffect(() => setCreating(false), [sessionId])` | 通过 grep 确认 |

### Baseline 失败（不属于本次改动）

```
tests/unit/bundle.test.ts
  - bundle budget > JS gzip under 180KB
  - bundle budget > CSS under 20KB gzipped
tests/unit/chat-stream-state.test.ts
  - sessionId 变化时的视图重置 > rerender with empty sessionId clears messages ...
  - sessionId 变化时的视图重置 > rerender with another non-empty sessionId clears previous messages ...
```

`git stash` 验证：以上 4 个测试在 baseline (`8b30514`) 上同样失败，与本次改动无关。

### 风险与未验证项

- ✅ **端到端浏览器烟测（Playwright MCP）已完成**：
  - **流式路径（首发流式完成后）**：新会话输入「调用 coder 子 Agent 写 30 行 React 旅游卡片组件」，流式完成后 trace 显示「2 步 · 0 个工具」（思考 / 思考），下方独立绿色气泡 `C Coder 子 Agent 回复` + 完整 31 行代码。截图：`trace-and-agent-bubble-fixed.png`。
  - **历史路径（强清缓存刷新页面后）**：用户原截图里的 session（`gconv-82f34ff68030`），强清 cache 后重新加载，trace 显示「2 步 · 0 个工具」——**「已完成」孤儿 step 不再出现**，且 resultDetail 不再展开 XML 信封「`<worker-result>`」和完整 Coder 内容。
  - **问题 #2（切会话清 creating）**：在 session A 触发流式响应（按钮变红 stop-button RED），切到 session B → 按钮立刻恢复蓝色发送按钮（disabled 因为空 textarea）。再切到空白页 `/chat`（无 sessionId）→ 按钮也是发送按钮。截图：`session-switch-button-fixed.png` / `blank-page-button-fixed.png`。
- ❗ **新发现的 bug（属历史路径持久化层缺口）**：刷新页面后，**独立绿色 Coder 气泡消失**。根因：JSONL 持久化层没存 `agent_message` SSE 事件；`parseHistoryMessages` 从 JSONL 重建时拿不到 role=agent 消息。这是更早 WU-03 留下的边角问题，**不属本批范围**。建议下一批单独处理（持久化层或 history 重建时把 `dispatch_to` + `tool_result` 配对转换出 role=agent 消息）。
- **未跑 Backend 测试**：本次改动只触 web 前端；backend 端文件未变。
- **`stripWorkerEnvelope` 函数保留但失去调用方**：保留供将来特殊场景（如调试视图）使用；若确认永不再用，可后续清理（属 dead code）。

## 决策与偏差

- 用户原话：「派发之后什么都没有反应」—— 上一轮 WU 已经修好了这一项（截图中能看到子 Agent 内部步骤）。本轮这次改动把"派发子 Agent"这一行直接去掉，与用户「不要注入那些只展现结果和的那些调用子 Agent 的工具」对齐。
- 用户原话：「按钮状态没跟会话走」—— 已用最简修复：会话切换显式 `setCreating(false)`，避免跨会话残留。
- 用户新截图反馈（**「已完成」孤儿 step 误显 Coder 内容**）：原计划是过滤调度工具，**漏掉了 history 路径下 tool_result 行的 `name` 字段缺失**这一暗坑。用 `dispatchToolCallIds` 集合做工具调用 ID 配对索引，**两道兜底**（toolName 自带 / toolCallId 反查），稳。

## Next

- （关键）history 路径下独立绿色气泡缺失 —— 持久化层缺口，需另开一批修（建议写 SPEC/PLAN）。
- （可选）把 `stripWorkerEnvelope` 改成只在调试模式下生效，或直接删掉。