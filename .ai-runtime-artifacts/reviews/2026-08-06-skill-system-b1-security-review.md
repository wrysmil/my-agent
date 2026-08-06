---
artifact: review
route: orchestration:dispatcher-workflow -> batch-closeout
skills:
  - security-and-hardening
  - requesting-code-review
skills_evidence:
  - harness-kit/.agents/skills/security-and-hardening/SKILL.md
  - harness-kit/.agents/skills/requesting-code-review/SKILL.md
source:
  - .ai-runtime-artifacts/plans/2026-08-06-skill-system-b1-dispatch.md
  - docs/plan/Skill系统实现文档.md
created_at: 2026-08-06
batch_id: skill-system-b1
worktree_id: wt-skill-system-b1
worktree_path: D:/studyspace/project/.harness-worktrees/my-agent/wt-skill-system-b1
reviewer_instance: security-auditor
verdict: PASS_WITH_RISK
---

# Skill 系统 B1 安全审查

> 写入者：Leader（收到 security-auditor 返回后落盘）。审查者只读。

## Summary

- Critical: 0
- High: 0
- Medium: 2
- Low: 3

审查范围：`bin/run-skill.cjs`、`src/skills/loader.ts`、`src/skills/prompt.ts`、`src/storage/paths.ts`、`src/tools/builtin.ts`、`chat.ts`。

## Findings

### [MEDIUM] Skill 元数据注入 system prompt（LLM01/LLM06 攻击面，权限未在代码层强制）

- **Location:** `src/skills/prompt.ts:75-77`、`src/prompts/templates/base-agent.md:47`、`src/tools/builtin.ts:373-431`
- **Description:** `buildAvailableSkillsBlock` 将 skill 的 `name`/`description`（截断 240、可含多行块标量）作为指令文本注入 system prompt。SKILL.md frontmatter 属可被第三方控制的 untrusted 输入；代码层唯一强制的是 `read_file` 沙箱，而 `bash` 工具不受沙箱限制。
- **Impact:** 安装含恶意元数据的第三方 skill 后，其指令静默进入每条会话 system prompt，可通过既有 bash 工具造成任意命令执行。
- **Recommendation:** ① bash 对 skill 触发的命令加确认门控，或为 skill 执行提供受控 `run-skill` 封装；② 描述明确标注为「数据/描述」并包裹定界符；③ S2 引入 marketplace 前书面确定信任边界（当前 custom+marketplace 声明为 TRUSTED）。

### [MEDIUM] Skill 脚本以宿主全权限执行

- **Location:** `bin/run-skill.cjs:97-127`（`import()`/`require()` 进 CLI 进程）、`129-149`（`spawn` 未指定 env，继承 `process.env`）
- **Description:** JS 脚本以完整 Node 权限运行；Python 子进程继承全部环境变量。恶意脚本进入 `skills/` 或 `marketplace/skills/` 即可窃取 provider API 凭据。
- **Impact:** 条件性任意代码执行 + 凭据访问（LLM06）。与既有 `bash` 全权限一致，非新增提权，但缺少对 skill 脚本持久化执行面的隔离。
- **Recommendation:** ① `runPython` 显式裁剪 env；② 评估独立子进程/OS 沙箱执行 JS（成本高则记录风险接受）；③ 文档明确「skill 脚本 = 可执行代码」，安装第三方 skill 前须人工审查 `scripts/`。

### [LOW] 文件工具对 skill 根可写，可跨会话持久化恶意脚本

- **Location:** `src/tools/builtin.ts:531-539`
- **Description:** `resolvePath` 的 roots 同时用于读与写，LLM 可向 skill 目录写文件（含 `scripts/*.mjs`），被注入的会话可植入载荷供后续会话执行。
- **Recommendation:** 对 skill 根默认只读放行，`resolvePath` 区分 `isWrite` 时排除两个 skill 根（S2 走 CRUD + 门控）。

### [LOW] 沙箱未做 realpath，symlink/junction 可逃逸

- **Location:** `src/storage/path-sandbox.ts:21-33`
- **Description:** `guardPath` 仅 `path.resolve` 规范化，跟随符号链接；允许根内预置 symlink 可逃逸到根外。
- **Recommendation:** 允许根存在 symlink 风险时 `guardPath` 增加 `fs.realpathSync` 复核（建议 S2 做）。

### [LOW] 错误信息泄露绝对路径/脚本内容片段

- **Location:** `bin/run-skill.cjs:197-200`（`searched` 全量绝对路径）、`102/118`（module load `err.message` 含代码帧）
- **Description:** 未找到脚本时 JSON error 携带完整候选路径；加载失败错误可能含源码行。
- **Recommendation:** 对外错误仅输出 `{ ok:false, error: <精简> }`；`searched` 改相对根路径或省略；模块加载失败仅输出错误名与 basename。

## Positive Observations

- 路径穿越防御三层一致且实测有效（`assertPathSegment` 同语义，`..`/`/`/`\` 变体全拒，单 `.` 不误伤）
- 无命令注入：`run-skill` 全程 `spawn` 参数数组，无 `shell: true` 与字符串拼接
- 沙箱为白名单且只最小扩展（未开放整个 dataRoot，sessions/providers.json/config.json 不可达）
- SKILL.md 正文不进 system prompt（菜单仅注入 ≤240 描述），架构上压缩注入面
- 脚本 ctx 最小化 `{ args, skillId, skillDir }`；错误走 stderr、仅 `err.message` 不含 stack
- 测试覆盖安全关键路径（穿越/校验/越界均有断言）；`npm audit --omit=dev` 0 漏洞

## 结论

**verdict: PASS_WITH_RISK** — 无 Critical/High；2 项 Medium 均依赖 marketplace 信任边界（当前 TRUSTED 声明下不爆），建议在 S2 引入第三方 marketplace 前落实：① `runPython` 裁剪 env；② skill 根写权限收口（`resolvePath` 区分读写）；③ 信任边界文档化；④ realpath 复核与错误信息精简（Low，S2 一并做）。

## Next

- 2 项 Medium 记为 B2 前置安全项（信任边界确认 + run-skill env 裁剪 + skill 根只读）
- 本批（B1）无 BLOCK 项，可进入 execution-log 收尾
