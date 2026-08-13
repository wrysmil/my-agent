---
title: history-refetch agent bubble rebuild（刷新页面后 dispatch_to / hand_off_to 独立绿色气泡不丢失）
status: done
approved: true
date: 2026-08-12
batch: trace-dispatch-hide-and-button-reset 关联 bug（不在本批范围）
tier: Tier 1（Leader 直做）
route: verification-before-completion
---

# history-refetch agent bubble rebuild — verification-lite

## TL;DR

修复刷新页面后独立绿色 Coder 气泡消失的 bug。根因：JSONL 持久化层未存 `agent_message` SSE 事件；`parseHistoryMessages` 只把 `tool_use` + `tool_result` 还原成 assistant 消息的 blocks，丢失了独立的 role=agent 消息。

修复：`parseHistoryMessages` 末尾增加后处理 pass，扫描每条 assistant 的 `dispatch_to` / `hand_off_to` tool_call，配对对应 `tool_result`（`toolCallId` 一致），剥 worker XML 信封，生成独立 `role:'agent'` ChatMessage，插在对应 assistant 之后。

## 变更

### `web/src/features/chat/useChatStream.ts`

- 新增 `rebuildDispatchAgentMessages(messages)` 函数（pure），被 `parseHistoryMessages` 在末尾调用（fast path：无 dispatch → 直接 return messages，无副作用）
- `export function parseHistoryMessages` + `export interface SerializedMsg`（测试需要）
- `import { stripWorkerEnvelope } from './runTrace'`（复用已有 worker XML 信封剥离）
- `import type { ToolResultBlock }`（用于 type narrowing）

### `web/tests/features/chat/useChatStream.parseHistory.test.ts`（新增）

8 个测试覆盖 history 路径下的 agent 气泡重建：
1. dispatch_to + tool_result 配对 → role=agent 气泡 + XML 信封已剥 + 稳定 ID `hist-agent-${toolCallId}` + runId 透传 + actorName 来自 `input.to`
2. hand_off_to → 气泡 `isFinal: true`
3. 无 dispatch 调用 → 不生成空气泡
4. run_worker（非 dispatch）→ 不生成 agent 气泡（保留 trace 风格）
5. 一条 assistant 含多个 dispatch_to → 每个生成对应气泡，ID/actorName 各自独立
6. worker-error 信封也走 stripWorkerEnvelope
7. 无对应 tool_result → 跳过（不生成空气泡）
8. 位置：agent 气泡插在对应 assistant 之后，不打乱 user/asst 顺序

## 测试结果

```
✓ tests/features/chat/useChatStream.parseHistory.test.ts (8 tests) 5ms
✓ tests/features/chat/runTrace.test.ts (43 tests) 11ms
✓ tests/features/chat/chatRuntimeStore.test.ts (24 tests) 14ms
✓ tests/features/chat/use-chat-stream-agent-message.test.ts (7 tests) 644ms
✓ tests/features/chat/merge-persisted-with-overlay.test.tsx (7 tests) 37ms
✓ tests/features/chat/run-trace-panel-matrix.test.tsx (17 tests) 767ms
✓ tests/features/chat/run-trace-panel.test.tsx (27 tests) 1092ms
✓ tests/features/chat/message-bubble-agent.test.tsx (4 tests) 390ms
...
Test Files  39 passed (39)
     Tests  311 passed (311)
```

排除的已知 pre-existing 失败（与本批**无关**，stash my changes 后 base code 也 fail）：
- `tests/unit/bundle.test.ts`（2 个）— bundle budget 配置 vs 实际产物数量级不一致，预先欠账
- `tests/unit/chat-stream-state.test.ts`（1 个）— `sessionId 变化时的视图重置` 场景在 base code 上同样 fail

后端 48 个测试也全过：
```
✓ test/orchestration/dispatch.test.ts (22 tests) 10ms
✓ test/orchestration/tools.test.ts (13 tests) 31ms
Test Files  4 passed (4)
     Tests  48 passed (48)
```

类型检查：`tsc -b` 无 error。

## 冒烟（Playwright MCP）

杀掉旧 web 服务（PID 10116 占 4321），启动新 web 服务（带新代码）后访问历史会话。

### 会话 1：`gconv-f760d8995402`（3 条消息，dispatch_to coder，但 worker aborted）

snapshot 看到：
- 用户问题
- "已完成 1 个步骤 · 0 个工具" trace 气泡（**dispatch_to tool_call 被正确隐藏**）
- **独立绿色 Coder 气泡**："C" 头像 + "coder" + "子 Agent 回复" 标签 + "Worker aborted." 文本

→ 截图：`.playwright-mcp/page-2026-08-12T10-46-21-577Z.png`

### 会话 2：`gconv-82f34ff68030`（4 条消息，dispatch_to coder 写 TravelPage.jsx）⭐ **关键证据**

1280×1800 viewport 完整可见：
- 用户问题
- 紫色主 Agent trace 气泡（"已完成 2 个步骤 · 0 个工具" — 两个 thinking 步骤，**无 dispatch_to**）
- 紫色主 Agent 文本气泡（"我来调用 coder 子 Agent..." + 交付内容总结 + "复制消息"按钮）
- **独立绿色 Coder 气泡**（`class="border-emerald-500/30 bg-emerald-500/10"` 翡翠绿边框/背景）：
  - 顶部头像 + "coder" + "子 Agent 回复" 标签
  - "我来创建一个带卡片收藏和价格排序交互的旅游页面组件..." 描述
  - 完整 `TravelPage.jsx` 代码块 + markdown 渲染
- 底部输入框

→ 截图：`.playwright-mcp/page-2026-08-12T10-49-53-149Z.png` + 已保存到 `history-refetch-agent-bubble-fixed.png`

### 会话 3：`gconv-66c93eb808a9`（4 条消息，主 Agent 自己干活，无 dispatch_to）

trace 显示 11 个工具全是 read_file/list_files/search_files — **不应**出现 agent 气泡（实际也没出现，行为正确）。会话日志显示 "当前环境不支持子 Agent（Coder）的派发" — 是 AgentRunner 还没注入 dispatch_tools 的早期会话。

## 设计要点

1. **稳定 ID**：`hist-agent-${toolCallId}` — 与 `hist-${m.id}` 风格一致；mergePersistedWithOverlay 复用同一槽位，避免 refetch 抖动。
2. **顺序**：倒序 `splice(insertAfter + 1, 0, agentMsg)` 避免前面插入导致 index 失效。
3. **XML 信封剥离**：复用 `runTrace.ts` 的 `stripWorkerEnvelope`（处理 `<worker-result>` + `<worker-error>` + 反转义）。
4. **`actorName` 来源**：优先从 `tool_call.input.to` 取；缺失时回退到 `tool_result.actorName`。
5. **`isFinal`**：`hand_off_to` → true；`dispatch_to` → false。
6. **未存 tool_result 的 edge case**：跳过（不生成空气泡），避免显示空文本。
7. **`run_worker`（非 dispatch）**：不在 agent 气泡集合（仅当私有结果进 trace，无可见回复）。

## 关联 / 范围说明

| 项 | 状态 |
| --- | --- |
| 上一批 trace-dispatch-hide-and-button-reset 已修：trace 内不显示 dispatch tool_call/tool_result | ✅ 已修（上一批） |
| 上一批已修：切会话红按钮残留（`creating` useEffect） | ✅ 已修（上一批） |
| **本批：history 路径下重建 dispatch_to / hand_off_to 独立 agent 气泡** | ✅ **已修（本批）** |
| 持久化层补存 `agent_message` SSE 到 JSONL（治根治本方案） | 未做（可选优化） |

持久化层治本方案更优（避免每次 history 加载都要重新派生），但需要：
1. `bin/my-agent-web.ts` SSE envelope 转发 agent_message 时同步持久化
2. JSONL schema 增加新 row 类型
3. 兼顾历史 JSONL 兼容性（旧数据无 agent_message row → 走派生重建）

本次实现选了**派生重建**方案——更小风险、向后兼容、不改后端协议、不改 JSONL 格式。后续若 history 加载性能成瓶颈再切治本方案。

## 产物清单

| 路径 | 类型 | 用途 |
| --- | --- | --- |
| `web/src/features/chat/useChatStream.ts` | 源码 +83 行 | `rebuildDispatchAgentMessages` 函数 + 导出 `parseHistoryMessages` / `SerializedMsg` |
| `web/tests/features/chat/useChatStream.parseHistory.test.ts` | 单元测试 +223 行 | 8 个测试 |
| `history-refetch-agent-bubble-fixed.png` | 截图 | 修复证据（绿色气泡独立显示） |
| `.playwright-mcp/page-2026-08-12T10-46-21-577Z.png` | 截图 | 会话 1（dispatch aborted） |
| `.playwright-mcp/page-2026-08-12T10-49-53-149Z.png` | 截图 | 会话 2（完整 TravelPage.jsx 代码） |
| `.playwright-mcp/page-2026-08-12T10-47-03-882Z.png` | 截图 | 会话 2（mid 视图） |

## Next

可选后续（不在本批）：
- 持久化层治本：SSE `agent_message` 同步写 JSONL；老数据用本派生兜底（已实现）
- 跑后端 tests 全量一遍（typecheck + 48 个 orchestration 测试已过；messages.test.ts 等未跑但与本批无关）