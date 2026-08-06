---
artifact: review
route: orchestration:dispatcher-workflow -> batch-closeout
skills:
  - requesting-code-review
  - code-review-and-quality
  - orchestration
skills_evidence:
  - harness-kit/.agents/skills/requesting-code-review/SKILL.md
  - harness-kit/.agents/skills/code-review-and-quality/SKILL.md
  - harness-kit/.agents/skills/orchestration/SKILL.md
source:
  - .ai-runtime-artifacts/plans/2026-08-06-skill-system-b1-dispatch.md
  - docs/plan/Skill系统实现文档.md
created_at: 2026-08-06
batch_id: skill-system-b1
worktree_id: wt-skill-system-b1
worktree_path: D:/studyspace/project/.harness-worktrees/my-agent/wt-skill-system-b1
reviewer_instance: reviewer
verdict: APPROVE（WU-06 review-fix 后复审通过）
reviewed_at: 2026-08-06 17:30
---

# Skill 系统 B1 集体代码审查

> 写入者：Leader（收到 reviewer 返回后落盘）。Reviewer 为 readonly。

## 审查范围

- 文件列表：`src/skills/loader.ts`、`src/skills/prompt.ts`、`src/skills/index.ts`、`src/storage/paths.ts`、`src/tools/builtin.ts`、`chat.ts`、`bin/run-skill.cjs`、`fixtures/skills/hello-skill/`、5 个测试文件（13 文件，git diff main..HEAD）
- BASE_SHA / HEAD_SHA：main 01011dc / 工作树未提交（worktree harness/wt-skill-system-b1）

## 变更尺寸评估

| 指标 | 值 | 判定 |
|------|----|------|
| 变更行数 | ~641+/106- | 较大（>300 行），但为 5 个独立 WU 的自然累积 |
| 变更文件数 | 13 | 可接受（≤10 理想，略超因 run-skill + fixtures + 测试） |

## 对照依据

- spec：`docs/plan/Skill系统实现文档.md` §6 S1.1–S1.7、§5、§9
- plan：`.ai-runtime-artifacts/plans/2026-08-06-skill-system-b1-dispatch.md`
- done criteria：dispatch 执行图各 WU

## Findings

### Critical

- 无

### Important

- **chat.ts `repoSkillDir` 在 Windows 上扫描永远为空（迁移方案 A 失效）**：`chat.ts:142` 沿用 `new URL("./skills", import.meta.url).pathname`，Windows 下产出 `/D:/...`（带前导 `/`），`fs.existsSync` false。仓库内 `skills/coding` 在菜单中不可见；配合 `ensureDataLayout` 无运行时调用，全新环境菜单为空。修复：`fileURLToPath(new URL("./skills", import.meta.url))`。
  - **状态：WU-06 已修复（见下方「WU-06 修复记录」）**

### WU-06 修复记录（Leader 复审）

| 项 | 修复 |
|----|------|
| Important：repoSkillDir Windows 路径 | `chat.ts` 改 `fileURLToPath(new URL("./skills", import.meta.url))`；`node` 实测旧 `pathname` = `/D:/...`（existsSync false）→ 新值 `D:\...`（existsSync true） |
| builtin ROOT 缺口（WU-06 Detail 决策项） | `prompt.ts` `SkillRoots` 增可选 `builtin`，提供时渲染 `- builtin: <root>` ROOT 行；`chat.ts` roots 传 `builtin: repoSkillDir`。仓库内 `skills/coding` 现在 `Source: builtin` 且有 ROOT 可构造 read_file 路径 |
| 回归测试 | `test/skills-prompt.test.ts` +2（builtin ROOT 行渲染 / 未提供时不渲染） |

**复审验证**（Leader 本机重跑）：
- 专项 86/86（skill-loader 29 / skills-prompt 9 / paths 14 / builtin-tools 21 / run-skill 13）
- `npm run check` exit 0
- 全量 328/331（3 项仍为 cli-io.test.ts ANSI 既有环境失败，非本批引入）
- smoke：`repoSkillDir` 解析 `D:\...\skills`，`list()` 返回 coding，菜单含 `- builtin: D:\...\skills` 且 `**coding** (Source: builtin)`

**Suggestion/Nit 处置**：6 项 Suggestion + 4 项 Nit 均不构成 BLOCK，全部记为 B2 前置清单（见 execution-log §遗留项），不在本批扩大范围。

### Suggestion

- run-skill `.js` 按 ESM 加载依赖 Node ≥20.19/22.7（module syntax detection）；文档 §5.1 声明 ≥18 → 建议文档明确「ESM 一律用 `.mjs` 推荐；`.js` 仅祖先有 `"type":"module"` 才按 ESM」
- `parseFrontmatter` 闭合定界 `indexOf("---", 3)` 未按行锚定，块标量/引号值内含 `---` 会提前截断 → 建议补回归测试或按 `^---$` 行锚定
- 实例 `list()` 按目录名去重 vs 静态 `scan` 按 spec.id 去重，两目录名不同但 id 相同会同时保留 → 建议文档注明
- `parseArgv` 有 `--` 时 scriptBase 后额外位置参数被静默丢弃 → 建议统一或补测
- 实例 loader `parseSpec` 把 `spec.source` 硬编码 `"user"`，marketplace 下元数据错误 → B1 无消费者，S2 Registry 按根重算，建议注明勿依赖
- chat.ts 启动即 `SkillLoader.load()` 全量读所有 SKILL.md 正文 → 建议 `/skill <id>` 懒加载

### Nit

- prompt.ts 将 `spec.name` 原样拼入 prompt 未转义（换行/加粗自伤）
- `isUnderRoot`/`isPathAllowed` Windows 大小写敏感（MY_AGENT_HOME 大小写不一致会误判）
- `list()` 缓存命中返回同一数组引用（外部可变污染缓存）
- run-skill `parseArgv` 行为不对称（见 Suggestion）

## 结构疗法建议（可选）

- 无（loader.ts 拆分合理，prompt.ts 独立模块，静态兼容层保留符合移除条件）

## 死代码 / 孤儿代码检查

- [x] 无无引用函数/类型/文件
- [x] 无注释掉的代码块
- [x] 旧 `## 可用技能` 菜单已完全移除（chat.ts 已迁移）

## 证据

- Reviewer 已读/已跑：专项测试 84/84（29/7/14/21/13）、`npm run check` exit 0、全量 326/329（3 项 cli-io ANSI 既有）、Windows `new URL(...).pathname` 实测 `/D:/...` 无效
- 安全审查（独立）：0 Critical/0 High/2 Medium/3 Low，见 `2026-08-06-skill-system-b1-security-review.md`

## 未验证项

- 真实 TTY 交互下 `npm run chat` 菜单渲染与 `/skills` `/skill <id>` 命令
- POSIX 平台行为（repoSkillDir 生效后 builtin ROOT 缺口分支）
- Node 18/20.x 下 dataRoot `.js` ESM 失败形态（本机 Node 22）
- 沙箱 realpath/symlink 防御（预存在设计取舍）

## 结论

**verdict: APPROVE（复审通过）** — 无 Critical；原 1 项 Important（repoSkillDir Windows 路径）经 WU-06 修复并复审验证；builtin ROOT 缺口同步补齐。Suggestion/Nit 无 BLOCK，移交 B2 清单。

## Next

- execution-log 收尾（批次完成）；B2 承接 2 项 Medium 安全项 + Suggestion 清单
