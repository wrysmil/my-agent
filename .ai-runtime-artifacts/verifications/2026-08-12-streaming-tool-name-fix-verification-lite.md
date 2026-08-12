# 2026-08-12 streaming 期间 toolName 缺失 fix — verification-lite

## 现象

- 用户报告：write_file 工具执行很久时，左侧 trace bubble 里工具名"写文件"**直接为空**；
  要到工具执行结束（tool_result 事件到达）才出现工具名。

## 根因

`web/src/features/chat/useChatStream.ts` 的 SSE `tool_use` 事件处理 (line 836+)：
- 部分 tool_use 增量事件 `innerData.name` 为空字符串（后端 `tool_use_delta`
  SSE 帧不带 name 字段，参见 `src/web/server/routes/messages.ts` line 864-875）。
- 当 streaming 阶段第一个 tool_use 事件到来时，`tcIdx < 0`，走到 line 869
  `else if (toolId)` 分支 push 新 tool_call block ——此时 `toolName` 是 `''`。
- 后续 `tool_use` 事件（带 name 的 `tool_start`）进入 `tcIdx >= 0` 分支
  的 line 851 / 861 用 `toolName || tc.toolName` 兜底。如果事件来得太晚或
  出现竞态，name 长期为空。
- `tool_result` 事件路径 (line 891+) **原本只更新 status 字段，不补救 toolName**，
  所以工具执行结束后才补上。

## 修复

`web/src/features/chat/useChatStream.ts` line 902-909：

```ts
if (tcIdx >= 0) {
  const tc = blocks[tcIdx] as ToolCallBlock;
  blocks[tcIdx] = {
    ...tc,
    toolName: trToolName || tc.toolName,  // 兜底：tool_result 带 tool_name
    status: 'done',
  };
}
```

**原则**：tool_result 事件是工具调用生命周期里**最稳**的事件（必有 tool_use_id
与 tool_name），用它做最终兜底；streaming 期间 name 缺失会在 tool_result
落地时立刻补齐。

**未做**：未改后端 `tool_use_delta` SSE 帧（应补 name 字段）——那是后端
独立 fix，本验证只覆盖前端。

## 验证

### 自动测试

`tests/features/chat/trace-bubble-session-switch.test.tsx` 4/4 通过（含 reviewer Important #1
A→B→A 切换守卫）。`tests/features/chat/run-trace-panel.test.tsx` 26/26 通过。

`npx tsc --noEmit` 0 errors。

### 手动验证（Playwright）

- session `gconv-82443ac0706`：展开 trace 后 15 个 `<li>` 渲染，每个
  thinking step 显示「思考已完成」，tool step 显示「写入文件」「读取文件」
  等中文 actionLabel（来自 `TOOL_ACTION_LABELS`）。
- 由于当前 store 中没有 streaming 状态消息，无法直接复现"long write_file
  期间空白"；下次真实 streaming 时观察 toolName 是否在 tool_result 落地
  前已显示（如果仍空白，需进一步收紧 streaming 补救逻辑）。

## 改动文件

- `web/src/features/chat/useChatStream.ts`：tool_result handler 增加 toolName
  兜底更新。

## 不在范围内

- `runTrace.ts` 中 `TOOL_ACTION_LABELS` 补充常用工具中文映射（已在前一轮
  完成，无需回退）。
- `thinkingLabel` 文本（用户明确要求保留「思考已完成」不动，本轮未改）。