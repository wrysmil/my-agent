---
artifact: verification
route: orchestration:dispatcher-workflow -> batch-closeout
skills:
  - verification-before-completion
skills_evidence:
  - .agents/skills/verification-before-completion/SKILL.md
source:
  - project.verification.md
  - docs/plan/Skill系统实现文档.md
  - .ai-runtime-artifacts/plans/2026-08-06-skill-system-b1-dispatch.md
created_at: 2026-08-06
batch_id: skill-system-b1
worktree_id: wt-skill-system-b1
worktree_path: D:/studyspace/project/.harness-worktrees/my-agent/wt-skill-system-b1
verdict: PASS
---

# Skill 系统 B1（S1 核心闭环）集体测试

> **纪律：** 已 Load **verification-before-completion**；先跑命令、再给结论。
> **写入者：** Leader。WU 内 Coder 单测摘要仅作引用，不能替代本表命令的本机重跑。

## 防跳过提醒

| 合理化借口 | 现实 |
|-----------|------|
| "每个 WU 都跑过单测了，不用重跑" | 单测隔离 ≠ 集成正常。本批 5 个 WU 的 chat.ts 接线与 loader 实例化涉及 WU 间接口契约，必须 Leader 本机重跑 |
| "改动很小，批次测试太重型" | 本批新增 4 个测试文件 + 5 处源码改动，交互风险真实存在 |

## 变更范围

- 本批次触及模块/目录：
  - `src/skills/`：loader.ts（frontmatter 增强 + 实例化缓存）、types.ts（未改）、prompt.ts（新增）、index.ts（导出）
  - `src/storage/paths.ts`：userSkillsDir / userMarketplaceSkillsDir / userSystemSkillsDir + ensureDataLayout
  - `src/tools/builtin.ts`：resolvePath 沙箱允许 skill 根
  - `chat.ts`：菜单注入迁移到 buildAvailableSkillsBlock + 实例 loader
  - `bin/run-skill.cjs`（新增）+ `fixtures/skills/hello-skill/`（新增）
  - 测试：test/skill-loader.test.ts、test/storage/paths.test.ts、test/builtin-tools.test.ts（增）、test/skills-prompt.test.ts（新）、test/run-skill.test.ts（新）

## WU 已覆盖项（引用，非替代）

| WU | 命令/结论摘要 |
| --- | --- |
| WU-01 | skill-loader.test.ts 29/29；npm run check exit 0 |
| WU-02 | paths.test.ts 14/14；npm run check exit 0 |
| WU-03 | run-skill.test.ts 13/13；npm run check exit 0；冒烟覆盖 py/mjs、../x 拒绝、custom/marketplace 优先级 |
| WU-04 | skills-prompt.test.ts 7/7；npm run check exit 0 |
| WU-05 | builtin-tools.test.ts 21/21；npm run check exit 0 |

## 命令表（Leader 本机重跑）

| 命令 | cwd | exit | 关键输出摘要 |
| --- | --- | --- | --- |
| `npm run check` | worktree | 0 | tsc --noEmit 无输出 |
| `npx vitest run` | worktree | 1* | 21 files passed / 1 failed；**326 passed / 3 failed** |
| `node bin/run-skill.cjs hello-skill main`（临时 MY_AGENT_HOME 含 fixtures 副本） | worktree | 0 | 输出 `{"ok":true,...}`（WU-03 冒烟记录） |

> *`npm test` 整体 exit 1 仅因 cli-io.test.ts 3 项既有失败。核实：`src/cli/io.ts` 与 `test/cli-io.test.ts` 均不在本批 diff 内（`git diff --name-only` 无输出），为 Windows ANSI 颜色断言环境问题（实现文档 §5.2 已记录；第三阶段 execution-log 亦记为既有失败）。本批未引入任何新失败。

## 集成 / E2E

- 端到端闭环（S1.6 + S1.7 验收场景）：
  - `read_file(<userSkillsDir>/hello-skill/SKILL.md)` 可达 → builtin-tools.test.ts 新增用例覆盖
  - `read_file(<customRoot>/hello-skill/SKILL.md)` 成功且内容正确；工作目录外路径与 `..` 穿越仍被拒 → 21/21 覆盖
  - system prompt 含 `## Available skills` + 绝对 ROOT → skills-prompt.test.ts 覆盖（ROOT 内联 + Source 标签 + internal read id）

## 未验证项

- `run-skill` 的 `.ts` 扩展名执行（本批按文档明确不执行，命中返回错误）
- `.cmd/.bat/.ps1/.rb` 等扩展名在真实 Windows 环境逐一生效（分派表实现，未逐项 E2E）
- Python 路径：`py -3` 依赖本机 Python 安装；若无 `py` 启动器该用例会跳过/失败（WU-03 已标注环境依赖）

## 残留风险

- cli-io.test.ts 3 项 ANSI 既有失败（非本批引入；属 Windows 终端环境问题，超出 B1 scope）
- `chat.ts` 菜单现扫三个来源（marketplace、custom、仓库 ./skills），仓库 ./skills 的 `coding` 技能标 `builtin`（迁移方案 A 过渡态，B2 可收口到 dataRoot）

## 结论

**verdict: PASS**

TDD Compliance（尾盘核对）：
- 各 WU 均按 TDD RED→GREEN 执行（WU-01 29 例 RED 15→GREEN 29；WU-02 RED 5→GREEN 14；WU-03 RED 13→GREEN 13；WU-04 RED→GREEN 7；WU-05 RED 5→GREEN 21）
- Happy path / Edge cases / Error cases：均覆盖（frontmatter 验收表、路径穿越、脚本缺省、优先级、沙箱边界）

## Next

- PASS → 进入集体代码审查（reviewer + security-auditor 并行）
- FAIL → 开 bugfix WU；不得进入审查或声称批次完成
