# CLAUDE.md

## Harness（Claude Code）

项目背景：My Agent — 基于 Electron + TypeScript 的 LLM Agent 桌面运行时，自研 AgentRunner 主循环（工具调用、会话管理、SQLite 持久化），以 DeepSeek 为主要 LLM Provider。当前处于 Electron 桌面化阶段（feature/plan-a-electron-shell）。共享规则：**`harness-kit/entrypoints/HARNESS-PLATFORM-ENTRY.md`**。

1. 读取上述共享入口 + 根目录 `AGENTS.md`（Harness 覆盖层）
2. **多 task 实现**：Load **`orchestration`** → `harness-kit/core/orchestration/dispatcher-workflow.md`（绑定见 `adapters/claude/bindings.md`）
若本文件与 `AGENTS.md` 冲突，以 `AGENTS.md` 为准。
