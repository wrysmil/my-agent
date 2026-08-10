---
artifact: implementation-dispatch
route: orchestration:dispatcher-workflow
plan: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md
skills:
  - writing-plans
  - orchestration
  - context-engineering
  - api-and-interface-design
skills_evidence:
  - ~/.agents/skills/writing-plans/SKILL.md
  - harness-kit/core/orchestration/dispatcher-workflow.md
  - harness-kit/core/orchestration/agents/leader.md
source:
  - .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md
  - .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md
  - harness-kit/core/routing.md
  - harness-kit/core/orchestration/dispatcher-workflow.md
created_at: 2026-08-07
status: draft
approved: false
worktree_id: wt-web-frontend-2026-08-07
worktree_path: <repo-parent>/.harness-worktrees/<repo-basename>/wt-web-frontend-2026-08-07/
branch: harness/wt-web-frontend-2026-08-07
---

# my-agent Web 前端 — Harness 执行图（Dispatch）

> 实施步骤以 **plan** 为准；本文件只描述并行 GROUP / WU 与派发。多轮审阅时优先改本文件，避免扰动 plan 内 Task 细步。
>
> **强约束（dispatcher-workflow.md §0）：** 委派写代码类 worker 时，本 GROUP-1 派发前**必须**完成 WORKTREE-INIT。所有 `cwd = worktree_path`。

## 0. WORKTREE-INIT（dispatcher-workflow.md §0）

> **触发条件：** 派发写代码类 worker（B1 / B2 / B3 / B4 / B5 / B6 / B7 / B8 / F0-F18）均需 WORKTREE-INIT。
> **路径：** `<repo-parent>/.harness-worktrees/<repo-basename>/wt-web-frontend-2026-08-07/`
> **分支：** `harness/wt-web-frontend-2026-08-07`（自 `main` 创建）
> **基线：** `origin/main`（HEAD = `b064e79`）

```bash
# 执行（在主 checkout 之外的 parent 目录运行）
git worktree add -b harness/wt-web-frontend-2026-08-07 \
  /Users/mima0000/Documents/学习-001/.harness-worktrees/my-agent/wt-web-frontend-2026-08-07/ \
  main
```

## 0.5. ContextPack（dispatcher-workflow.md §0.5）

> Leader 在派发前**必须**执行 context-engineering 上下文打包。**强引用 references（路由 → references）：**

| 阶段 | 必须打包的 references | 内容 |
| --- | --- | --- |
| 任何 WU（基线） | `orchestration-patterns.md` | 反模式自检 |
| 含测试 WU（B2/B3/B7/B8/F3/F5/F11/F18） | `testing-patterns.md` | AAA / Mock 边界 / 反模式 |
| 含 API/数据变更 WU（B2/B3/B4/B7/B8） | `security-checklist.md` | OWASP + LLM Top 10（XSS / CSP / 路径穿越） |
| 含 UI 变更 WU（F0/F1/F3/F4/F5/F6/F7-F18） | `performance-checklist.md` + `accessibility-checklist.md` | CWV / WCAG 2.1 AA |

**每个 WU 的 Context Block 结构（Leader 派发时打包）：**

```
L1 Rules Files:
  - AGENTS.md
  - harness-kit/project.profile.md
  - harness-kit/context-map.md

L2 Spec / Architecture Docs（节选，不全文）：
  - .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md § <相关章节>
  - .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md § <WU>

L3 Relevant Source Files（≤5 个）：
  - <具体源文件路径>

L4 Contract / Interface Definitions（跨 WU 时）：
  - .ai-runtime-artifacts/contracts/2026-08-07-web-frontend-api-contract.md（**GROUP-1 后由 Leader 单独写**，覆盖 SSE 协议 + ApiErrorCode + 21 个错误码 + Zod schema + 共享 DTO）

L5 Error Output / Test Results：按 iteration 累积（首轮跳过）
```

**切片策略：** incremental-implementation 三策略之 **vertical-slice**（按 USER-JOURNEY 切：每个 WU 是端到端可跑的一段）。

## 1. 执行图（dispatcher-workflow.md §1）

### GROUP-1（串行启动）

| WU | 标题 | 文件 | 依赖 | wu_type | agent_role | workspace | worktree_path | branch | wu_skills |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WU-01 | **B1** HTTP 服务器骨架 + 静态文件 + CSP | `bin/my-agent-web.ts`, `src/web/server/index.ts`, `test/web/server/index.test.ts` | 无 | feature | coder | wu | `<wt-path>` | `harness/wt-web-frontend-2026-08-07` | `auto` + `api-and-interface-design` |

> GROUP-1 必须先完成；它是所有后端 WU 的基础。

### GROUP-2（并行，依赖 GROUP-1）

| WU | 标题 | 文件 | 依赖 | wu_type | agent_role | workspace | wu_skills |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WU-02a | **B2** Provider 域 6 REST | `src/web/server/routes/providers.ts`, `validators/providers.ts`, `test/...` | WU-01 | feature | coder | wu | `auto` + `api-and-interface-design` + `security-and-hardening` |
| WU-02b | **B3** Session 域 + Chat 流（含 sse.ts） | `src/web/server/routes/{sessions,messages}.ts`, `sse.ts`, `validators/sessions.ts`, `test/...` | WU-01 | feature | coder | wu | `auto` + `api-and-interface-design` + `observability-and-instrumentation` |
| WU-02c | **B4** Agent / Skill 域 GET | `src/web/server/routes/{agents,skills}.ts`, `test/...` | WU-01 | feature | coder | wu | `auto` |
| WU-02d | **B5** 自动打开浏览器 | `src/web/server/open-browser.ts`, `test/...` | WU-01 | feature | implementer | wu | `auto` |
| WU-02e | **B7** 统一错误处理器（21 错误码） | `src/web/server/errors.ts`, `test/...` | WU-01 | feature | coder | wu | `auto` + `security-and-hardening` |

> **并行约束：** WU-02a/b/c/d/e 之间文件互不相交；上限 5 个并发。
> **wu_type=feature** → 全部走 `coder`/`implementer`。

### GROUP-3（并行，前端基础设施，独立于 GROUP-2）

| WU | 标题 | 文件 | 依赖 | wu_type | agent_role | workspace | wu_skills |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WU-03a | **F0** Design System + theme.js + Safari polyfill | `web/style.css`, `web/js/shared/theme.js` | 无 | feature | frontend-ui-engineer | wu | `auto` + `frontend-ui-engineering` + `accessibility-checklist` |
| WU-03b | **F1** index.html 骨架（Skip-link + ARIA） | `web/index.html` | 无 | feature | frontend-ui-engineer | wu | `auto` + `frontend-ui-engineering` |
| WU-03c | **F2** vendor + SRI hash | `web/js/vendor/{dompurify,marked}.min.js`, `README.md` | 无 | chore | implementer | wu | `auto` + `security-and-hardening` |
| WU-03d | **F4** Lucide icons（≈20 个） | `web/js/shared/icons.js`, `test/...` | 无 | feature | frontend-ui-engineer | wu | `auto` |

### GROUP-4（并行，依赖 GROUP-3）

| WU | 标题 | 文件 | 依赖 | wu_type | agent_role | workspace | wu_skills |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WU-04a | **F3** shared utils/api/i18n | `web/js/shared/{utils,api,i18n}.js`, `test/...` | WU-03a, WU-03c | feature | frontend-ui-engineer | wu | `auto` + `testing-patterns` |
| WU-04b | **F5** state.js（状态 + FIFO + 持久化） | `web/js/state/state.js`, `test/...` | WU-04a | feature | frontend-ui-engineer | wu | `auto` + `testing-patterns` |
| WU-04c | **F6** 基础组件 13 个（Button/Modal/Toast/Skeleton/...） | `web/js/components/*.js`, `test/...` | WU-03a, WU-04a | feature | frontend-ui-engineer | wu | `auto` + `frontend-ui-engineering` + `accessibility-checklist` |
| WU-04d | **F18-theme.js** `/theme` 命令循环（仅 theme 部分） | `web/js/features/theme.js` | WU-03a | feature | frontend-ui-engineer | wu | `auto` |

### GROUP-5（并行，依赖 GROUP-4）

| WU | 标题 | 文件 | 依赖 | wu_type | agent_role | workspace | wu_skills |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WU-05a | **F7** sidebar + panels（5 panel DOM） | `web/js/components/{sidebar,panels}.js` | WU-04b, WU-04c | feature | frontend-ui-engineer | wu | `auto` + `accessibility-checklist` |
| WU-05b | **F8** menu.js（Bento Grid 主菜单） | `web/js/features/menu.js`, `test/...` | WU-04c, WU-05a | feature | frontend-ui-engineer | wu | `auto` |
| WU-05c | **F9** providers.js（Provider 表格 + 表单） | `web/js/features/providers.js`, `test/...` | WU-04c + WU-02a | feature | frontend-ui-engineer | wu | `auto` |
| WU-05d | **F10** sessions.js（侧边栏会话列表） | `web/js/features/sessions.js`, `test/...` | WU-04b + WU-02b 部分 | feature | frontend-ui-engineer | wu | `auto` |
| WU-05e | **F12** agents.js | `web/js/features/agents.js`, `test/...` | WU-02c | feature | frontend-ui-engineer | wu | `auto` |
| WU-05f | **F13** skills.js | `web/js/features/skills.js`, `test/...` | WU-02c | feature | frontend-ui-engineer | wu | `auto` |
| WU-05g | **F14** settings.js | `web/js/features/settings.js`, `test/...` | WU-04b | feature | frontend-ui-engineer | wu | `auto` |

### GROUP-6（关键路径，串行；可拆为子并行）

| WU | 标题 | 文件 | 依赖 | wu_type | agent_role | workspace | wu_skills |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WU-06a | **B8** AgentRunner.compactNow + 3 新端点 | `src/agent/runner.ts`, `session.ts`, `persistent-session.ts`, 3 个 handler | WU-01, WU-02e | feature | coder | wu | `auto` + `api-and-interface-design` + `testing-patterns` |
| WU-06b | **F11** chat.js（SSE 消费 + Markdown + 工具卡片） | `web/js/features/chat.js`, `test/...` | WU-03c, WU-04d, WU-04b, WU-04c + WU-02b | feature | frontend-ui-engineer | wu | `auto` + `frontend-ui-engineering` + `performance-optimization` + `accessibility-checklist` |
| WU-06c | **F15** app.js 启动流水线 + **F16** 全站快捷键 | `web/js/app.js`, `web/js/app.keymap.js`（可选） | WU-05a-g, WU-06b | feature | frontend-ui-engineer | wu | `auto` + `accessibility-checklist` |

### GROUP-7（收尾 + 集体测试）

| WU | 标题 | 文件 | 依赖 | wu_type | agent_role | workspace | wu_skills |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WU-07a | **F18** Slash 命令全套（除 theme.js 部分） | `web/js/features/slash.js`, 9 个 Modal 文件, `test/...` | WU-04c, WU-06b, WU-06a | feature | frontend-ui-engineer | wu | `auto` + `frontend-ui-engineering` + `accessibility-checklist` |
| WU-07b | **F17** 前端冒烟 + a11y 自检 + verification 落盘 | `test/e2e/web-smoke.spec.ts`, `.ai-runtime-artifacts/verifications/2026-08-07-web-frontend-verification.md` | WU-06c, WU-07a | test | test-engineer | wu | `auto` + `verification-before-completion` |
| WU-07c | **B6** 后端冒烟（手测清单） | `.ai-runtime-artifacts/verifications/2026-08-07-web-smoke.md` | WU-02a-e, WU-06a | test | implementer | wu | `auto` |
| WU-07d | **README** Web 模式一节 + 截图说明 | `README.md` | WU-06c | chore | implementer | wu | `auto` |

### GROUP-8（GROUP-7 后，集体审查尾盘）

> 不可与 GROUP-7 并行；必须 GROUP-7 完成后启动。

| WU | 标题 | 依赖 | wu_type | agent_role |
| --- | --- | --- | --- | --- |
| WU-08a | **A 集体测试** — `verification-before-completion` 全量 21 错误码 / 8 验收清单 / axe-core | GROUP-7 全 | review | test-engineer |
| WU-08b | **B1 Reviewer** — code-review 五轴审查 | GROUP-7 全 | review | reviewer |
| WU-08c | **B2 Security-Auditor** — OWASP + LLM + CSP + SRI | GROUP-7 全 | review | security-auditor |
| WU-08d | **B3 Perf-Auditor**（按需） — CWV + 流式重渲染 | GROUP-7 全 | review | perf-auditor |

> **WU-08a/b/c 可并行扇出**（dispatcher-workflow.md §3 模式 3）；merge 在 Leader 主线程。

## 2. 派发顺序总览

```
T0  WORKTREE-INIT
T1  GROUP-1 → WU-01 (B1) [串行，单 worker]
T2  GROUP-2 → WU-02a/b/c/d/e 并行（5 worker）
T3  GROUP-3 → WU-03a/b/c/d 并行（4 worker，与 T2 并行）
T4  GROUP-4 → WU-04a/b/c/d 并行（4 worker）
T5  GROUP-5 → WU-05a-g 并行（7 worker，硬顶 5 → 两批）
T6  GROUP-6 → WU-06a/b/c（06a 串行；06b/c 与 06a 并行）
T7  GROUP-7 → WU-07a/b/c/d 并行（4 worker）
T8  GROUP-8 → WU-08a/b/c 并行（3 worker）
T9  WORKTREE-CLOSE（仅在用户确认 Git 后）
```

**硬顶：5 个 worker 并发**（dispatcher-workflow.md §2）。

## 3. WU 派发 Prompt 模板

> 每个 Worker 收到的 prompt 必须包含下表全部字段（dispatcher-workflow.md §2）。

```
身份: WU-<id> + agent_role: <role> + wu_type: <feature|test|chore|review|simplify> + agents/<role>.md
目标: <单句>
Done criteria: <3-5 条，可验证>
范围:
  允许文件: <路径列表（来自 plan § 6）>
  禁止项: <一句>
Skills:
  - <slug>@<path> （不写 auto；按 plan § 6 wu_skills 展开）
Context Block:
  L1: AGENTS.md / harness-kit/project.profile.md / context-map.md
  L2: spec § <X.Y> 摘要（≤30 行）/ plan § <WU> 摘要（≤30 行）
  L3: 源文件清单（≤5 个）
  L4: contract 摘要（仅 WU-02a/b/c/e + WU-06a + WU-07a）
  L5: 跳过
验证命令:
  - npm run check
  - npm test -- <pattern>
返回:
  - wu_status: success | partial | blocked
  - ### Skills 使用（worker 必须返回）
  - 变更摘要（diff stat + 新文件清单）
  - ### References 检查（≤10 条 pass/fail/n/a + 对应 evidence）
cwd: <worktree_path>
```

## 4. 禁止传 Worker 的 Skills（dispatcher-workflow.md §2）

- `brainstorming`、`writing-plans`、`orchestration`、`git-xywh` — 仅 Leader 调用
- `requesting-code-review` — Leader 整合时调用

## 5. 反模式自检（orchestration-patterns.md）

| 反模式 | 本计划如何规避 |
| --- | --- |
| 单 worker 包整个 epic | 每个 WU ≤ 8 文件、有界可验证 |
| 实现与审查同实例 | WU-08 a/b/c 由独立 reviewer / security-auditor / perf-auditor 执行 |
| 跳过 execution-log | GROUP-7 完成后 Leader 必须 Write `.ai-runtime-artifacts/execution-logs/2026-08-07-web-frontend-execution-log.md` |
| 跳过上下文打包 | §0.5 强引用 references 已配置 |
| 跳过尾盘产物 | WU-08a 落 `collective-test.md`；WU-08b/c 落 `*-code-review.md` / `*-security-review.md` |
| Leader 自动 push | `git-xywh` 由 Leader 在用户确认后显式调用 |

## 6. 变更记录

| 轮次 | 日期 | 变更摘要 |
| --- | --- | --- |
| 1 | 2026-08-07 | 初稿：8 个 GROUP，30 个 WU（含 B8 后端扩展 + F18 slash 全套） |

## Next

**（dispatch 写入后须暂停，等用户「开始实现」再派发）**

| 用户指令 | 触发动作 |
| --- | --- |
| 「**开始实现**」/「**并行执行**」 | T0 WORKTREE-INIT → T1 GROUP-1 → T2-T7 GROUP 串行推进 → T8 集体审查 |
| 「**改派发**」/「**只改 WU 拆分**」 | 仅改本文件 |
| 「**改 plan**」 | 仅改 `*-plan.md` |
| 「**暂停**」 | 保留 worktree；下次继续按当前 GROUP |
| 「**回滚**」 | `git worktree remove` + 分支删除 |

**前置依赖：**

- [x] spec 文档已落盘（v3.3）
- [x] plan 已落盘（本文同 stem）
- [ ] 用户已审阅 plan + dispatch
- [ ] 用户明确进入实现阶段