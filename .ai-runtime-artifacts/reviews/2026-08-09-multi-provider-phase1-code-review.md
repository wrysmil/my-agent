---
artifact: code-review
source: .ai-runtime-artifacts/plans/2026-08-09-multi-provider-adaptation-plan.md
created_at: 2026-08-09
verdict: REQUEST_CHANGES
---

# 阶段 1 代码审查报告

## 总体评价

架构分层清晰（AbstractLLMProvider → ContentBlockCodec → ThinkingAdapter），测试覆盖彻底（211 新用例）。发现 2 个 Critical + 4 个 Important 需要修复。

## Critical

### C1: `CompletionParams.reasoning` 类型不匹配
- **文件：** `src/providers/deepseek.ts:112`、`src/providers/base.ts:27`、`src/providers/types.ts:10`
- **问题：** `CompletionParams.reasoning` 含 `"minimal"`，但 `ReasoningLevel` 不含。`as ReasoningLevel` 强转会导致 `"minimal"` 被静默传入 API → 400 错误
- **修复：** 从 `CompletionParams.reasoning` 移除 `"minimal"`，或加入 `ReasoningLevel`

### C2: `complete()` 丢弃 reasoning_content
- **文件：** `src/providers/deepseek.ts:355-358`
- **问题：** 非流式路径不提取 `message.reasoning_content`，思考内容丢失
- **修复：** 使用 `this.thinkingAdapter.extractFromResponse(message)` 提取

## Important

### I1: `parseStreamChunk` 抽象契约未被实际使用
- **文件：** `src/providers/base.ts:80`
- **问题：** DeepSeekProvider 和 MockProvider 都实现为空 generator，stream() 完全覆写
- **修复：** 将 stream() 改为模板方法，或从抽象类移除 parseStreamChunk

### I2: `outbound()` role 硬编码
- **文件：** `src/providers/codecs/openai-completions.ts:66-127`
- **问题：** text/image 硬编码 `role: "user"`，依赖调用方正确处理上下文
- **修复：** 文档化约束或添加 role 参数

### I3: `classifyRetryableError` 未排除 CapabilityUnsupportedError
- **文件：** `src/shared/errors.ts:212-216`
- **问题：** CapabilityUnsupportedError 会被误判为可重试（fallthrough → "network"）
- **修复：** 加入排除列表

### I4: `complete()` 返回类型未使用 CompletionResult
- **文件：** `src/providers/deepseek.ts:337`
- **问题：** 内联类型替代了类型别名，后续字段变更不会触发类型错误
- **修复：** 声明为 `Promise<CompletionResult>`

## Suggestions (5 项，略)

## Verdict: REQUEST_CHANGES（2 Critical 必须修复后方可合并）
