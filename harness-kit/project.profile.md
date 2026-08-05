# Project Profile

本文件是当前项目画像，由 Harness 初始化（project-profiler）生成。迁移到其他项目时须重新生成并由人 review 推断项与待确认项。

## 项目身份

**my-agent（LLM Agent 运行时框架）** — 从零搭建的 Agent 框架学习项目。当前处于**早期开发阶段**（分支 `main`）：已完成 shared（错误/类型/日志）、config（Zod schema + 加载器）、tools（工具抽象层）三个基础模块；providers 适配层和 agent 主循环待实现。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 语言 | TypeScript ^5.7.0 |
| 运行时 | Node.js (ESM, `"type": "module"`) |
| 编译目标 | ES2023, NodeNext |
| 配置校验 | Zod ^3.24.0 |
| 测试框架 | Vitest ^2.0.0 |
| 执行器 | tsx ^4.0.0 |
| 类型定义 | @types/node ^22.0.0 |
| Harness | harness-kit（Claude Code 平台） |

## 主要目录

| 路径 | 职责 |
| --- | --- |
| `src/shared/` | 零依赖共享模块：错误层级（errors.ts）、消息类型（types.ts）、日志接口（logger.ts） |
| `src/config/` | Zod schema 配置系统：schema 定义（schema.ts）+ JSON 文件加载器（loader.ts） |
| `src/tools/` | 工具抽象层：AgentTool 接口、defineTool 工厂、ToolContext、toToolDefinition |
| `src/providers/` | （待实现）LLM Provider 适配层 |
| `src/agent/` | （待实现）Agent 主循环 |
| `test/` | Vitest 测试文件，与 src 模块一一对应 |
| `docs/spec/` | 框架设计规范文档 |
| `docs/plan/` | 分模块实现指南 |
| `harness-kit/` | Agent Harness 规范、适配器、脚本（勿当业务模块改） |
| `.ai-runtime-artifacts/` | spec / plan / verification / execution-log 等过程产物 |

## 禁区

- **勿读、勿提交**：`.env`、密钥、token、本机私有 MCP 配置。
- **勿在未过阶段门禁时**大规模改业务代码（Harness `routing.md`）；小改动除外。
- **勿删改** `harness-kit/` 内 `core/` 通用规则（项目差异写在 `project.*`）。
- **子 Agent 默认不** `git commit` / `push`（Leader + `git-xywh` 执行）。

## 交付口径

- 非琐碎需求：先 spec → 人确认 → plan → 人确认 → 实现 → **尾盘**：集体测试 → 集体审查（Leader 落盘）→ execution-log 完成。
- 验收标准：TypeScript strict mode 类型检查通过（`npm run check`）+ 全部单测通过（`npm test`）+ 新增逻辑有对应单测。
- 文档与根 `README.md` 不一致时，以 **已批准 spec/plan** 与当前代码为准，并记待确认项。

## 推断项

- 项目为本地学习项目，未检测到远程 Git 仓库配置
- `src/providers/` 和 `src/agent/` 目录尚未创建，处于早期开发阶段
- 无 CI/CD 配置（无 `.github/workflows`、`.gitlab-ci.yml` 等）
- 无 Git hooks（无 `.husky/`、`commitlint`）
- 包管理使用 npm（存在 `package-lock.json`）

## 待确认项

- 项目是否计划关联远程仓库？目标平台（GitHub/GitLab）？
- Provider 适配层首期计划支持哪些 LLM 提供商（Anthropic/OpenAI/其他）？
- 是否需要接入 commitlint 或 husky 等提交规范工具？
- `src/agent/` 主循环的设计是否已有明确方案？
