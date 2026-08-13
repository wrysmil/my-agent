---
artifact: review
route: orchestration:dispatcher-workflow -> batch-closeout
skills:
  - requesting-code-review
  - orchestration
skills_evidence:
  - .agents/skills/requesting-code-review/SKILL.md
  - .agents/skills/orchestration/SKILL.md
source:
  - .ai-runtime-artifacts/plans/2026-08-12-subagent-render-plan.md
  - .ai-runtime-artifacts/plans/2026-08-12-subagent-render-dispatch.md
  - .ai-runtime-artifacts/verifications/2026-08-12-subagent-render-collective-test.md
created_at: 2026-08-12
batch_id: GROUP-1
worktree_id: n/a
worktree_path: n/a（主 checkout 直接执行：bin/my-agent-web.ts 有上批未提交基线改动）
reviewer_instance: reviewer + security-auditor（并行扇出）
verdict: APPROVE
---

# 子 Agent 调度渲染 集体代码审查

> **写入者：** Leader（收到 reviewer / security-auditor 返回后落盘）。

## 防跳过提醒

| 合理化借口 | 现实 |
|-----------|------|
| "都是自己人写的，放心" | 信任 ≠ 不审查。本批仍独立派发了 reviewer + security-auditor 双实例 |

## 审查范围

- 文件列表（`git status --short` / `git diff` 未提交改动，全部为本批 WU-01~WU-05 产物）：
  - 后端：`src/shared/types.ts`、`src/orchestration/dispatch.ts`、`src/orchestration/tools.ts`、`bin/my-agent-web.ts`、`src/web/server/routes/messages.ts`、`src/prompts/dispatch-guideline.ts`（新）、`chat.ts`
  - 前端：`web/src/features/chat/types.ts`、`web/src/features/chat/useChatStream.ts`、`web/src/features/chat/runTrace.ts`、`web/src/components/chat/RunTracePanel.tsx`、`web/src/components/chat/MessageBubble.tsx`、`web/src/lib/sse.ts`
  - 测试：`test/orchestration/{dispatch,tools}.test.ts`、`test/prompts/dispatch-guideline.test.ts`、`src/web/server/routes/messages.test.ts`、`web/tests/features/chat/{runTrace.test.ts,use-chat-stream-agent-message.test.ts,run-trace-panel.test.tsx,message-bubble-agent.test.tsx}`、`web/tests/unit/sse.test.ts`

## 变更尺寸评估

| 指标 | 值 | 判定 |
|------|----|------|
| 变更行数 | ~700（跨 4 个 WU 批次累计） | 按 WU 拆分审查，每个 WU ≤200 |
| 变更文件数 | 17 生产/测试文件 | 分 5 个 WU 分别审查 |

## 对照依据

- spec：`.ai-runtime-artifacts/specs/2026-08-12-subagent-render-spec.md`（§4.1-4.5 / §5 / §7 / §8）
- plan：`.ai-runtime-artifacts/plans/2026-08-12-subagent-render-plan.md`
- done criteria：WU-01~WU-06 全部 `done_criteria_met: 是`

## Findings

### Critical

- 无

### Important（尾盘已修复）

1. **chat.ts:434 `undefined` 拼接**（reviewer + security 双实例点名）：
   `opts.config.agent.systemPrompt + "\n\n" + DISPATCH_GUIDELINE`，systemPrompt 为 `z.string().optional()` 且无默认值 → 未配置自定义 prompt 时 CLI 提示词含字面量 `"undefined"`。
   → **已修复**：改为 `[opts.config.agent.systemPrompt, DISPATCH_GUIDELINE].filter(Boolean).join("\n\n")`，与 `bin/my-agent-web.ts` 守卫语义一致。验证：后端 `npm run check` 零新增（chat.ts 无新错）。

2. **endTurn 时序断言缺失 + verification-lite 声称不实**：plan WU-6 / spec §7.2 要求「agent_message 帧在 done 前输出」断言，WU-06 未落实且 verification-lite 声称已覆盖（不实）。
   → **已修复**：`messages.test.ts` 新增「agent_message 帧在 tool_result 之后、done 之前输出」用例（34/34 通过）；verification-lite 措辞更正（SSE 层时序已锁测试；bin prefetch+drain 为结构走查确认）。

### Suggestion（已采纳）

3. **stripWorkerEnvelope 误剥风险**（reviewer Minor #4 + security Minor #2）：`runTrace.ts` 对**所有**工具结果应用 strip，普通工具（read_file/bash）输出形似 `<worker-result>` 时会被误剥。
   → **已修复**：仅 `run_worker` 走 strip；dispatch_to/hand_off_to 走简短确认；其余工具保留原文。前端 runTrace 42/42 + run-trace-panel 27/27 通过。

### 记录在案（接受，不改）

- **agent_message 帧字段 camelCase vs 兄弟帧 snake_case**：与 `usage` 帧同为 camelCase，协议本就混合；前后端 `SseAgentMessageData` 镜像一致，无功能 bug。未来统一协议时可整体迁移。
- **run_worker 子 Agent 内部 tool 事件 trace 可见**：spec §4.2 已接受（透明度设计取舍，tool_end 截断 500 字符限流）。
- **前后端 strip/unwrap 各持一份等价实现**：跨进程边界共享不现实，各自单测锁定语义。
- **`actorToolStacks` 只增不减 / `subSeq` 递增**：per-request 作用域无泄漏，id 唯一性有防御。
- **`agent_message.text` 无长度上限**：与 `text_delta` 一致，非本批新增风险。

## 结构疗法建议

| 重构模式 | 适用场景 | 建议 |
|---------|---------|------|
| 类型边界显式化 | useChatStream agent_message 分支用 `as` 绕过联合收窄 | 后续批次用 `innerData.type` 判空收窄（Nit，不阻塞） |
| 抽取辅助函数 | `my-agent-web.ts` runStream prefetch+drain 逻辑无单测 | 后续可抽成可测纯函数（已记录为 open_items） |

## 死代码 / 孤儿代码检查

- [x] 重构后无未引用的函数/类型/文件（`DISPATCH_GUIDELINE` 双端引用；`unwrapWorkerPayload` 被 tools.ts 引用；`stripWorkerEnvelope` 被 runTrace 引用）
- [x] 无注释掉的代码块
- [x] 旧实现已替换（字符串前缀语义被 agent_reply 替代，commander content 保留前缀为显式决策）

## 证据

- Reviewer：五轴走查 + 独立复跑后端 72/72、前端 84/84
- Security-Auditor：OWASP 检查项逐条（XSS 同管线 rehypeSanitize / XML 正则不可绕过 / run_worker 不触发 agent_reply）+ markdown-xss 5/5、runTrace 42/42、dispatch 22/22、tools 13/13
- Leader 尾盘复跑：后端 messages.test.ts 34/34（含新时序用例）、前端 tsc -b 零错 + runTrace/run-trace-panel 69/69

## 未验证项

- 真实 LLM + 真实子 Agent 端到端运行（需 API key）——命令级验证已覆盖契约，运行时冒烟留用户
- bin `prefetch+drain` 未单元化（结构走查确认，记录 open_items）

## 结论

**verdict: APPROVE**（2 项 Important 尾盘已修复并重验；安全审查无 Critical/Important）

## Next

- APPROVE → 更新 DISPATCH-TRACK / execution-log；批次完成声明
- 用户可选：启动 `npm run web` 冒烟实测子 Agent 调度渲染
