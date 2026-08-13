---
status: draft
approved: false
task: web 端注入调度工具使子 Agent 可用（与 CLI chat.ts 对齐）
date: 2026-08-12
---

# Verification Lite — Web 端子 Agent 编排（run_worker / dispatch_to / hand_off_to）

## 根因

CLI（`chat.ts`）在构建 `AgentRunner` 时注入了三件套：

- `TOOL_RESULT_TOOLS`（tool_result_search / tool_result_read_chunk）
- `buildDispatchTools()`（run_worker / dispatch_to / hand_off_to）
- `getToolsSystemPromptBlock` 渲染的工具列表 → 注入 system prompt

而 web 入口 `bin/my-agent-web.ts` 的 `runnerFactory` 只注入了 `BUILTIN_TOOLS`，既没有调度工具，system prompt 也不含工具列表。因此 web 端模型"不知道"存在子 Agent 工具，永远不派发子 Agent。

## 修复（`bin/my-agent-web.ts`）

1. 注入 `[...BUILTIN_TOOLS, ...TOOL_RESULT_TOOLS]` + 逐个 `runner.addTool(dispatchTool)`。
2. `buildDispatchTools({ onWorkerEvent })` 将 worker 的 `tool_start`/`tool_end` 转为
   `StreamEvent` 入 `workerQueue`；`runStream` 预取一个内层事件后**先排空 workerQueue**
   再 yield 内层事件，保证子 Agent 活动显示在 `run_worker` 工具结果之前。
   `tool_start`/`tool_end` 由 SSE 适配层（`messages.ts` `adaptStreamEventWithEnvelope`）
   映射为 `tool_use`/`tool_result` 帧，前端 `useChatStream.ts` 现有逻辑直接渲染。
3. 用 `buildSystemPrompt({ extraSystemPrompt: config.agent.systemPrompt, toolsBlock })`
   组合完整 system prompt（含全部 15 个工具），前端未显式传 `systemPrompt` 时注入。

## 验证命令

```powershell
Set-Location "d:\studyspace\project\my-agent"
npm run check            # 全量 tsc（含基线错误，bin 文件无新增错误）
npx vitest run test/orchestration        # 40/40 PASS
npx vitest run src/web/server/routes/messages.test.ts   # 31/31 PASS
```

## 结果

| 检查项 | 结果 |
|--------|------|
| tsc：`bin/my-agent-web.ts` 无类型错误 | PASS（其余为预存基线错误：runner.ts compactNow 重复等） |
| `test/orchestration`（tools/dispatch/agent-spec/actor） | 40/40 PASS |
| `src/web/server/routes/messages.test.ts` | 31/31 PASS |
| web server 启动冒烟（CI=1, port 4399） | PASS，日志 `工具:15个`（10 builtin + 2 tool-result + 3 dispatch） |
| POST `/api/sessions/:id/messages/stream` SSE 冒烟 | PASS，200，runner 构造成功并执行 LLM 调用（无 API key 属预期失败） |
| system prompt 渲染验证 | PASS：block 含 `run_worker` / `dispatch_to` / `hand_off_to` / `bash` |

## 手动复测建议

1. 配置 `DEEPSEEK_API_KEY`，启动 `npm run web`，打开 http://localhost:4321
2. 发消息「用 run_worker 派发 coder 子 Agent 写一个旅游主题 HTML 页面」
3. 预期：RunTrace 中先出现 `run_worker` 工具调用，随后出现子 Agent 内部的
   `tool_use`/`tool_result` 事件（带 `sub:` id），最后是 `run_worker` 结果
