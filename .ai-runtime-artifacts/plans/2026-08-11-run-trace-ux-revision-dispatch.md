# Dispatch Plan: Run Trace UX 修订（2026-08-11）

**Spec:** `.ai-runtime-artifacts/specs/2026-08-11-run-trace-ux-revision-spec.md` (`approved: true`)
**Plan:** `.ai-runtime-artifacts/plans/2026-08-11-run-trace-ux-revision-plan.md`

## 执行图

WORKTREE-INIT：**SKIPPED**（沿用 `task/run-trace-cycle-grouping` 分支）。

### GROUP-1 (单 WU 顺序启动 → R2 → R3)

> 因 R1 改 `RunTracePanel.tsx` 是 R2 测试断言的目标，必须 R1 先完成才能跑测试。

| WU | 描述 | 文件 | 依赖 | agent_role | wu_type | wu_skills |
|---|---|---|---|---|---|---|
| R1 | 实现 RunTracePanel + MessageBubble | `RunTracePanel.tsx`, `MessageBubble.tsx` | — | coder | feature | `superpowers:frontend-ui-engineering` |
| R2 | 测试更新 | `run-trace-panel.test.tsx`, `run-trace-panel-matrix.test.tsx`, `message-bubble-cycle.test.tsx` | R1 | test-engineer | test | `superpowers:test-driven-development` |
| R3 | Leader 验证 + 落盘 + commit（含 WIP） | 见 plan § 2.2 WU-R3 | R2 | leader (主线程) | — | — |

### GROUP-2 (尾盘: 集体测试 + 集体审查)

| 子阶段 | 描述 | agent_role | wu_type |
|---|---|---|---|
| A 集体测试 | Load `verification-before-completion` + Read `definition-of-done.md` → Write `*-collective-test.md` | leader | — |
| B 审查 | 并行委派 `reviewer` + `security-auditor`（perf-auditor 按需：UI 改动量小，跳过） | reviewer, security-auditor | review |
| C 落盘 | Leader Write `code-review.md` + `execution-log.md` | leader | — |

## 派发 prompt（中文，简练）

### WU-R1

```
身份: WU-R1, agent_role=coder, wu_type=feature
目标: 按 spec §4 修订 RunTracePanel.tsx（左列动作名 + 默认展开 + resetKey）+ MessageBubble.tsx（传 resetKey）
Done:
  1. RunTracePanel.tsx 新增 resetKey?: string prop
  2. shouldAutoExpand 新增分支 !isStreaming && errorCount===0 → true
  3. StepNode 拆为身份文本（toolName / 思考 / 错误 / 执行中）+ 右上徽章
  4. <li> padding pl-[34px] → pl-[88px]；data-trace-line left-[19px] → left-[82px]
  5. MessageBubble.tsx 给 RunTracePanel 加 resetKey={message.id}
  6. pnpm -C web exec tsc -b 零误差
允许修改: web/src/components/chat/RunTracePanel.tsx, web/src/components/chat/MessageBubble.tsx
禁止: 其他 src/test/spec/plan/log 文件；不 commit
Skills: superpowers:frontend-ui-engineering@.agents/skills/frontend-ui-engineering/SKILL.md
验证: 
  pnpm -C web exec tsc -b
  pnpm -C web run test --run --reporter=basic web/tests/features/chat/run-trace-panel.test.tsx
  (允许该测试文件 FAIL，WU-R2 修；其他必须绿)
cwd: d:\studyspace\project\my-agent
返回: wu_status, self_check, code_review(轻量), ### Skills 使用
```

### WU-R2

```
身份: WU-R2, agent_role=test-engineer, wu_type=test
目标: 更新三个测试文件覆盖 WU-R1 引入的新行为
done_criteria:
  1. run-trace-panel.test.tsx: 节点身份文本 + 右上徽章 + pl-[88px] + 默认展开/折叠 + resetKey
  2. run-trace-panel-matrix.test.tsx: 360px 窄屏 + 多步骤 + 暗色
  3. message-bubble-cycle.test.tsx: RunTracePanel 接收 resetKey === message.id
允许修改: 三个测试文件
禁止: 实现文件；spec/plan/log；不 commit
Skills: superpowers:test-driven-development@.agents/skills/test-driven-development/SKILL.md
验证:
  pnpm -C web run test --run --reporter=basic
cwd: d:\studyspace\project\my-agent
返回: wu_status, ### Skills 使用
```

## DISPATCH-TRACK

留白（不上 tracking 文件，仅在本 plan 末尾追加 WU 状态行）。

## Next

user 说「开始实现 / 并行执行」后执行 GROUP-1 全部顺序 WU。