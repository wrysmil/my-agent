---
artifact: security-review
source: .ai-runtime-artifacts/plans/2026-08-09-multi-provider-adaptation-plan.md
created_at: 2026-08-09
verdict: PASS
---

# 阶段 1 安全审查报告

## 总体评估：PASS

Phase 1 变更中未发现 Critical 或 High 级漏洞。

## 正面发现

1. **API key 生命周期安全**：key 存储为 private field，`formatError` 避免原始错误泄漏，`fetchWithErrorHandling` 正确分类 401/403
2. **Vision 守门**：codec.outbound 在 image 块处检查 capabilities.vision，无绕过路径
3. **validateAuth 默认 false**：安全的默认值，未覆写的 provider 不会意外通过认证
4. **HTTP 边界**：fetch URL 使用模板字面量拼接已知 baseUrl，无路径穿越风险

## Medium 发现（建议修复）

### M1: CapabilityUnsupportedError.providerId 使用协议名
- **文件：** `src/providers/codecs/openai-completions.ts:78-81`
- **问题：** `throw new CapabilityUnsupportedError(..., this.api)` — providerId 得到 `"openai-completions"`（协议名）而非 `"deepseek"`（提供商名）
- **建议：** CapabilityUnsupportedError 接收实际的 provider ID

### M2: CompletionParams 缺少运行时校验
- **文件：** `src/providers/deepseek.ts:112`
- **问题：** `params.reasoning as any` 绕过类型检查，恶意/错误输入可能传入 API
- **建议：** 添加 reasoning 值的运行时校验（白名单）

### M3: devDependencies 已知漏洞
- **问题：** npm audit 可能报告 dev 依赖漏洞
- **建议：** 定期 `npm audit fix`

## Verdict: PASS（3 Medium 非阻塞，建议在后续迭代修复）
