---
artifact: implementation-plan
route: superpowers:writing-plans
skills:
  - api-and-interface-design
  - frontend-ui-engineering
  - frontend-design
skills_evidence:
  - "skipped: writing-plans (未安装于 ~/.cursor/skills 与 ~/.agents/skills；按 plan.harness-overlay.md 契约撰写)"
  - .agents/skills/api-and-interface-design/SKILL.md
  - .agents/skills/frontend-ui-engineering/SKILL.md
  - .agents/skills/frontend-design/SKILL.md
dispatch: .ai-runtime-artifacts/plans/2026-08-11-run-trace-typography-dispatch.md
source:
  - .ai-runtime-artifacts/specs/2026-08-11-run-trace-typography-redesign-spec.md（approved: true）
  - .ai-runtime-artifacts/specs/2026-08-10-chat-run-trace-panel-spec.md（approved: true，沿用 §4 自动展开 / a11y）
  - .ai-runtime-artifacts/contracts/2026-08-10-contract-run-trace.md（沿用）
  - 视觉方案 A：.superpowers/brainstorm/run-trace-typography/content/structure-vs-style.html
  - harness-kit/references/definition-of-done.md
  - harness-kit/core/routing.md § WU 编排硬触发
created_at: 2026-08-11
status: draft
approved: true
approved_by: 用户（2026-08-11）：「并行执行」
branch: task/run-trace-typography
base: feature/chat-run-trace-panel
tier: 2
---

# Run Trace 排版与字体优化 — 实施计划

## 1. Goal

承接已批准 spec，按方案 A（统一信息卡 + 关键参数 pill + 错误整行红茶色）实施。**不改 SSE / JSONL / 状态机 / 摘要行 / 折叠行为 / 旧组件**。重构限度严格限制在 `runTrace.ts` 派生层 + `RunTracePanel.tsx` 组件层 + 对应测试。

## 2. Architecture

```text
RunTracePanel
├─ 摘要行（沿用现有，不动）
└─ <ol class="…"> timeline
   └─ TraceRowCard（新增）         ← props: step, firstLine, secondLine?, detailPre?
      ├─ 左侧 StepNode（沿用）
      ├─ firstLine  ← 动作名 + 关键参数 pill + inputPreview + 状态 + chevron
      ├─ secondLine ← 预览行（tool.resultPreview / thinking.showPreview）
      └─ detailPre  ← 展开后 <pre>（沿用现有）

派生：runTrace.ts
├─ KeyParam / extractKeyParams（新增）
├─ ToolTraceStep.keyParams（新增，可选）
└─ buildRunTrace 在 tool_call 段调用 extractKeyParams
```

数据流单向：`blocks` → `buildRunTrace` → `RunTracePanel`。**不**新增 store、不写回 Zustand、不引入新图标库。

## 3. Tech Stack（实测，沿用上一批次）

| 项 | 值 | 证据 |
| --- | --- | --- |
| 前端 | React + TypeScript + Vite | `web/package.json` |
| 样式 | Tailwind v4 `@theme` token（`bg-surface`、`border-border`、`border-primary/20`、`bg-primary/10`、`text-danger`、`bg-danger-bg`） | `web/src/styles/globals.css:21-49` |
| 图标 | `lucide-react` 命名导入 | `web/src/components/chat/RunTracePanel.tsx:11-18` |
| 测试 | vitest + @testing-library/react | `web/tests/features/chat/runTrace.test.ts:1-8` |
| 验证 | `npx vitest run`、`npx tsc -b` | `web/package.json:5-12` |

## 4. 既有基线（不得混淆为本次回归）

| 项 | 当前值 | 证据 |
| --- | --- | --- |
| `runTrace.test.ts` 用例数 | 24 | `.ai-runtime-artifacts/verifications/2026-08-10-chat-run-trace-panel-collective-test.md` |
| `run-trace-panel.test.tsx` 用例数 | 13 | 同上 |
| `run-trace-panel-matrix.test.tsx` 用例数 | 10 | 同上 |
| `chat-session-stream-isolation.test.tsx` | 既有 | 同上 |
| 既有未提交 stash | `stash@{0}`（仅 feature 分支，不在本任务） | `git stash list` |

本批次要求：**不**让以上数字变差；新测试覆盖 spec § 7.2 列出 8–12 条。

## 5. WU 拆解与 Task 细步

执行图见 `2026-08-11-run-trace-typography-dispatch.md`。每个 WU 的 done criteria 来源均标注为 `DoD-<段>`（`harness-kit/references/definition-of-done.md`）或 `spec-<条>`。

### WU-01 派生层 `extractKeyParams`（coder，TDD）

文件：`web/src/features/chat/runTrace.ts`（新增 `KeyParam` / `extractKeyParams` / `shortenKeyParam`），`web/tests/features/chat/runTrace.test.ts`（新增 4–6 case）

1. 先写红→绿测试：
   - url 主机名 + 长 path 截断（`<= 24` 字符）；
   - url 解析失败时退化为纯截断（≤ 40）；
   - `filePath` / `path` 仅保留文件名（`split(/[\\/]/).pop()`），长文件名截断；
   - `query` / `command` 截断至 40 字符；
   - 仅识别 § 5.1 列出的 5 个 key（`url / filePath / query / command / path`），其他 key 忽略；
   - 输入同时含 5 个 key 时输出前 2 个 + `extraKeyCount=3`。
2. 实现 `extractKeyParams(input?: Record<string, unknown>): KeyParam[]`：
   - `KEY_PARAM_ORDER = ['url', 'filePath', 'query', 'command', 'path']`；
   - `KEY_PARAM_MAX = 2`；
   - `value` 走 `shortenKeyParam(key, full)`，`fullValue` 为原始字符串供 `title`；
   - 非 string 输入用 `JSON.stringify` 兜底。
3. 在 `buildRunTrace` 内的 `tool_call` 分支计算 `keyParams: extractKeyParams(block.input)`，写入 step；`inputPreview` 保留（fallback）。

Done：`runTrace.test.ts` ≥ 30 case 全绿；24 个旧 case 不变（`DoD-Correctness`、`spec-7`）。

### WU-02 `RunTracePanel` 组件族改造（coder）

文件：`web/src/components/chat/RunTracePanel.tsx`，`web/tests/features/chat/run-trace-panel.test.tsx`

1. 抽取 `<TraceRowCard>` 组件（spec § 6.1）：
   - props：`step`、`detailOpen`、`onToggleDetail`、`firstLine`、`secondLine?`、`detailPre?`；
   - 容器样式：成功态 `border-border bg-surface`，错误态 `border-danger/40 bg-danger-bg`（`text-danger-bg` 在 `globals.css:31` 浅色 `#fef2f2` / 深色 `#490202`）；
   - 取代 `TimelineItem` 内的「虚线 + 节点 + 内容」结构；
   - 保留 `StepNode` / `data-trace-line` 不动。
2. 工具行（`ToolStepRow`）主行 JSX 重写（spec § 6.2）：
   - 动作名 13px `font-medium text-text`；
   - 关键参数 pill `rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[11.5px] text-primary`；
   - `+N` 溢出提示在 pill 之后；
   - `inputPreview` 走 `min-w-0 flex-1 truncate` 兜底；
   - 状态位 `text-text-muted` / `text-danger`；chevron 沿用。
3. 工具行 `<pre>` 错误时切换为 `border-danger/20 bg-danger/5 text-danger/90`（沿用既有）。
4. Thinking 行（`ThinkingStepRow`）改为调用 `TraceRowCard`，移除 `border-primary/45 bg-primary/5` 紫框；保留 `focus-visible:ring-primary/40`。
5. 预览行（secondLine）按 spec § 4.3 实现：tool 看 `resultPreview`，thinking 看 `showPreview`；错误时 `text-danger/70`。
6. 行为不变：折叠 / 自动展开 / `openStepIds` Set / `userOverride` / 键盘 Tab 与 Enter 全部沿用。

Done：现有 13 个 `run-trace-panel.test.tsx` 用例的视觉 class 断言更新到位；新增 4 个用例（spec § 7.2）。

### WU-03 视觉与 a11y 基础（implementer）

文件：`web/src/components/chat/RunTracePanel.tsx`（pill `aria-label`）

1. 给 pill 添加 `aria-label="{key}={fullValue}"`，让屏幕阅读器读出完整键值；
   - 也可加 `title` 属性给鼠标 hover（两条都给，互不冲突）。
2. 不新增 CSS；不动 `globals.css` 任何 token 值。
3. 沿用既有 `prefers-reduced-motion` 段（`globals.css:601-611`）覆盖 chevron 旋转。

Done：TypeScript 仍通过；既有 reduced-motion 测试不回归（`DoD-Quality`、`spec-8`）。

### WU-04 视觉回归与浏览器快照（test-engineer）

文件：`web/tests/features/chat/run-trace-panel-matrix.test.tsx`（追加 4 case）

1. 新增窄屏（`width: 360px`）下工具行不出现横向滚动的断言（`scrollWidth === clientWidth`）；
2. 新增错误态 tooltip / aria：tool 错误行按钮带 `aria-label`、状态文本 `text-danger`；
3. 新增键盘 Enter 切换展开；
4. 新增 pill 渲染断言：tool 行带 url 时渲染 `kbd` 风格 pill，title 含完整 URL。

Done：新增 4 个全绿且在移除实现后会失败（`DoD-Correctness` 的「fail without the change」）。

### WU-05 文档与产物（implementer）

文件：无业务代码；产物在 `.ai-runtime-artifacts/`

1. 写执行日志 `.ai-runtime-artifacts/execution-logs/2026-08-11-run-trace-typography-execution-log.md`：包含 WU-01~04 返回摘要、最终命令记录、verify-before-completion 命令证据；
2. 同步把 spec 落地文件的 `status: approved`、`approved: true` 字段写入（用户批准后由 Leader 改）；
3. 不需要修改 contract 文件（spec 与现有 contract 兼容）。

Done：执行日志含 `### References 检查` 与 `### TDD 门禁` 段（`DoD-Documentation`）。

## 6. 验证命令（PowerShell 5）

```powershell
Set-Location "d:\studyspace\project\my-agent\web"
npx vitest run tests/features/chat/runTrace.test.ts
npx vitest run tests/features/chat/run-trace-panel.test.tsx tests/features/chat/run-trace-panel-matrix.test.tsx
npx vitest run tests/features/chat/chat-session-stream-isolation.test.tsx tests/unit/message-copy.test.tsx
npx tsc -b
npm test
```

每条 WU 派发前由 Leader 在 dispatch 文件中根据 `wu_skills: auto` 解析并下发 `verification-before-completion` 提醒。

## 7. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 视觉断言 class 改动漏掉旧测试 | WU-02 一次性 `git grep -nE 'bg-primary/5'` 检索所有断言，全量更新 |
| 派生层 `extractKeyParams` 输入非 string 时崩溃 | WU-01 分别覆盖 string / number / object / undefined；`JSON.stringify` 兜底 |
| pill 与 `inputPreview` 同时出现造成行拥挤 | 优先用 pill：`inputPreview` 仅在 `keyParams.length === 0` 时显示；行为在 WU-02 单测固化 |
| 错误态 `bg-danger-bg` 在深色主题下对比度过低 | WU-04 显式断言深色 + 浅色两个主题；必要时把底色改深色为 `bg-danger/10`（spec § 4.4 备选） |
| 上一批 stash 污染本任务 | `git stash list` 监控；本任务不执行 `git stash pop` |

## 8. References 检查

| Reference | 结论 |
| --- | --- |
| `definition-of-done.md` | pass — Correctness 走 WU-01/02 单测；Quality 走 WU-03 a11y；Integration 在尾盘集体测试；Documentation 走 WU-05 |
| `testing-patterns.md` | pass — 沿用 AAA 模式；Mock 仅有 `userEvent.setup()`，不引入新 mock |
| `orchestration-patterns.md` | pass — 本批次 GROUP 拓扑见 dispatch（GROUP-1 派生层 → GROUP-2 组件 + a11y 串行 → GROUP-3 矩阵与文档串行） |

## 9. Plan 自检

- [x] 有已批准 spec 与用户确认的视觉方案 A
- [x] 接口边界先落派生层（`extractKeyParams`）再动组件
- [x] 每个 WU 文件清单互不重叠，GROUP-2 内 WU-02 + WU-03 串行（同一组件文件）
- [x] 每个 WU 都有可执行验证命令与 done criteria 来源
- [x] 既有失败基线已记录，避免误判回归
- [x] 未在本轮修改任何业务代码
- [x] 分支策略在 frontend（`task/run-trace-typography`）已落实

## Next

**（计划已写入，本轮暂停）**

- 计划确认 → 说「开始实现」或「并行执行」
- 需要调整 WU 拆分或并行策略 → 直接说修改意见
- 想合并 WU 少开几轮 → 说「合并成两批」
- 改分支策略 → 说「还是 feature 上做」
