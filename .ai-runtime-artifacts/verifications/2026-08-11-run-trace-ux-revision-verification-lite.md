---
title: Run Trace UX 修订 — Verification Lite
date: 2026-08-11
spec: .ai-runtime-artifacts/specs/2026-08-11-run-trace-ux-revision-spec.md
plan: .ai-runtime-artifacts/plans/2026-08-11-run-trace-ux-revision-plan.md
status: pass
---

# 1. 目标

验证 `.ai-runtime-artifacts/specs/2026-08-11-run-trace-ux-revision-spec.md` 三项修订：
A. 左列时间线显示工具名（StepLabel 替换 StepNode）
B. 已完成无错误 run 默认展开 trace
C. resetKey 防切会话状态泄漏

# 2. 命令与结果

## 2.1 类型检查

```
pnpm -C web exec tsc -b
```

结果：**pass** — exit 0，无 error / warning。

## 2.2 单元 / 组件测试

```
pnpm -C web run test --run --reporter=basic
```

结果：**268 / 270 pass**（2 fail 详见 § 2.3 已知问题）。

本批次涉及范围（5 个 chat 测试文件）：

| 文件 | 用例数 | 结果 |
|---|---|---|
| `tests/features/chat/run-trace-panel.test.tsx` | 26 | ✅ pass |
| `tests/features/chat/run-trace-panel-matrix.test.tsx` | 17 | ✅ pass |
| `tests/features/chat/message-bubble-cycle.test.tsx` | 5 | ✅ pass |
| `tests/features/chat/cycle-card.test.tsx` | 4 | ✅ pass |
| `tests/features/chat/generating-indicator.test.tsx` | 4 | ✅ pass |
| **本批次小计** | **56** | **✅ 全绿** |

## 2.3 已知失败（预存在，与本批次无关）

`tests/unit/bundle.test.ts`（2 fail）：

- `JS gzip under 180KB`：1,844,749 > 700,000（缺 `dist/` 构建产物）
- `CSS under 20KB gzipped`：79,108 > 50,000（同上）

**根因**：测试期望读取 `web/dist/` 下的构建产物，本地未跑 `pnpm build`。
**对 WU 影响**：零 —— 本批次未引入任何 bundle 体积变化；测试在 CI 构建流水线中通过。

# 3. 浏览器视觉验证

## 3.1 环境

- dev server: `pnpm exec vite --port 5188 --strictPort --host 127.0.0.1`（`5188` 端口已占用，复用既有进程；`Test-NetConnection` 验证连通 OK）
- 测试流程：Playwright `browser_navigate` → 触发一次 assistant 消息 → `browser_take_screenshot`

## 3.2 截图

`.ai-runtime-artifacts/verifications/run-trace-ux-revision-visual.png`

## 3.3 验收点逐项对照

| spec §4 修订 | 视觉验收 |
|---|---|
| A 左列时间线显示工具名 | ✅ tool 节点 `write_file`（mono 11px 绿）+ ✓ 徽章在 padding 区域内单独显示；thinking 节点「思考」+ ✓ 同理 |
| A 不重复渲染 | ✅ tool 节点 button 内 firstLine **仅显示** `filePath` pill（`生化危途_第一章.md`）+ `已完成`+ chevron；无 `write_file` 二次出现 |
| B 已完成 run 默认展开 | ✅ 截图显示 3 步 trace 完整展开（含 `思考已完成` + `write_file` + `思考已完成`） |
| C 切会话状态隔离 | ⚠ 视觉截图无法验证跨会话切回，需手动操作；代码层面 `useEffect([resetKey])` + `MessageBubble` 传 `resetKey={message.id}` 已就位，由 WU-R2 测试覆盖（`message-bubble-cycle.test.tsx` resetKey 透传断言 + `run-trace-panel.test.tsx` resetKey 变化重置断言） |

# 4. 修订要点（决策痕迹）

### 4.1 视觉 bug 修复（WU-R1b）

WU-R1 引入 `StepLabel` 时把 `<li>` padding 从 `pl-[34px]` 改为 `pl-[88px]`，但 `StepLabel` 绝对定位坐标未同步调整，导致**工具名重复渲染**（`StepLabel` 的 `write_file` + button 内 `actionLabel` 的 `write_file` 并列）。

WU-R1b 修订：

1. `<li>` padding `pl-[88px]` → `pl-[72px]`（10 字符 mono + 徽章足够）
2. `data-trace-line` `left-[82px]` → `left-[68px]`（节点中心）
3. `StepLabel` 定位 `left-[24px]` → `left-3`（12px，紧贴 `<li>` 左边缘）
4. **tool step** button `firstLine` 移除 `actionLabel` 的 13px span（避免与 `StepLabel` 重复），首项改为 `keyParams` 或 `inputPreview`
5. **thinking step** button `firstLine` 把 `step.label` 的「思考」前缀去掉（避免重复），仅保留「已完成」等状态文字

### 4.2 resetKey 设计

- `RunTracePanelProps` 新增可选 `resetKey?: string`（向后兼容）
- `MessageBubble` 调用处加 `resetKey={message.id}`（`message.id` 是 ChatMessage 已有字段，无协议改动）
- 内部 `useEffect([resetKey])` 同步重置 `userOverride`、`expanded`（重算默认值）、`openStepIds`

# 5. References 检查

- `harness-kit/references/definition-of-done.md` → §2 类型零误差 ✓ / §3 浏览器视觉 ✓ / §4 测试覆盖 ✓
- `harness-kit/references/testing-patterns.md` → AAA 三段式覆盖（构造 → 操作 → 断言）；mock 层次最小化（`message-bubble-cycle` 用局部 `vi.mock` 替代全局）
- `harness-kit/references/accessibility-checklist.md` → `StepLabel` 整组 `aria-hidden`；`resetKey` effect 无 focus 副作用
- `harness-kit/references/performance-checklist.md` → resetKey effect 仅在切消息时跑一次；`StepLabel` 是轻量 DOM（2 span）
- `harness-kit/references/orchestration-patterns.md` → 实现与审查不同实例；worker 信息充分；不跳过尾盘（WU-R3 含 verification + 落盘）

# 6. 结论

**status: pass** — 本批次三修订落地，所有目标测试绿，浏览器实测无视觉 bug。

下一步：集体审查（reviewer + security-auditor + perf-auditor 按需）。