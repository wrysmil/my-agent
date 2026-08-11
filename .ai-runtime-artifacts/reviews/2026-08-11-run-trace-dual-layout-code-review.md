---
artifact: review
route: orchestration:dispatcher-workflow -> batch-closeout
skills:
  - requesting-code-review
  - code-review-and-quality
  - verification-before-completion
source:
  - .ai-runtime-artifacts/specs/2026-08-11-run-trace-dual-layout-spec.md
  - .ai-runtime-artifacts/plans/2026-08-11-run-trace-dual-layout-plan.md
  - .ai-runtime-artifacts/plans/2026-08-11-run-trace-dual-layout-dispatch.md
  - .ai-runtime-artifacts/verifications/2026-08-11-run-trace-dual-layout-collective-test.md
  - .ai-runtime-artifacts/verifications/2026-08-11-wu02-session-switch-verification.md
created_at: 2026-08-11
reviewer: generalPurpose (29e37721-7bc8-483b-826f-6f250056a46e)
verdict: APPROVE
---

# Run Trace v4 集体代码审查

> **纪律：** reviewer 是 readonly agent；本文件由 Leader 落盘 reviewer 返回结果。
> **reviewer 已加载：** requesting-code-review + code-review-and-quality + verification-before-completion

## 1. 审查结论

**APPROVE** — v4 双布局 + 切会话 bug 复盘交付整体通过。

## 2. 证据汇总

| 维度 | 命令 | 结果 |
| --- | --- | --- |
| TypeScript | `pnpm -C web exec tsc -b` | exit 0, 0 errors |
| Vitest | `pnpm exec vitest run tests/features/chat/` | 8 files / 137 tests passed (2.88s) |
| Build | `pnpm -C web run build` | exit 0, dist 生成（CSS 79.50KB / gzip 13.23KB；main JS 1.83MB / gzip 449.92KB） |
| 重命名彻底性 | `grep CycleCard web/src` | 0 匹配 |
| 重命名彻底性 | `grep CycleCard web/tests` | 1 行（trace-bubble.test.tsx:5 历史注释，可接受） |

## 3. 五轴审查（reviewer 报告）

| 轴 | 评价 |
| --- | --- |
| 正确性 | spec §9 7 项验收全过；边界处理完整（空消息、resetKey 透传、lazy Markdown + Suspense） |
| 可读性 | TraceBubble 33 行极简；MessageBubble 132 行分支清晰（user vs assistant） |
| 架构 | 3 个 WU-01 偏离决策均有合理理由（见 §5） |
| 安全 | 无新引入输入路径；Markdown 渲染走既有 react-markdown |
| 性能 | 切消息时外层 key 变化 → TraceBubble remount（spec §10 已确认可接受） |

## 4. Findings

### Critical（0）
无

### Important（1）

**I-1. 下批必须补「切会话守卫」回归测试**

- **来源**：WU-02 不可复现结论评审
- **理由**：当前"切会话后 trace-bubble 计数恒为 1 + 灰底 rgb(241,242,244) 颜色断言"是可观察但未固化的行为；真实 LLM 流可能触发 spec §11 风险点 #3（H3 消息累积），但 mock store 路径不会触发
- **建议**：在 `chat-session-stream-isolation.test.tsx` 或新加 `trace-bubble-session-switch.test.tsx` 加 1-2 个守卫 case
- **状态**：**下批必须做**，不阻塞本批
- **跟踪**：记入下批 plan（不在本次 commit 范围内）

### Suggestion（2）

**S-1. TraceBubble 无 border 引发"双层容器"概念**

- **现状**：spec §2 目标写"有边框"，但 spec §4.2 属性表字面未列 border。WU-01 选择字面执行（按表）—— 实际 RunTracePanel 内层已有 `border border-border/80 bg-white` + 紫色侧条
- **建议**：下批二选一简化：(a) 移除 RunTracePanel 内层 border/白底，让 TraceBubble 作为唯一视觉单元（外层加 border + 灰底）；或 (b) 删 TraceBubble 外层灰底，让 RunTracePanel 直接外露
- **状态**：不阻塞，下批处理

**S-2. MessageBubble 外层 `flex-row` 与 spec §4.3 字面 `flex flex-col items-stretch` 偏离**

- **理由**：复制按钮 line 121 `ml-2 mt-1 self-start opacity-0 group-hover:opacity-100` 必须与气泡同一外层 flex 行才能 hover 显示
- **建议**：下批在 spec §4.3 加一句「外层保留 `flex-row` 是为了复制按钮的 group-hover 行为；`flex-col` 仅作用于 assistant 内容列内」
- **状态**：不阻塞，下批处理

### Nit（2）

**N-1. MessageBubble.tsx:86 `RunTracePanel key={message.id}` 内层 key 是冗余**

- **理由**：外层 TraceBubble 已用 `key={`${message.id}-trace`}`，父层 key 变化已强制整个子树重建
- **状态**：当前不影响功能；下批顺手清

**N-2. trace-bubble.test.tsx:5 注释保留 CycleCard 旧名**

- **理由**：历史注释（"v4 CycleCard → TraceBubble"）
- **状态**：可接受；下批清理

## 5. WU-01 偏离决策评审

| 偏离 | 决策 | 评审结果 |
| --- | --- | --- |
| TraceBubble 无 border | 按 spec §4.2 表字面执行（spec §2 目标"有边框"与表字面缺失 border 是 spec 内部矛盾） | **APPROVE**（视觉等价；RunTracePanel 内层 border 已存在） |
| MessageBubble 外层 `flex-row items-start` + 内层 `flex-col items-stretch` 双层 | 保留外层 `flex-row` 以支持复制按钮 group-hover 同行显示 | **APPROVE**（偏离字面但保留关键 UX） |
| v3.1 `key={message.id}` 内层保留 | 与 v4 外层 `${message.id}-trace/-final/-gen` 共存 | **APPROVE**（冗余但无害；resetKey 是独立保险） |

## 6. WU-02 不可复现结论评审

- **复现脚本充分性**：充分但有限（mock store 路径，未覆盖真实 LLM 流）
- **systematic-debugging Phase 1-3**：完整执行（3 轮 A↔B↔A × 6 步 + 7 采样点 + 5 假设排查全不命中）
- **是否需防御代码**：**否**。spec §4.4.3 明确「不要编造修复」；当前 sessionId 隔离 + `key={sessionId}` 强制 remount + `parseHistoryMessages` 唯一 ID 已构成多层保险
- **是否需守卫测试**：**是**（同 I-1）。当前行为可观察但未固化，下批必须补
- **评价**：WU-02 拒绝修复是**有据可循的正确决策**，不是"懒得修"

## 7. 结论

**verdict: APPROVE**

- tsc 0 / 137 tests / build 0
- spec §9 7 项验收全过
- 3 个 WU-01 偏离决策均有合理理由
- WU-02 不可复现结论有据可循
- 1 Important + 2 Suggestion + 2 Nit 均非阻塞

**本批可进入 Leader commit 阶段。**

## 8. 后续跟踪

| 项 | 处理时机 | 记录位置 |
| --- | --- | --- |
| I-1 切会话守卫测试 | 下批 spec/plan 阶段明确列入 | 新 spec/plan |
| S-1 双层容器简化 | 下批改进 | 同上 |
| S-2 spec §4.3 说明补充 | 下批 spec 更新 | 同上 |
| N-1/N-2 Nit 清理 | 下批顺手做 | 同上 |