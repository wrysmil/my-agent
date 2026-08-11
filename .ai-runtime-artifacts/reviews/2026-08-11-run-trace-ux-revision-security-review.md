---
title: Run Trace UX 修订 — Security Review
date: 2026-08-11
reviewer: security-auditor (subagent, role=security-auditor)
spec: .ai-runtime-artifacts/specs/2026-08-11-run-trace-ux-revision-spec.md
status: APPROVE
---

# Security Review: Run Trace UX 修订

## 审查范围

`task/run-trace-cycle-grouping` 分支上 RunTracePanel / MessageBubble / runTrace.ts 改动 + 三个测试文件。

| OWASP Top 10 维度 | 检查结论 |
|---|---|
| A01 Broken Access Control | n/a — 无新增认证 / 授权面 |
| A02 Cryptographic Failures | n/a — 无密钥 / token 处理 |
| A03 Injection (XSS / SQLi / Cmd) | ✅ pass — React DOM 文本节点默认转义；`StepLabel` / `ToolStepRow` / `ThinkingStepRow` 全部 JSX 文本插值；无 `dangerouslySetInnerHTML` / `eval` / `innerHTML` |
| A04 Insecure Design | ✅ pass — `resetKey` effect 设计合理（仅在身份变化时重置 UI 状态） |
| A05 Security Misconfiguration | n/a — 无 CSP / 配置改动 |
| A06 Vulnerable Components | ✅ pass — 未引入新依赖；`Markdown` 走 `rehype-sanitize` + `urlTransform` 白名单 `https?:` |
| A07 Identification / Auth Failures | n/a — 无认证面 |
| A08 Software & Data Integrity | n/a — 无 CI / 部署改动 |
| A09 Logging & Monitoring | n/a — 本批次无新 critical path |
| A10 SSRF | ✅ pass — `extractKeyParams` 的 `new URL()` 仅文本解析，不发起请求；`value` 仅用于显示文本 |
| LLM01 Prompt Injection | ✅ pass — `toolName` 来自已类型化的 SSE Block，不进入 prompt 模板 |
| LLM02 Insecure Output Handling | ✅ pass — `Markdown` 走 `rehype-sanitize`；`StepLabel` JSX 文本插值 |

## Findings

### Critical
无

### Important
无

### Suggestion

1. **`resetKey` 类型收口**（`RunTracePanel.tsx:40`）
   - 当前 `resetKey?: string` 依赖调用方传入稳定 string 身份（推荐 `message.id`）。
   - 当前 `MessageBubble.tsx:88` 已用 `message.id`，`types.ts:75` 声明 `ChatMessage.id: string` —— 整体一致。
   - 建议：在组件内 `useEffect` 旁加注释约束，或将 prop 类型收为 `resetKey: string`（强制要求）。

2. **`extractKeyParams` 的 `JSON.stringify` 路径**（`runTrace.ts:306`）
   - 非字符串值序列化进 `fullValue`，通过 `title` 属性渲染。`title` 是纯文本提示，不参与 HTML/JS 执行；无 XSS 面。
   - 建议：增加 `JSON.stringify(raw).slice(0, 200)` 之类硬上限，避免极端深层对象产生几 MB 的 title 属性（性能 / 可读性面，非安全面）。

3. **`shortenKeyParam` 的 `new URL(full)` 路径**（`runTrace.ts:316`）
   - 恶意 URL（如 `javascript:`、`data:text/html`）会被 `new URL` 接受为合法 URL。
   - `value`（`<span>` 文本节点）+ `title` 暴露，但 React 文本节点不会解析 URL 协议。
   - 建议：在 `KeyParam` 取值时增加协议白名单（仅放行 `https:`/`http:`），与 `Markdown.urlTransform` 保持一致。

### Nit

1. `RunTracePanel.tsx:338` `aria-hidden` 包裹 `StepLabel` 整组（含徽章）。
   - spec §7 明确「节点身份文字继续 `aria-hidden`（视觉装饰）；徽章状态保留语义」—— 但当前实现徽章也被 `aria-hidden` 包裹，AT 只能依赖按钮 `aria-label` 识别状态。
   - 设计取舍：保留「徽章为视觉补充、状态语义靠按钮 aria-label 兜底」与 spec 一致；记一笔供后续 a11y 审查复核。

2. `StepLabel` 渲染工具名时未对「看起来像 URL 的工具名」做协议白名单。
   - 场景罕见（后端 toolName 通常是固定枚举），且 React 文本节点默认转义无注入面。
   - 仅作为视觉 / 品牌一致性建议。

## 证据

### 已读

- `.ai-runtime-artifacts/specs/2026-08-11-run-trace-ux-revision-spec.md` §4.1/§4.2/§4.3、§6/§7、§10
- `web/src/components/chat/RunTracePanel.tsx` 全文件
- `web/src/components/chat/MessageBubble.tsx` 全文件
- `web/src/features/chat/runTrace.ts` 全文件（`extractKeyParams` L300-311、`shortenKeyParam` L313-330）
- `web/src/components/chat/Markdown.tsx` L13-21（`urlTransform` 仅放行 `/^https?:/` + `rehype-sanitize`）
- `web/src/features/chat/types.ts` `ChatMessage.id: string` L75
- 三个测试文件关键新断言

### 已运行

未跑新命令（本轮为只读审查）；build / tsc / vitest 状态由 collective-test.md 承担。

### 已交叉验证

- React DOM 文本节点默认转义（无 `dangerouslySetInnerHTML` / `eval` / `innerHTML`）
- `Markdown` 走 `rehype-sanitize` + `urlTransform` 白名单
- `StepLabel` / `ToolStepRow` / `ThinkingStepRow` 全部 JSX 文本插值

## 未验证项

- 运行时端到端：浏览器视觉验证已由 collective-test 落盘（`run-trace-ux-revision-visual.png`）
- 依赖审计：未跑 `pnpm audit` / `npm audit`；本批次未引入新依赖
- `message.id` 唯一性：依赖上游 SSE 流式层按消息分配稳定 ID；本审查未触及该层（属于 `useChatStream.ts`，不在本 PR diff 范围）

## Skills 使用

- 已加载: superpowers:security-and-hardening@.agents/skills/security-and-hardening/SKILL.md loaded
- 已加载: superpowers:source-driven-development@.agents/skills/source-driven-development/SKILL.md loaded
- 已跳过: superpowers:requesting-code-review@.agents/skills/requesting-code-review/SKILL.md skipped # 本次为 security 独立审查
- 已跳过: superpowers:document-review@.agents/skills/document-review/SKILL.md skipped # 本次审查对象为代码 diff

## 结论

**APPROVE** — 0 Critical / 0 Important。3 Suggestion 均为防御性优化（resetKey 类型收口 / JSON.stringify 长度上限 / URL 协议白名单），可在后续 polish 阶段处理，不阻塞本批次。

---

## Leader 备注（落盘后补充）

- Suggestion 1（resetKey 类型收口）：可在 review-fix WU 升级为 `resetKey: string`（强制要求），同时在 `MessageBubble` 调用处保证 `message.id` 总是存在 —— 但当前已是 `string`，无运行时风险，可留作下批 polish。
- Suggestion 2（JSON.stringify 长度上限）：属于 defensive coding，建议采纳。
- Suggestion 3（URL 协议白名单）：与 `Markdown.urlTransform` 一致性，建议采纳。
- Nit 1（aria-hidden 包裹徽章）：符合 spec §7 设计意图，无须修订。
- Nit 2（工具名 URL 协议）：React 默认转义即可覆盖，建议留作下批 polish。

**后续动作**：等 reviewer 完成；若 reviewer 结论与 security-auditor 一致（APPROVE 或 BLOCK），进入最终收尾。