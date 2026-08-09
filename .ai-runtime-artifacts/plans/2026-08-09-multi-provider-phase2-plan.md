---
artifact: plan
source: .ai-runtime-artifacts/specs/2026-08-09-multi-provider-adaptation-spec.md
created_at: 2026-08-09
phase: 2
scope: 多厂商 Provider 扩展 — Anthropic + OpenAI
---

# Phase 2：多厂商 Provider 扩展计划

## 目标

在 Phase 1 基础设施（AbstractLLMProvider + ContentBlockCodec + ThinkingAdapter）之上，新增 2 个 Provider：
1. **AnthropicProvider**（anthropic-messages 协议）—— 需要新建 Codec + ThinkingAdapter
2. **OpenAIProvider**（openai-completions 协议）—— 复用既有 Codec，极薄包装

验证：新增一个同协议厂商只需 ~30 行（OpenAIProvider），新增一个异协议厂商只需 ~200 行（AnthropicProvider）。

---

## WU 分解

### WU-01：AnthropicMessagesCodec

**文件：** `src/providers/codecs/anthropic-messages.ts`（新建）

**内容：**
- `api = "anthropic-messages"`
- `buildTools(tools)` — ToolDefinition → Anthropic `{name, description, input_schema}` 格式
- `mapStopReason(reason)` — `end_turn`/`max_tokens`/`stop_sequence`/`tool_use` → StopReason
- `outbound(block)` — MessageContent → Anthropic content block：
  - `text` → `{type: "text", text}`
  - `image` → `{type: "image", source: {type: "base64", media_type, data}}`（vision 守门）
  - `thinking` → `{type: "thinking", thinking, signature}` — 保留 `thinkingSignature`
  - `tool_use` → `{type: "tool_use", id, name, input}`
  - `tool_result` → `{type: "tool_result", tool_use_id, content}`
- `inbound(message)` — Anthropic content block → MessageContent[]
- **注意**：Anthropic 没有 `role` 在 outbound 单块上；role 由 provider 的 `convertMessages` 按整个 message 设置

**测试：** `test/providers/codecs/anthropic-messages.test.ts`
- buildTools 格式验证
- mapStopReason 5 种映射
- outbound text/image/thinking/tool_use/tool_result 块转换
- vision 守门：capabilities.vision=false 时抛 CapabilityUnsupportedError
- outbound thinking 保留 signature
- inbound 各种 content block → MessageContent

### WU-02：AnthropicThinkingAdapter

**文件：** `src/providers/thinking/anthropic-messages.ts`（新建）

**内容：**
- `api = "anthropic-messages"`
- `extractFromRequest(reasoning)` — ReasoningConfig → `{thinking: {type: "enabled", budget_tokens: N}}`：
  - `off` → `{}`
  - `minimal` → `budget_tokens: 1024`
  - `low` → `budget_tokens: 4096`
  - `medium` → `budget_tokens: 8192`
  - `high` → `budget_tokens: 16000`
- `extractFromResponse(message)` — Anthropic content block → ThinkingContent：
  - 匹配 `{type: "thinking", thinking, signature}`
  - 提取 signature 存入 thinkingSignature
- `reconcileForReplay(prev, targetApi)` — 跨 api 签名兼容：
  - targetApi === "anthropic-messages" → 保留原 signature
  - targetApi === "openai-completions" → 去掉 signature（OpenAI 不认识）
  - 其他 → null

**测试：** `test/providers/thinking/anthropic-messages.test.ts`

### WU-03：AnthropicProvider

**文件：** `src/providers/anthropic.ts`（新建）

**内容：**
- `extends AbstractLLMProvider`
- `id = "anthropic"`, `name = "Anthropic"`
- 构造：`apiKey` + `baseUrl`（默认 `https://api.anthropic.com/v1`）
- `buildRequestBody(params)`：
  - `system` 字段（不是 messages[0]）
  - `messages` 通过 `convertMessages`（内部方法）构建
  - `tools` 通过 codec.buildTools
  - `thinking` 通过 thinkingAdapter.extractFromRequest
  - `max_tokens`, `stop_sequences`, `stream: true`
- `stream(params)` — SSE 流式：
  - Anthropic SSE 格式：`event: <type>\ndata: <json>\n\n`
  - 事件类型：message_start / content_block_start / content_block_delta / content_block_stop / message_delta / message_stop / ping
  - 增量聚合：text / thinking / tool_use input_json
  - content_block_start 记录签名（thinking.signature）
  - 产出 StreamEvent 序列：message_start → thinking_delta → text_delta → tool_use_start/delta/end → message_end
- `complete(params)` — 非流式路径，`stream: false`
- `classifyError(err)` — 错误归一化
- `validateAuth()` — GET `/v1/messages` 轻量 ping（或 models list）
- `headers()` — `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-beta: ...`（如需要）
- `convertMessages(messages, systemPrompt?)` — Message[] → Anthropic messages 格式：
  - systemPrompt → 顶层 `system` 字段
  - user/assistant/tool 消息 → role + content[] 数组
  - Anthropic 不支持独立 tool role，tool_result 嵌在 user 消息中

**测试：** `test/providers/anthropic.test.ts`

### WU-04：OpenAIProvider

**文件：** `src/providers/openai.ts`（新建）

**内容：**
- `extends AbstractLLMProvider`，**复用 OpenAiCompletionsCodec + OpenAiCompletionsThinkingAdapter**
- `id = "openai"`, `name = "OpenAI"`
- 构造：`apiKey` + `baseUrl`（默认 `https://api.openai.com/v1`）
- `buildRequestBody` / `stream` / `complete` / `classifyError` / `convertMessages` ≈ DeepSeekProvider 但 baseUrl 不同
- 差异点：
  - Temperature 处理可能有细微差异
  - 错误消息格式可能不同
  - baseUrl 默认 `https://api.openai.com/v1`

**测试：** `test/providers/openai.test.ts`

### WU-05：注册 codec + thinking adapter + 导出

**文件修改：**
- `src/providers/codecs/index.ts` — 不修改（codec 注册是全局 Map，provider 构造时自动注册）
- `src/providers/index.ts` — 添加 `export { AnthropicProvider }` + `export { OpenAIProvider }`

### WU-06：集体测试 + 回归验证

**内容：**
- 全量 `npm test` 验证无回归
- TypeScript 编译检查
- 新增 provider 的测试全部通过

---

## 协议差异速查

| 维度 | openai-completions | anthropic-messages |
|---|---|---|
| 消息格式 | `{role, content: string}` | `{role, content: [{type, ...}]}` |
| 系统提示 | messages[0] role=system | 顶层 `system` 字段 |
| 工具 | `{type: "function", function: {...}}` | `{name, description, input_schema}` |
| 工具结果 | role=tool, tool_call_id | user 消息内嵌 tool_result block |
| 思考 | `reasoning_content` 字段 | thinking content block + signature |
| 思考请求 | `reasoning_effort` | `thinking: {type, budget_tokens}` |
| 流式 | `data: <json>\n\n` (SSE) | `event: <type>\ndata: <json>\n\n` |
| 停止原因 | `stop`/`length`/`tool_calls`/`content_filter` | `end_turn`/`max_tokens`/`stop_sequence`/`tool_use` |
| 认证头 | `Authorization: Bearer <key>` | `x-api-key: <key>` |

## 代码量预估

| 文件 | 预估行数 |
|---|---|
| `codecs/anthropic-messages.ts` | ~150 |
| `thinking/anthropic-messages.ts` | ~60 |
| `providers/anthropic.ts` | ~400 |
| `providers/openai.ts` | ~80 |
| 测试文件 ×4 | ~500 |
| **合计** | **~1200** |
