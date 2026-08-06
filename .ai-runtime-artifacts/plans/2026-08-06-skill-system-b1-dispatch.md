---
artifact: implementation-dispatch
route: orchestration:dispatcher-workflow
plan: docs/plan/Skill系统实现文档.md
skills:
  - orchestration
skills_evidence:
  - harness-kit/.agents/skills/orchestration/SKILL.md
  - harness-kit/core/orchestration/dispatcher-workflow.md
  - harness-kit/core/orchestration/skill-preferences.md
source:
  - docs/plan/Skill系统实现文档.md
  - .ai-runtime-artifacts/reviews/2026-08-06-skill-system-document-review.md
created_at: 2026-08-06
worktree_id: wt-skill-system-b1
worktree_path: D:/studyspace/project/.harness-worktrees/my-agent/wt-skill-system-b1
branch: harness/wt-skill-system-b1
base_ref: main
---

# Skill 系统 B1（S1 核心闭环）— Harness 执行图

> 实施步骤以 `docs/plan/Skill系统实现文档.md` 为准；本文件只描述并行 GROUP / WU 与派发。
> 本批为 B1（S1 核心闭环），B2/B3 待 B1 尾盘后再续。

## 执行图

```markdown
GROUP-1（并行）:
  WU-01: S1.1+S1.2+S1.4 skills 核心升级（frontmatter 增强 + description 迁移 + Loader 实例化缓存）| 标题: skills核心升级 | 文件: src/skills/loader.ts, src/skills/types.ts, test/skill-loader.test.ts | 依赖: 无 | wu_type: feature | agent_role: coder | workspace_scope: wu | worktree_path: D:/studyspace/project/.harness-worktrees/my-agent/wt-skill-system-b1 | branch: harness/wt-skill-system-b1 | wu_skills: auto
  WU-02: S1.3 路径扩展（userSkillsDir / userMarketplaceSkillsDir / userSystemSkillsDir + ensureDataLayout）| 标题: 路径扩展 | 文件: src/storage/paths.ts, test/storage/paths.test.ts | 依赖: 无 | wu_type: feature | agent_role: coder | workspace_scope: wu | worktree_path: D:/studyspace/project/.harness-worktrees/my-agent/wt-skill-system-b1 | branch: harness/wt-skill-system-b1 | wu_skills: auto
  WU-03: S1.7 run-skill 最小执行器（bin/run-skill.cjs + fixtures + 测试）| 标题: run-skill执行器 | 文件: bin/run-skill.cjs, fixtures/skills/hello-skill/, test/run-skill.test.ts | 依赖: 无（路径约定与 WU-02 一致，无需 import TS 源码）| wu_type: feature | agent_role: coder | workspace_scope: wu | worktree_path: D:/studyspace/project/.harness-worktrees/my-agent/wt-skill-system-b1 | branch: harness/wt-skill-system-b1 | wu_skills: auto

GROUP-2（并行，依赖 GROUP-1）:
  WU-04: S1.5 Prompt 注入（buildAvailableSkillsBlock + chat.ts 接线）| 标题: prompt注入 | 文件: src/skills/prompt.ts(新), src/skills/index.ts, chat.ts, test/skills-prompt.test.ts(新) | 依赖: WU-01（Loader 实例 API）、WU-02（roots 路径）| wu_type: feature | agent_role: coder | workspace_scope: wu | worktree_path: D:/studyspace/project/.harness-worktrees/my-agent/wt-skill-system-b1 | branch: harness/wt-skill-system-b1 | wu_skills: auto
  WU-05: S1.6 沙箱扩展（builtin.ts resolvePath allowedRoots 加 skill 根）| 标题: 沙箱扩展 | 文件: src/tools/builtin.ts, test/builtin-tools.test.ts | 依赖: WU-02（userSkillsDir / userMarketplaceSkillsDir）| wu_type: feature | agent_role: coder | workspace_scope: wu | worktree_path: D:/studyspace/project/.harness-worktrees/my-agent/wt-skill-system-b1 | branch: harness/wt-skill-system-b1 | wu_skills: auto
```

## 文件冲突矩阵（并行安全证明）

| 文件 | 涉及 WU |
|------|---------|
| `src/skills/loader.ts` | WU-01 |
| `src/skills/types.ts` | WU-01 |
| `src/storage/paths.ts` | WU-02 |
| `bin/run-skill.cjs` | WU-03 |
| `src/skills/prompt.ts` | WU-04 |
| `src/skills/index.ts` | WU-04 |
| `chat.ts` | WU-04 |
| `src/tools/builtin.ts` | WU-05 |
| `test/skill-loader.test.ts` | WU-01 |
| `test/storage/paths.test.ts` | WU-02 |
| `test/run-skill.test.ts` | WU-03 |
| `test/skills-prompt.test.ts` | WU-04 |
| `test/builtin-tools.test.ts` | WU-05 |

GROUP-1 三 WU 文件不相交 → 并行；GROUP-2 两 WU 文件不相交 → 并行；GROUP-2 依赖 GROUP-1。

## WU Skills 解析（auto → skill-preferences.md）

| WU | Skills（按序加载） |
|----|--------------------|
| WU-01 | source-driven-development → doubt-driven-development → incremental-implementation → observability-and-instrumentation → test-driven-development → verification-before-completion → requesting-code-review |
| WU-02 | 同上 |
| WU-03 | 同上（security-and-hardening 强调 path traversal / command injection） |
| WU-04 | 同上 |
| WU-05 | 同上（security-and-hardening 强调 path sandbox） |

## References 打包（Leader → WU Context Block）

- 基线：`harness-kit/references/orchestration-patterns.md`（反模式自检）
- 含测试 WU（全部）：`harness-kit/references/testing-patterns.md` — AAA、Mock 边界、反模式
- 含路径/命令 WU（WU-02/03/05）：`harness-kit/references/security-checklist.md` — path traversal、command injection、LLM06 权限

## Next

- 执行图确认 → 已获用户「开始实现任务，编排把」授权，直接派发 GROUP-1
- GROUP-1 返回 → 整合 → 派发 GROUP-2
- GROUP-2 返回 → 尾盘（collective-test → 并行 reviewer/security-auditor）
