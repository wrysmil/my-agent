# Context Map

本文件由 Harness 初始化流程生成，用于帮助 AI 快速理解项目结构。

## 顶层结构

| 路径 | 类型 | 说明 |
| --- | --- | --- |
| `src/` | TypeScript | 源码目录，ESM 模块 |
| `test/` | TypeScript | Vitest 测试文件 |
| `docs/spec/` | 文档 | 框架设计规范（仿写Agent框架指南.md） |
| `docs/plan/` | 文档 | 分模块实现指南（第一阶段实现指南.md） |
| `harness-kit/` | Harness | Agent Harness 脚手架（不入仓） |
| `.ai-runtime-artifacts/` | 产物 | AI 运行时产物（不入仓） |
| `.claude/` | 配置 | Claude Code 平台适配层 |
| `node_modules/` | 依赖 | npm 依赖（不入仓） |

## 主要入口

| 入口 | 说明 |
| --- | --- |
| `package.json` | npm 包配置，scripts: check / test / test:watch |
| `tsconfig.json` | TypeScript 配置，strict mode，target ES2023，module NodeNext |
| `vitest.config.ts` | Vitest 配置，include `test/**/*.test.ts` |
| `AGENTS.md` | 工具中立 Harness 顶层入口 |
| `CLAUDE.md` | Claude Code 平台入口 |
| `harness-kit/core/routing.md` | 路由表与阶段门禁 |

## 关键模块

| 模块 | 路径 | 说明 |
| --- | --- | --- |
| 错误系统 | `src/shared/errors.ts` | 6 种错误类 + 可重试分类算法（classifyRetryableError） |
| 消息类型 | `src/shared/types.ts` | 5 种 ContentBlock、Message、Usage、StopReason、StreamEvent |
| 日志接口 | `src/shared/logger.ts` | Logger 接口 + createLogger 工厂（按级别过滤） |
| 配置 Schema | `src/config/schema.ts` | Zod schema：Provider/Model/Memory/Agent/Metacognition/Evolution/CoreAgent |
| 配置加载 | `src/config/loader.ts` | loadConfig（JSON→解析）、createConfig（部分→完整默认值） |
| 工具抽象 | `src/tools/base.ts` | AgentTool 接口、defineTool 工厂、ToolContext、ToolDefinition 转换 |

## 读码优先级

1. 任务相关：`harness-kit/project.profile.md` → 本文件 → `harness-kit/core/routing.md`
2. 实现新模块：`src/` 对应子目录 + `docs/plan/第一阶段实现指南.md`
3. 修改配置：`src/config/schema.ts` → `src/config/loader.ts`
4. 修改类型/错误：`src/shared/types.ts`、`src/shared/errors.ts`（零依赖，影响全局）
5. 避免先读：`docs/spec/仿写Agent框架指南.md`（全文约 72KB，按需分段读取）

## 待确认项

- `src/providers/` 和 `src/agent/` 目录的具体模块划分方式
- 是否需要新增 `src/index.ts` 作为框架统一入口
