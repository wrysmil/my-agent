# CLAUDE.md

## Worktree 使用门禁

- 任何创建、进入或让子 Agent 使用 Git worktree 的操作，都必须先向用户说明原因、目标与影响，并获得用户明确同意。
- 未获得本轮明确同意前，禁止调用 `EnterWorktree`，也禁止以 `isolation: "worktree"` 派发 Agent；不得通过 `git worktree add`、`--worktree` 或其他等价方式绕过门禁。
- 用户同意仅对当前明确的 worktree 操作生效；后续新的 worktree 或不同目标仍需重新确认。


项目背景与共享规则：**`harness-kit/entrypoints/HARNESS-PLATFORM-ENTRY.md`**。

1. 读取上述共享入口 + 根目录 `AGENTS.md`（Harness 覆盖层）
2. **多 task 实现**：Load **`orchestration`** → `harness-kit/core/orchestration/dispatcher-workflow.md`（绑定见 `adapters/claude/bindings.md`）
若本文件与 `AGENTS.md` 冲突，以 `AGENTS.md` 为准。
