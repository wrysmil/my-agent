# 2026-08-12 tool steps 消失 — fix

## 用户报告

1. "工具执行过程好多都不见了，最后甚至所有的工具都没有了"
2. "write_file 工具执行很久时，左侧 trace bubble 里工具名直接为空"

## 修复一：write_file 执行期间工具名为空（前端）

**根因**：`web/src/features/chat/useChatStream.ts` 的 SSE `tool_use` handler
(line 836+) 当 streaming 首个 `tool_use` 事件到达且 `innerData.name` 为空
（后端 `tool_use_delta` SSE 帧不带 name 字段）时，新建 tool_call block
`toolName=''`，要等 tool_result 事件到达才补上。

**修复**：`tool_result` handler (line 902-909) 增加
`toolName: trToolName || tc.toolName` 兜底。

## 修复二：压缩后 tool blocks 永久丢失（后端）

**根因**：`src/agent/session.ts` 两层 compaction 触发后，原始
`tool_use` / `tool_result` blocks 被**永久替换**为 summary text：

- `applyHistorySummary` (line 711-748)：被压缩 turn 的所有 messages
  被替换为 1 条 user summary message
- `applyActiveCheckpointSummary` (line 784-835)：当前 turn 跳过所有
  原始消息，只保留 1 条 `[Active checkpoint summary (epoch N)]: ...`

实证：`gconv-6473fd92d10a` turn 1 的 assistant message 只剩 1 个
text block（active checkpoint summary），原始 tool blocks 永久丢失。

**修复**：改造两个 `applyXxxSummary` 让原始 messages **保留在 messages 数组**
中，但**统一打 `compactionIdentityAnchor: true` 标记**：

```ts
// applyActiveCheckpointSummary (line 822-829)
if (msg !== originalClientMessage) {
  if (!msg.compactionIdentityAnchor) {
    result.push({ ...msg, compactionIdentityAnchor: true });
  } else {
    result.push(msg);
  }
}
```

```ts
// applyHistorySummary (line 732-736) —— 同理
} else if (msg.role !== "user" && !msg.compactionIdentityAnchor) {
  result.push({ ...msg, compactionIdentityAnchor: true });
}
```

**关键链路保证**（无需前端改动）：

| 路径 | 行为 |
|---|---|
| `getMessagesForModel` (line 395) | `filter(m => !m.compactionIdentityAnchor)` —— LLM 仍只看 summary，不增加 token 压力 |
| `estimateModelTokens` (line 450) | `if (msg.compactionIdentityAnchor) continue;` —— token 估算准确 |
| `getPendingActiveCheckpoint` (line 765) | 排除 marker 消息 —— 压缩候选空，不会重复压缩 |
| `getPendingHistoryArchive` (line 683) | 排除 marker 消息 —— 不会重复压缩 |
| `messageToSerialized` / `serializedToMessage` | 序列化 marker 字段 ✓ |
| `flushMessagesToDisk` | 整盘重写 messages（含 marker 块）—— history 文件保留完整 blocks |
| history endpoint → 前端 `parseHistoryMessages` | 不知道 `compactionIdentityAnchor`，**所有 blocks 都进入 ChatMessage.blocks** → TraceBubble 渲染完整 tool steps |

**结论**：LLM 看到 summary（节省 token），history / UI 看到完整 tool_use
+ tool_result blocks（trace bubble 工具步骤保留）。

## 限制

- **已有 sessions**：被旧版压缩过的 turn blocks **永久丢失**（JSONL 文件
  里就没了）。需要**新建会话**触发新压缩才能看到修复效果。
- **重跑历史 compaction**：可通过 `POST /api/sessions/:id/compact` 手动
  触发，但当前实现仍是 destructive（见 `compactNow` line 634-666）。
  本轮未重做 compactNow 的双轨化（不影响自动 compaction 路径）。

## 验证

### 自动测试

- `tests/features/chat/run-trace-panel.test.tsx` 26/26 ✓
- `tests/features/chat/trace-bubble-session-switch.test.tsx` 4/4 ✓
- 后端 `npx tsc --noEmit` 无新增错误（历史错误是项目已有，与本次无关）

### 手动验证（待重启 backend）

1. 后端服务（PID 50932）需要重启加载新源码
2. 新建会话触发长工具执行 → 验证 streaming 期间工具名显示 ✓
3. 触发 active checkpoint summary（执行大量工具）→ 验证 complete 后
   trace bubble 仍显示完整 tool steps

## 改动文件

- `src/agent/session.ts`：两个 `applyXxxSummary` 函数改为保留原始
  messages + 标记 `compactionIdentityAnchor`，不再 destructive 替换
- `web/src/features/chat/useChatStream.ts`（前一轮）：tool_result
  handler 增加 toolName 兜底