---
artifact: verification
route: orchestration:dispatcher-workflow -> batch-closeout
skills:
  - verification-before-completion
skills_evidence:
  - .claude/skills/verification-before-completion/SKILL.md
source:
  - project.verification.md
created_at: 2026-08-06
batch_id: GROUP-1
worktree_id: 
worktree_path: 
verdict: PASS
---

# 第三阶段：基础设施（存储与安全）集体测试

> **纪律：** 先 Load **verification-before-completion**；先跑命令、再给结论。
> **写入者：** Leader。

## 变更范围

- `src/storage/paths.ts`（新建，路径常量 + assertPathSegment）
- `src/storage/path-sandbox.ts`（新建，路径白名单门控）
- `src/storage/locks.ts`（新建，session/file 锁）
- `src/storage/jsonl.ts`（增量：appendJsonLineAtomic + readJsonLinesPage）
- `src/storage/session-store.ts`（增量：kind 路由 + GC + 路径防御）
- `src/storage/providers-store.ts` / `src/storage/index.ts`（迁移 + 导出）
- `src/agent/session.ts` / `src/agent/persistent-session.ts` / `src/agent/runner.ts`（async 追加迁移 + load 防御 + list 正则）
- `src/tools/builtin.ts`（resolvePath 沙箱门控）
- `src/storage/README.md`（新建）
- `test/storage/{paths,path-sandbox,jsonl-atomic,locks,session-store-kind}.test.ts`（新建 5 文件）
- `test/persistent-session.test.ts`（async await + 断言更新）

## WU 已覆盖项（引用，非替代）

| WU | 命令/结论摘要 |
| --- | --- |
| Task 1 | paths.test.ts 9/9 |
| Task 2 | npm run check 通过；npm test 无新增失败 |
| Task 3 | path-sandbox.test.ts 11/11 |
| Task 4 | jsonl-atomic.test.ts 6/6；persistent-session.test.ts async 迁移后通过 |
| Task 5 | locks.test.ts 6/6 |
| Task 6 | session-store-kind.test.ts 12/12；list 正则捕获组缺陷修复 |
| Task 7 | docs-only |

## 命令表

| 命令 | cwd | exit | 关键输出摘要 |
| --- | --- | --- | --- |
| `npm run check` | 项目根 | 0 | tsc --noEmit 无错误 |
| `npx vitest run test/storage test/persistent-session.test.ts` | 项目根 | 0 | 6 文件 64/64 通过（本批次全部相关测试） |
| `npx vitest run` | 项目根 | 1 | 19/20 文件通过；272/276 通过；4 失败全部为 `test/cli-io.test.ts` 既有失败 |
| `bash harness-kit/scripts/harness-check.sh` | 项目根 | 1 | 环境限制：Windows 无 bash/WSL，脚本无法运行（非应用问题） |

## 集成 / E2E

- 无独立 E2E WU；`test/chat-full-flow.test.ts` 等既有集成测试通过（含在 19 passed 内）

## 未验证项

- `harness-check.sh`（无 bash 环境）
- cli-io 颜色 helper 的 ANSI 输出行为（Windows 终端，既有）

## 残留风险

- **既有失败（非本批次引入）：** `test/cli-io.test.ts` 4 个失败在会话开始前已存在
  - 3 个颜色 helper 断言（`\x1b[31m①\x1b[0m` ANSI 期望 vs 环境不输出 ANSI）
  - 1 个 prompt 断言（`src/cli/io.ts` 未提交改动 `rl.question` → `process.stdout.write + rl.once("line")`）
  - 验证：`git stash push -- src/cli/io.ts` 后仍 3 个失败 → 与本批次（仅改 storage/agent/tools）无关
- `appendJsonLineAtomic` 迁移使 `Session.beginUserTurn` 等 4 方法返回 `number | Promise<number>`；runner.ts 仅 L1100 await，其余调用点 fire-and-forget（追加仍串行落盘，进程退出时机需注意）

## 结论

**verdict:** PASS（本批次相关测试 64/64 全绿；全量 272/276，4 个既有 cli-io 失败与本批次无关）

## Next

- PASS → 进入集体代码审查（`artifact-templates/code-review.md`）
