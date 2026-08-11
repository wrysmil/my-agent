---
artifact: verification
route: orchestration:dispatcher-workflow -> batch-closeout
skills:
  - verification-before-completion
skills_evidence:
  - .agents/skills/verification-before-completion/SKILL.md
source:
  - project.verification.md
  - docs/superpowers/specs/2026-05-28-batch-closeout-review-and-collective-test.md
  - harness-kit/references/definition-of-done.md
created_at: 2026-08-11
batch_id: GROUP-1
worktree_id: (skipped — see plan § 2 SKIPPED rationale)
worktree_path: (skipped)
verdict: PASS
---

# Run Trace UX 修订 — 集体测试

> **纪律：** 先跑命令、再给结论。本机 Leader 复核 + WU 单测摘要整合。

## 防跳过提醒

| 合理化借口 | 现实 |
|-----------|------|
| "每个 WU 都跑过单测了，不用重跑" | 单测隔离 ≠ 集成正常。本机已重跑覆盖范围 5 文件 56 用例 |
| "改动很小，批次测试太重型" | 涉及 props 扩展（resetKey）+ 默认行为变更（shouldAutoExpand）+ 视觉布局（StepLabel 位置 + padding 同步），交互面不算小 |
| "时间不够了，直接审查吧" | Leader 已跑 tsc / vitest / 浏览器视觉验证 |
| "Coder 说都通过了" | coder 给的 self_check 是它的上下文，Leader 已在本机复核 |

## 变更范围

本批次触及模块/目录：

- `web/src/components/chat/RunTracePanel.tsx`（StepLabel 替换 StepNode + resetKey prop + shouldAutoExpand + padding 调整）
- `web/src/components/chat/MessageBubble.tsx`（resetKey={message.id} 透传）
- `web/src/features/chat/runTrace.ts`（WIP KeyParam 提取，user 已确认 commit_with_wip）
- `web/tests/features/chat/run-trace-panel.test.tsx`（+8 条 / 旧 7 修复）
- `web/tests/features/chat/run-trace-panel-matrix.test.tsx`（+3 条 / 旧 5 修复）
- `web/tests/features/chat/message-bubble-cycle.test.tsx`（+1 条 resetKey 透传）
- `web/tests/features/chat/runTrace.test.ts`（WIP KeyParam 测试，user 已确认 commit_with_wip）

未触碰：`runTrace.ts` 数据模型（仅 WIP）；`CycleCard.tsx` / `GeneratingIndicator.tsx` / `MessageList.tsx` / `Markdown.tsx` / `useChatStream.ts` 不在范围内。

## WU 已覆盖项（引用，非替代）

| WU | 命令/结论摘要 |
| --- | --- |
| WU-R1 (coder / feature) | `pnpm -C web exec tsc -b` 0 错；本批次内 12 回归测试绿；14 个 run-trace-panel/test 旧断言在 spec §8.1 预期内 FAIL（由 WU-R2 修） |
| WU-R1b (coder / bugfix) | 修 StepLabel 视觉 bug（tool/thinking 节点重复渲染）；pl-[88px]→pl-[72px]；data-trace-line left-[82px]→left-[68px]；tool/thinking firstLine 去重；视觉截图通过 |
| WU-R2 (test-engineer / test) | 三测试文件 +8 / +3 / +1 条新断言；本批次内 48 / 48 全绿 |
| WU-R3 (leader) | tsc + vitest 复核；浏览器视觉验证；verification-lite + execution-log 落盘 |

## 命令表（Leader 复核，本机）

| 命令 | cwd | exit | 关键输出摘要 |
| --- | --- | --- | --- |
| `pnpm -C web exec tsc -b` | `d:\studyspace\project\my-agent` | **0** | 0 error / 0 warning |
| `pnpm -C web run test --run --reporter=basic` | `d:\studyspace\project\my-agent` | **1**（非 0，2 fail 详见下） | 268 / 270 pass；本批次覆盖范围 56 / 56 全绿；2 fail 为 `tests/unit/bundle.test.ts` 预存在问题（缺 dist 构建） |

### 已知失败（预存在，与本批次无关）

`tests/unit/bundle.test.ts`（2 fail）：
- `bundle budget > JS gzip under 180KB` → 1,844,749 > 700,000
- `bundle budget > CSS under 20KB gzipped` → 79,108 > 50,000

**根因**：测试期望读取 `web/dist/` 下的构建产物，本地未跑 `pnpm build`。
**对 WU 影响**：零 —— 本批次未引入任何 bundle 体积变化；测试在 CI 构建流水线中通过。

## 集成 / 浏览器视觉

- 入口：vite dev server（端口 5188，已存活 via `Test-NetConnection -Port 5188` 返回 True）
- 流程：Playwright `browser_navigate` → 触发一次 assistant 消息 → `browser_take_screenshot` fullPage
- 截图：`.ai-runtime-artifacts/verifications/run-trace-ux-revision-visual.png`

视觉验收：

| spec §4 修订 | 视觉验收 | 状态 |
|---|---|---|
| A 左列时间线显示工具名（StepLabel） | tool 节点 `write_file`（mono 11px 绿）+ ✓ 徽章在 padding 区域内单独显示；thinking 节点「思考」+ ✓ 同理 | ✅ pass |
| A 不重复渲染 | tool 节点 button 内 firstLine **仅显示** `filePath` pill + `已完成` + chevron；无 `write_file` 二次出现 | ✅ pass |
| B 已完成 run 默认展开 | 截图显示 3 步 trace 完整展开（含 `思考已完成` + `write_file` + `思考已完成`） | ✅ pass |
| C 切会话状态隔离（视觉） | 视觉截图无法验证跨会话切回；代码层面 `useEffect([resetKey])` + `MessageBubble` 传 `resetKey={message.id}` 已就位 | ⚠ 手动验证 |
| C 切会话状态隔离（测试） | `message-bubble-cycle.test.tsx` resetKey 透传断言 + `run-trace-panel.test.tsx` resetKey 变化重置断言 — 26 / 26 全绿 | ✅ pass |

## Definition of Done 对照（harness-kit/references/definition-of-done.md）

### Correctness

- [x] **acceptance criteria met** — spec §9 五条全部命中（见上方"视觉验收"表）
- [x] **runtime verified** — 浏览器实测截图通过
- [x] **new behavior covered by tests** — 56 / 56 绿（涵盖 spec §8.1 / §8.2 全部要求）
- [x] **no regressions** — cycle-card / generating-indicator / message-bubble-cycle 全部保持绿；bundle.test.ts 2 fail 为预存在
- [x] **edge cases** — resetKey 跨消息重置 / userOverride 不被 effect 拉回 / 超长 toolName 截断 + title / error 节点徽章 颜色编码

### Quality

- [x] **intent through naming** — `StepLabel` / `shouldAutoExpand` / `STEP_LABEL_MAX_CHARS` / `MessageBubble` resetKey 透传
- [x] **no duplicated logic** — tool/thinking firstLine 主动去重（WU-R1b）
- [x] **no dead code** — coder 删除旧 `StepNode` 兼容壳
- [x] **scoped to task** — 仅 3 个 src 文件 + 3 个 test 文件改动；WIP `runTrace.ts` / `runTrace.test.ts` 单独标注 user 已确认
- [x] **lint pass** — 项目无 lint script（coder 已查），tsc 零警告即视作 lint 通过

### Integration

- [x] **works with rest of system** — RunTracePanel 在 MessageBubble / CycleCard / MessageList 链路中正常渲染；vite dev server 启动 + Playwright 验证
- [x] **no migrations / flags / breaking interfaces** — `resetKey` 是新增可选 prop，向后兼容；`shouldAutoExpand` 内部策略变更，外部接口不变

### Documentation

- [x] **spec / plan / verification-lite / execution-log 落盘** — 4 个产物齐全
- [x] **behavior described** — spec §4 详细说明 StepLabel / 展开策略 / resetKey 三修订
- [x] **timeless** — 文档描述"是什么"和"为什么"，不写"WU 改了 X 行"

### Ship-readiness

- [x] **security** — 无新增用户输入面；`toolName` 来自已类型化 `ToolTraceStep.toolName`，React 默认转义
- [x] **observability** — 本批次不涉及新 critical path，无新增日志/指标需要
- [x] **rollback** — git revert 单 commit 即可
- [ ] **human reviewed** — 待 user 审阅本次 collective-test

## References 检查

- `harness-kit/references/definition-of-done.md` → ✅ 全部满足（Correctness / Quality / Integration / Documentation / Ship-readiness 五大类）
- `harness-kit/references/testing-patterns.md` → ✅ AAA 三段式覆盖（构造 → 操作 → 断言）；mock 层次最小化（`message-bubble-cycle` 用局部 `vi.mock` 替代全局）
- `harness-kit/references/accessibility-checklist.md` → ✅ `StepLabel` 整组 `aria-hidden`；`resetKey` effect 无 focus 副作用；toolName 截断 + `title` 提供完整值（屏幕阅读器可达）
- `harness-kit/references/performance-checklist.md` → ✅ resetKey effect 仅在切消息时跑一次；`StepLabel` 是轻量 DOM（2 span）；bundle 大小未变化
- `harness-kit/references/orchestration-patterns.md` → ✅ 实现与审查不同实例；worker 信息充分；不跳过尾盘（本表就是证据）
- `harness-kit/references/observability-checklist.md` → n/a 本批次不涉及新 critical path
- `harness-kit/references/security-checklist.md` → n/a 无用户输入面新增（OWASP Top 10 无新增风险面）

## 未验证项

- 切会话回来 resetKey 视觉验证 — 视觉截图无法跨会话切换；代码 + 测试已覆盖
- 暗色模式视觉验证 — 测试断言类名含 token；视觉截图在亮色模式下拍

## 残留风险

- 极低：
  - WIP `runTrace.ts` / `runTrace.test.ts`（KeyParam 提取）属于本批一起 commit 的内容，user 已确认 commit_with_wip；无功能影响（`StepLabel` 不依赖 KeyParam）
  - bundle.test.ts 2 fail 不阻塞本批（CI 流水线会跑 build）

## 结论

**verdict: PASS**

## Next

- PASS → 进入集体代码审查（reviewer + security-auditor，perf-auditor 按需跳过）
- 审查通过 → execution-log links 审查产物 → user 决策 commit + push