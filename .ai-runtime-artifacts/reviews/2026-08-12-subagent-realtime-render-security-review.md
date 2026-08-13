---
artifact: review
route: orchestration:dispatcher-workflow -> batch-closeout
skills:
  - requesting-code-review
  - security-and-hardening
skills_evidence:
  - .agents/skills/requesting-code-review/SKILL.md
  - .agents/skills/security-and-hardening/SKILL.md
source:
  - .ai-runtime-artifacts/plans/2026-08-12-subagent-realtime-render-plan.md
  - harness-kit/references/security-checklist.md
created_at: 2026-08-12
batch_id: subagent-realtime-render
worktree_id:
worktree_path:
reviewer_instance: security-auditor
verdict: APPROVE
---

# 子 Agent 实时渲染 — 安全审查

> **写入者：** Leader（收到 security-auditor 返回后落盘）。Auditor 为 readonly，不 Write 本文件。

## 审查范围

- 批次 `subagent-realtime-render` 4 个 WU 变更文件（SSE 事件源 / 前端路由 + 状态机 / MessageBubble / History 重建 + merge）
- OWASP Top 10 + LLM Top 10 + 全仓 XSS/注入面核查 + package.json 依赖核查

## Summary

- Critical: 0 | High: 0 | Medium: 0 | Low: 3 | Info: 1

## Findings

### [LOW] SSE 事件 payload 缺少运行时 schema 校验

- **Location:** `web/src/lib/sse.ts:98`（parseSseFrame JSON.parse）、`useChatStream.ts:1070-1077`（rawData.sessionId / innerData 取值）
- **Description:** data 任意 JSON 值直接 as 断言；`null` 时 `(null).sessionId` 抛 TypeError → 外层 catch 误判网络故障进入重试退避（最多 5 次 → run 判失败）。服务端信封始终为对象，实际仅在服务端误发畸形帧或同源污染时可达。
- **Impact:** 单帧畸形数据触发整 run 失败（LLM10 DoS-lite）或字段类型错乱造成 UI 状态不一致。无泄露、无代码执行。
- **Recommendation:** 消费边界增加 `typeof data === 'object' && data !== null` 守卫；对 WU-02 新增事件字段最小 runtime 类型守卫；畸形帧 `continue` 跳过。

### [LOW] worker/子 Agent 输出回灌 commander 上下文的 prompt injection 信任边界

- **Location:** `src/orchestration/dispatch.ts:268-291`、`src/orchestration/tools.ts:222,288`（dispatch_to/hand_off_to 将信封文本并入 tool content）
- **Description:** 子 Agent 输出经 XML 信封原样回灌指挥官；若 worker 被注入指令其输出可尝试引导指挥官。**设计层信任边界评估**，非本批代码缺陷。
- **Impact:** 指挥官模型可能把信封文本当指令。属产品编排语义固有风险，无代码层权限提升。
- **Recommendation:** 保持 XML 信封隔离 + DISPATCH_GUIDELINE/commander system prompt 显式声明信封内容为不可信数据；渲染层已由 sanitize 兜底。

### [LOW] `toolNameCache` 无上限 + `worker_text_delta` 未做长度约束

- **Location:** `useChatStream.ts:35`（模块级 Map 永不清空）、`my-agent-web.ts:202-209`（透传未截断）
- **Description:** toolNameCache 前端生命周期无限累积；worker_text_delta 无切片逐帧透传拼入气泡文本。
- **Impact:** 理论内存/渲染压力（LLM10 边界），无实际可利用路径。
- **Recommendation:** toolNameCache 设 cap（如 2000）；单步累积长度设上限（如 100KB）后截断。

### [INFO] `run_worker` 的 worker 工具事件仍经 SSE 转发至主 Agent trace

- **Location:** `bin/my-agent-web.ts:138-166`
- **Description:** run_worker 不 emit dispatch_started/dispatch_done（前端无气泡，worker_* 被静默丢弃——隐私正确），但其 worker 的 tool_start/tool_end 转为 tool_use/tool_result 出现在主 trace（截断 500 字符），与 spec 风险点 #3 一致。
- **Impact:** 无安全后果；是否完全不可见属产品功能决策。

### Positive Observations

- 无 `dangerouslySetInnerHTML`；AgentBubble/AgentStepRow 全部 JSX 文本插值（React 转义）
- Markdown 多层防护：react-markdown 默认不渲染 raw HTML + rehype-sanitize + urlTransform 白名单（仅 https:）
- SSE 序列化无帧注入：JSON.stringify 转义换行，event: 名来自 switch 字面量
- `run_worker` 隐私性正确（无气泡、worker 私有回复不展示）
- 后端 zod schema（StreamMessageSchema/AbortStreamSchema）+ assertPathSegment + 同 cid 409
- dispatchSlots 信号量限制嵌套并发（默认 4）；XML 信封 escape/unescape 往返一致
- 无新增依赖（package.json 无变更）；JSON.parse 是唯一反序列化入口，无 eval
- 日志不泄露正文（仅长度 + 匿名标识）

## 证据

- security-auditor 已读：sse.ts / useChatStream.ts / MessageBubble.tsx / Markdown.tsx / dispatch.ts / tools.ts / my-agent-web.ts / messages.ts 全量 + package.json
- ReadLints 无错误；依赖无变更

## 未验证项

- 无真实攻击测试；三条 Low 均为纵深防御改进项

## 结论

**verdict:** APPROVE（无 Critical/High/Medium，不阻塞发布）

## Next

- Low 项记录，可排入后续迭代
- APPROVE → 可合并/提测；更新 execution-log
