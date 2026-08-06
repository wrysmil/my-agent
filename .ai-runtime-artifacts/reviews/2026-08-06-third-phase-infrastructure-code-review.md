---
artifact: review
route: orchestration:dispatcher-workflow -> batch-closeout
skills:
  - requesting-code-review
  - orchestration
skills_evidence:
  - .claude/skills/requesting-code-review/SKILL.md
  - .claude/skills/orchestration/SKILL.md
source:
  - .ai-runtime-artifacts/plans/2026-08-06-third-phase-infrastructure-plan.md
created_at: 2026-08-06
batch_id: GROUP-1
worktree_id:
worktree_path:
reviewer_instance: reviewer
verdict: APPROVE
---

# 第三阶段：基础设施（存储与安全）集体代码审查

> **写入者：** Leader（收到 `reviewer` 返回后落盘）。Reviewer 为 readonly，不 Write 本文件。

## 防跳过提醒

| 合理化借口 | 现实 |
|-----------|------|
| "改动不大，审查可以轻一点" | 小改动可能引入全局影响。边界的代码最危险 |
| "时间紧，快速过一下" | 匆忙通过的审查等于没审查 |
| "都是自己人写的，放心" | 信任 ≠ 不审查。审查是为了质量，不是怀疑 |
| "这个 WU skip_reviewer_eligible" | 只有满足所有跳过条件的小 WU 才能跳过，不是 Leader 说了算 |

## 审查范围

- 提交序列：`b91ebf1`（paths.ts）→ `2697996`（迁移）→ `7967873`（sandbox）→ `8718a04`（JSONL 并发）→ `07087c1`（locks）→ `5c8bc0b`（session kind）→ `1d42515`（README）
- review-fix 未提交改动（4 文件）：
  - `src/agent/persistent-session.ts`（构造器 assertPathSegment）
  - `src/storage/session-store.ts`（create kind 运行时校验）
  - `src/agent/session.ts`（基类 4 方法改真正 async）
  - `src/agent/runner.ts`（8 处持久化调用全量 await）
- 新增测试 5 文件 + `test/persistent-session.test.ts` 更新
- BASE_SHA：`a5ecffe`（t1 前） / HEAD_SHA：`1d42515`（+ review-fix 工作区）

## 变更尺寸评估

| 指标 | 值 | 判定 |
|------|----|------|
| 变更行数 | 约 1200（7 commit + review-fix） | >300，已按 7 个 Task 拆分提交，每个独立可审查 |
| 变更文件数 | 约 16（src 9 / test 6 / docs 1） | ≤20 可接受，逻辑按模块内聚 |

## 对照依据

- spec：第三阶段升级指南（`docs/plan/` 已迁移至 `.ai-runtime-artifacts/plans/`）
- plan：`.ai-runtime-artifacts/plans/2026-08-06-third-phase-infrastructure-plan.md`
- done criteria 勾选：`自审清单` 全部通过（见计划文件 § 自审清单）

## Findings

### Critical

- 无

### Important

- 无（初轮 2 项已修复，见下方"初轮 BLOCK 与修复"）

### Suggestion

- `appendJsonLineAtomic` 目前依赖调用方 await 保证顺序；若未来引入"写入失败静默降级"需求，建议在 `PersistentSession` 层统一错误策略（重试 vs 抛出 vs 记录），避免散落各调用点。
- `sweepEphemeralSessions` 的 GC 尚未接入调度器，建议在后续 CLI/会话管理批次接入定时触发与白名单配置。

### Nit

- `session-store.ts` 中 `KNOWN_KINDS_RE` 与 `EPHEMERAL_KINDS` 存在重复枚举 kind 字符串，后续新增 kind 时需同步三处；可考虑提取单一 kind 常量表。

## 初轮 BLOCK 与修复

Reviewer 初轮 verdict：**BLOCK**。共 2 项 Important：

| ID | 问题 | 修复提交位置 |
|----|------|--------------|
| I-1 | 路径段防御存在可绕过入口：`PersistentSession` 构造器在显式传入 `sessionDir` 路径时未执行 `assertPathSegment`（仅 load 静态方法有）；`SessionStore.create` 的 kind 参数无运行时白名单校验，恶意 kind 可拼入 sessionId 进而进 `path.join` | `persistent-session.ts` 构造器无条件 `assertPathSegment(this.sessionId, "sessionId")`（L79）；`session-store.ts` create 运行时校验 kind ∈ {gconv,cli,anon,extract}（L128），get/delete 经 `sessionKindOf` + `assertPathSegment`（L145/L178） |
| I-2 | runner.ts 8 处对已变 async 的持久化方法 fire-and-forget 调用 → unhandled promise rejection 风险 / 进程退出时数据丢失；基类返回类型宽化联合类型（`number | Promise<number>`）是"隐藏异步"反模式 | 基类 `Session` 4 方法（beginUserTurn/addAssistantMessage/addToolResult/addMessage）改**真正 `async`**，返回 `Promise<number>`/`Promise<void>`（诚实契约）；runner.ts 全部调用点 await（含 appendSteerMessages/foldSteer 递归链路） |

**修复后验证（Leader 重跑）：**

- `npm run check` → exit 0（tsc --noEmit 无错误）
- `npm test` → 20 文件：19 通过 / 272 passed；4 失败全部为 `test/cli-io.test.ts` 既有失败（pre-existing，与 `src/cli/io.ts` 未提交改动及 Windows ANSI 环境相关，见 collective-test 记录，非本批次引入）

## 结构疗法建议（可选）

| 重构模式 | 适用场景 | 建议 |
|---------|---------|------|
| 分离编排与逻辑 | runner 长时间单方法 | 后续批次可评估将 runWithProvider 的 2a–2k 阶段提炼为命名步骤 |

## 死代码 / 孤儿代码检查

- [x] 重构后是否存在无引用的函数/类型/文件 → 无（`paths.ts` 全函数被引用；旧 `defaultSessionDir`/`defaultProvidersFilePath` 已移除）
- [x] 是否存在注释掉的代码块未清理 → 无
- [x] 旧实现是否已完全移除（而非仅标记 deprecated）→ 是（迁移后旧路径构造函数已删除）

## 证据

- Reviewer 已读：plan、7 个 commit diff、review-fix 4 文件改动、storage README
- Leader 已跑：`npm run check`（0）、`npm test`（272/276，4 失败为既有 cli-io）
- 集体测试产物：`.ai-runtime-artifacts/verifications/2026-08-06-third-phase-infrastructure-collective-test.md`（PASS）

## 未验证项

- `harness-check.sh`（Windows 无 bash/WSL，环境限制）
- `test/cli-io.test.ts` 4 项既有失败（超本批次 scope，留给后续 CLI 批次）

## 结论

**verdict:** APPROVE

初轮 BLOCK 的 2 项 Important（I-1 路径防御绕过、I-2 fire-and-forget 异步）已全部修复并通过验证；本批次相关测试全绿；无剩余 Critical / Important。

## Next

- APPROVE → 批次可关闭：更新 execution-log 并落盘本产物；提交 review-fix 改动
