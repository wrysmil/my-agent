---
artifact: verification-lite
route: leader-direct | 小改动直做
skills:
  - verification-before-completion
  - source-driven-development
skills_evidence:
  - .claude/skills/verification-before-completion/SKILL.md
  - .claude/skills/source-driven-development/SKILL.md
source:
  - 用户：「数字菜单可以要可以加载历史对话的功能」
  - .ai-runtime-artifacts/specs/2026-08-05-cli-menu-and-provider-config.md
created_at: 2026-08-06
tier: 1
---

# 主菜单加载历史对话 — 轻量验证（Tier 1）

> **适用：** Leader 直做简单任务（≥2 写文件 / 跑测试 / fix·实现类），**不**走 spec/plan/WU 编排。
> **纪律：** Load `verification-before-completion`；先跑命令再给结论。

## 防跳过提醒

| 合理化借口 | 现实 |
|-----------|------|
| "只改了一行，不用验证" | 一行改动能破坏整个构建 |
| "上次跑过了" | 代码变了，上次不等于这次 |
| "看起来没问题" | 看起来 ≠ 验证过 |
| "太简单了，省掉吧" | 简单的变更最容易被忽略，引起的回归最难查 |
| "时间紧，跳过这次" | 跳过验证省的 2 分钟，将来 debugging 要花 2 小时 |

## 范围

- 改动文件：
  - `src/cli/menu.ts`（mainMenuChoices + renderMainMenu + runMainMenu 增 "history"）
  - `chat.ts`（pickHistoryIndex 导出 + runHistoryMenu + 主菜单 case + runChat 恢复日志）
  - `test/cli-menu.test.ts`（断言 5 项 + pickHistoryIndex 用例）
- 路由判定：Tier 1（Leader 直做）

## 文档优先（source-driven-development Step 0）

- 扫描 `.ai-runtime-artifacts/`：
  - `specs/2026-08-05-cli-menu-and-provider-config.md` — 主菜单 4 项设计基线，`--load`/`--list` 已存在
  - `plans/2026-08-06-third-phase-infrastructure-plan.md` — SessionStore.list() 元数据接口
  - `verifications/2026-08-05-cli-menu-and-provider-config-verification.md` — 历史验证
- 结论：无冲突；新增菜单项复用 `SessionStore.list()` + `SessionStore.get()` + 既有 `runChat(session)` 恢复路径

## 命令与结果

| 命令 | 结果 |
| --- | --- |
| `npx vitest run test/cli-menu.test.ts`（TDD 红） | 6 failed（预期：menu 5 项断言失败 + pickHistoryIndex 未导出） |
| `npm run check` | exit 0（tsc --noEmit 无错误） |
| `npx vitest run test/cli-menu.test.ts test/chat-bootstrap.test.ts` | 2 文件 9/9 通过 |
| `npx vitest run test/cli-menu.test.ts test/chat-bootstrap.test.ts test/chat-full-flow.test.ts` | 3 文件 26/26 通过 |
| `npm test` | 19/20 文件通过；278/281 通过；3 失败均为既有 `cli-io.test.ts` ANSI 颜色（Windows 非 TTY 环境，见第三阶段记录） |
| 运行时验证：`"2\n0\n5\n" \| npx tsx chat.ts` | 主菜单选 ② → 列出 2 个真实会话（gconv- + session- 前缀）→ 选 0 返回主菜单 |
| 运行时验证：`"/quit\n" \| npx tsx chat.ts --load gconv-9d1b719472a9` | "💬 恢复会话" + 进入对话模式 + 正常退出 |

## 追加修复：对话输入双重回显（用户反馈）

**现象：** 交互对话中输入"你好"回显为"你你好好"、每个字符重复一次。

**根因：**
1. `main()` 创建 rl A 后，`runChat()` 又 `createInterface` 创建 rl B；两个 readline 实例同时监听 `process.stdin`，terminal 模式各自回显输入 → 双重回显。菜单输入正常是因为此时仅 rl A 存在。
2. `src/cli/io.ts` 未提交改动把 `prompt`/`promptSecret` 从 `rl.question` 改为 `process.stdout.write` + `rl.once("line")`，绕过 readline 输出管线并破坏 `prompt` 单测。
3. 终端日志另见 `ndefinedm• 0. 返回主菜单`：`menuColor(0)` 的 `CYCLE[-1]` 为 `undefined`（已修复为固定色 31）。

**修复：**
- `chat.ts`：`runChat` 增加 `rl?` 参数，主菜单路径复用 `main()` 的 rl（`ownsRl` 时自建+自关）；`ask()` 改用 `rl.question("👤 ", cb)`。任意时刻仅一个 readline 实例监听 stdin。
- `src/cli/io.ts`：`prompt` 恢复 `rl.question`（`promptSecret` 维持 HEAD 原样，未使用）。
- `chat.ts`：`menuColor(0)` → 固定 `colorize("•", 31)`。

**验证（修复后）：** `npm run check` exit 0；`npm test` 278/281（prompt 测试恢复，剩 3 个既有 ANSI 颜色失败）；`--load` 路径运行时验证通过。双重回显需真实 TTY 交互确认（非 TTY 测试环境无法复现 raw mode 回显）。

## 未验证项

- 真实 TTY 交互下双重回显是否消除（需用户重启 `npm run chat` 确认；测试环境非 TTY 无法复现 raw mode 回显）
- 菜单内加载后进入完整对话（管道输入时序限制；`runHistoryMenu` 返回的 session 与 `--load` 同走 `runChat({session})`，已验证恢复路径）
- `test/cli-io.test.ts` 3 项既有 ANSI 颜色失败（超本任务 scope）

## Next

- 任务完成 → 无需暂停（除非用户要求 commit/MR）
- 范围扩大 → 补 spec/plan 或升级 Tier 2 编排
