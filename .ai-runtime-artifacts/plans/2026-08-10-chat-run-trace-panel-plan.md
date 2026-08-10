---
artifact: implementation-plan
route: superpowers:writing-plans
skills:
  - writing-plans
  - api-and-interface-design
  - frontend-ui-engineering
skills_evidence:
  - "skipped: writing-plans (SKILL.md 未安装于 ~/.cursor/skills 与 ~/.agents/skills；按 plan.harness-overlay.md 契约撰写)"
  - .agents/skills/api-and-interface-design/SKILL.md
  - .agents/skills/frontend-ui-engineering/SKILL.md
dispatch: .ai-runtime-artifacts/plans/2026-08-10-chat-run-trace-panel-dispatch.md
source:
  - .ai-runtime-artifacts/specs/2026-08-10-chat-run-trace-panel-spec.md（approved: true）
  - .ai-runtime-artifacts/specs/2026-08-10-chat-run-trace-panel-mockup.html（用户确认「可以的这个效果」）
  - .ai-runtime-artifacts/contracts/2026-08-10-contract-run-trace.md
  - harness-kit/references/definition-of-done.md
  - harness-kit/core/routing.md § WU 编排硬触发
  - web/src/components/chat/*、web/src/features/chat/types.ts
created_at: 2026-08-10
status: approved
approved: true
approved_by: 用户（2026-08-10）：选择「就按这个执行图开始实现」
tier: 2
---

# Chat Run Trace 过程面板实施计划

## 1. Goal

把 assistant 消息里的「多个折叠卡 + 嵌套滚动」重构为**单一 Run Trace 过程面板**（一行摘要 + 一条 timeline，工具调用与结果并成一行），最终答案移出过程容器并获得最高视觉权重。行为口径以已批准 spec 的 § 4/§ 6/§ 7 与静态草图为准。

**不做**（spec § 10）：不改 SSE / JSONL 协议、不改 `chatRuntimeStore`、不做右侧 sidebar、不改答案 Markdown 渲染、不持久化展开状态。

## 2. Architecture

```text
MessageBubble（WU-04 接线）
├─ user 分支：保持现有右侧轻量气泡
└─ assistant 分支
   ├─ RunTracePanel（WU-02）      ← trace: RunTraceViewModel
   │  ├─ 摘要行 button（aria-expanded / aria-controls）
   │  └─ <ol> timeline：ThinkingTraceStep | ToolTraceStep
   ├─ FinalMarkdown（复用现有懒加载 Markdown，移到过程容器外）
   └─ MessageActions（复制、usage 入口）

派生：buildRunTrace(blocks, { isStreaming, streamState, aborted }) → RunTraceViewModel（WU-01，纯函数）
样式：globals.css 新增 timeline / reduced-motion / focus 基础类（WU-03）
```

数据流单向：`blocks`（既有真相源）→ 纯函数派生 → 展示组件。**不**新增 store、不写回 Zustand、不引入新依赖。

## 3. Tech Stack（实测）

| 项 | 值 | 证据 |
| --- | --- | --- |
| 前端 | React + TypeScript + Vite | `web/package.json` |
| 样式 | Tailwind v4 `@theme` token（`bg-surface`、`border-border/80`、`text-text-muted/70`、`text-danger/80`） | `web/src/styles/globals.css:21-37` |
| 图标 | `lucide-react` 命名导入 | `web/src/components/chat/MessageBubble.tsx:2` |
| 测试 | vitest + @testing-library/react | `web/tests/unit/message-copy.test.tsx:1-2` |
| 验证脚本 | `test: vitest run`、`build: tsc -b && vite build`；**无** lint / typecheck script | `web/package.json:5-12` |
| reduced-motion | 已有全局 `animation:none` 处理，需沿用 | `web/src/styles/globals.css:601-611` |

## 4. 既有基线（不得混淆为本次回归）

`web/tests/unit/bundle.test.ts` 两条预算用例在改动前已失败：raw JS `1,835,422 > 700,000`、raw CSS `75,505 > 50,000`（证据：`.ai-runtime-artifacts/verifications/2026-08-10-chat-session-stream-isolation-fix-collective-test.md:45-55`）。本批次要求：**不使这两个数字变差**，且不新增其它失败。

## 5. WU 拆解与 Task 细步

并行执行图见 `2026-08-10-chat-run-trace-panel-dispatch.md`。每个 WU 的 done criteria 来源均标注为 `DoD-<段>`（`harness-kit/references/definition-of-done.md`）或 `spec-<条>`（spec § 8 验收标准）。

### WU-01 派生层 `runTrace.ts`（coder，TDD）

文件：`web/src/features/chat/runTrace.ts`（新增）、`web/tests/features/chat/runTrace.test.ts`（新增）

1. 先写失败测试：call/result 按 `toolCallId` 配对成一步；孤儿 result 仍单独成步；相邻 thinking 合并且 `mergedCount` 累加；被工具隔开的 thinking 不合并；`text` 不进 steps。
2. 补摘要文案测试：`正在思考` / `正在执行 {actionLabel}` / `正在整理回答` / `正在准备` / `已停止 · 保留 N 个步骤` / `完成，但有 N 个步骤失败` / `已完成 N 个步骤 · M 个工具`（契约 § 4 全表）。
3. 实现 `buildRunTrace` / `hasTraceSteps` / `toolActionLabel`，并把 `formatDuration`（`ToolResultBlock.tsx:12-17`）、`formatInputPreview`（`ToolCallBlock.tsx:11-23`）**迁移**过来（原实现在 WU-04 随组件下线，不留双份）。
4. 不修改 `types.ts`；仅 `import type`。

Done：契约 § 2/§ 3/§ 4/§ 5 全部导出齐备且语义符合；新测试全绿（`DoD-Correctness`、`spec-2`、`spec-7`）。

### WU-02 `RunTracePanel` 组件族（coder）

文件：`web/src/components/chat/RunTracePanel.tsx`（新增，可拆 `runTrace/` 子文件）、`web/tests/features/chat/run-trace-panel.test.tsx`（新增）

1. 摘要行：原生 `button` + `aria-expanded` + `aria-controls`；状态图标与文字双通道（不靠颜色单独表达）；右侧计数 `tabular-nums` + 14px chevron。
2. timeline：`<ol>/<li>`，一层 `rounded-xl` + `surface-hover/30` + 细 border；左侧虚线贯穿图标中心；行高 36–40px、字号 12–13px；**禁止** `max-height + overflow-y`。
3. 步骤行：左图标 / 中「动作标题 + 更浅参数摘要」/ 右「计数或状态 + chevron」；工具行与 thinking 行均支持二次展开详情（详情用现有 JetBrains Mono）。
4. 自动展开策略（spec § 4.3）：运行中且无最终 text 默认展开；出现 text 不突然折叠；完成且用户未手动操作则折叠；`hasFinalText=false` 且 `errorCount>0` 默认展开；历史（`isStreaming=false`）默认折叠；用户手动切换后本生命周期不再被自动覆盖。
5. `hasTraceSteps(trace) === false` 时返回 `null`，不渲染空容器。
6. 组件测试：多 thinking 只有一个顶层摘要按钮；运行中默认展开 / 历史默认折叠；手动切换不被覆盖；error 与 aborted 摘要文案；空 trace 不渲染；`aria-expanded` 切换与键盘 Enter/Space 可操作。

Done：上述测试全绿；无内部滚动条；props 严格等于契约 § 6（`DoD-Correctness`、`DoD-Quality`、`spec-1`、`spec-3`、`spec-6`、`spec-8`）。

### WU-03 timeline 视觉与 a11y 基础（implementer）

文件：`web/src/styles/globals.css`

1. 新增 timeline 所需最小工具类（虚线竖线、节点圆点、行 hover），命名与现有约定一致，不改动既有 token 值。
2. 把新增动画纳入既有 `prefers-reduced-motion` 段（`:601-611`），确保展开/chevron 旋转在 reduced-motion 下即时切换。
3. 确认 focus-visible 焦点样式在过程面板按钮上可见。

Done：`npx tsc -b` 与既有样式相关测试不回归；reduced-motion 下无高度/旋转动画（`DoD-Quality`、`spec-8`）。

### WU-04 `MessageBubble` 接线与旧组件下线（coder）

文件：`web/src/components/chat/MessageBubble.tsx`；删除 `ProcessTracker.tsx`、`ActivityStrip.tsx`、`ThinkingBlock.tsx`、`ToolCallBlock.tsx`、`ToolResultBlock.tsx`（含未被引用的 `StreamIndicator.tsx` 一并核查）；按需调整 `web/tests/unit/message-copy.test.tsx`

1. assistant 分支改为：`RunTracePanel` → 最终 Markdown（移出强卡片边框）→ MessageActions。
2. `buildRunTrace` 入参从现有 props 取：`message.blocks`、`isStreaming`、`message.streamState`；aborted 由 `MessageList` 现有 `status` 判断下传。
3. `ThinkingDots` 仅在完全无 trace step 且流式时作为极短暂 fallback。
4. usage 默认不展示，改为开发/高级信息入口（spec § 4.4），不删数据。
5. 删除旧组件后全仓搜索残留 import，确保无死码（`DoD-Quality`）。
6. 保证复制按钮契约不变：`navigator.clipboard.writeText(textContent)`（`web/tests/unit/message-copy.test.tsx:15-21`）。

Done：`message-copy` 与 `chat-session-stream-isolation` 全绿；`npx tsc -b` 通过；无残留 import（`DoD-Correctness`、`DoD-Integration`、`spec-10`）。

### WU-05 测试矩阵补齐（test-engineer）

文件：`web/tests/features/chat/run-trace-panel-matrix.test.tsx`（新增）

1. 五类消息形态：无工具、仅 thinking、仅最终 text、工具失败、abort（`spec-7`）。
2. 历史恢复与实时流使用同一展示结构：复用 history 聚合用例的 blocks 顺序 `thinking → tool_call → tool_result → text`，断言只有一个 assistant 气泡 + 一个 trace panel（`spec-5`、`spec-1`）。
3. a11y：`aria-expanded`、具体标签（如「查看 web_fetch 结果」）、键盘操作（`spec-8`）。
4. 响应式：320 / 768 / 1024 宽度下不产生横向溢出的断言口径（以容器类与 `overflow` 断言，不做像素快照）（`spec-9`）。

Done：新增用例全绿且在移除实现后会失败（`DoD-Correctness` 的「fail without the change」）。

## 6. 验证命令（PowerShell 5）

```powershell
Set-Location "d:\studyspace\project\my-agent\web"
npx vitest run tests/features/chat/runTrace.test.ts
npx vitest run tests/features/chat/run-trace-panel.test.tsx tests/features/chat/run-trace-panel-matrix.test.tsx
npx vitest run tests/unit/message-copy.test.tsx tests/features/chat/chat-session-stream-isolation.test.tsx tests/features/chat/chatRuntimeStore.test.ts
npx tsc -b
npm test
```

尾盘 `npm test` 允许的唯一失败为 § 4 的两条 bundle 预算用例，且数字不得变差。

## 7. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 删除旧组件导致其他页面编译失败 | WU-04 内先全仓搜索 import，再删；`npx tsc -b` 作为门禁 |
| 自动展开策略与用户手动操作打架 | 组件内部单一 `userOverride` 标志；WU-02 用例固化优先级 |
| 工具名中文映射膨胀成散落魔法串 | 映射与截断只在 `runTrace.ts`，组件不得内联文案（契约 § 5） |
| bundle 预算本已超标，新增组件继续推高 | WU-02 复用现有依赖、不引新库；尾盘对比 raw JS/CSS 数字 |
| aria-live 播报被 token 流淹没 | 只播报摘要行状态，不播报完整 reasoning（spec § 7） |

## 8. References 检查

| Reference | 结论 |
| --- | --- |
| `definition-of-done.md` | pass — 每个 WU 的 done criteria 均标注 `DoD-<段>` 来源；Correctness/Quality 逐 WU 生效，Integration/Documentation 与 Ship-readiness 在尾盘统一对照 |

## 9. Plan 自检

- [x] 有已批准 spec 与用户确认的视觉稿作为依据
- [x] 接口边界先落契约（`contracts/2026-08-10-contract-run-trace.md`）再拆 WU
- [x] 每个 WU 文件清单互不重叠，GROUP-2 两个 WU 可真并行
- [x] 每个 WU 都有可执行验证命令与 done criteria 来源
- [x] 既有失败基线已记录，避免误判回归
- [x] 未在本轮修改任何业务代码

## Next

**（计划已写入，本轮暂停）**

- 计划确认 → 说「开始实现」或「并行执行」
- 需要调整 WU 拆分或并行策略 → 直接说修改意见
- 想合并 WU 少开几轮 → 说「合并成两批」
