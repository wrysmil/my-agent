# Context Map

本文件由 Harness 初始化流程生成，用于帮助 AI 快速理解项目结构。

## 顶层结构

| 路径 | 类型 | 说明 |
| --- | --- | --- |
| `src/` | TypeScript | Agent 核心源码（agent、providers、tools、storage、ipc、config、prompts、skills） |
| `electron/` | TypeScript | Electron 主进程入口（main.ts + preload） |
| `test/` | TypeScript | Vitest 单元测试与 E2E（`test/e2e/`） |
| `scripts/` | JS | 构建辅助脚本（copy-assets.mjs） |
| `docs/` | Markdown | 设计文档：spec、plan、superpowers |
| `dist/` | 编译产物 | tsc 输出（不入仓） |
| `node_modules/` | 依赖 | npm 依赖（不入仓） |
| `harness-kit/` | 文档/配置 | Harness 规范与 Claude Code 适配源 |
| `.ai-runtime-artifacts/` | 产物 | AI 过程文档（spec/plan/log/review） |
| `.claude/` | 工具 | Claude Code rules、skills、hooks 投影 |
| `chat.ts` | CLI | 命令行 Agent 聊天入口 |
| `config.json` | 配置 | Agent 运行时默认参数（模型、重试、超时） |
| `AGENTS.md` | 入口 | 工具中立 Harness 顶层契约 |
| `CLAUDE.md` | 入口 | Claude Code Harness 覆盖层 |

## 主要入口

| 入口 | 说明 |
| --- | --- |
| `electron/main.ts` | Electron 主进程：创建 BrowserWindow、动态加载 IPC handlers |
| `src/agent/index.ts` | AgentRunner + Session 统一导出（核心 API 入口） |
| `src/ipc/index.ts` | IPC handler 注册聚合（sessions、skills、chat、config） |
| `chat.ts` | CLI 模式：`npm run chat` → tsx 执行 |
| `config.json` | 静态默认配置（模型/Provider/tool 循环上限等） |
| `AGENTS.md` | 工具中立 Harness 顶层入口 |
| `harness-kit/core/routing.md` | 路由表与阶段门禁 |

## 关键模块

| 模块 | 路径 | 说明 |
| --- | --- | --- |
| Agent 主循环 | `src/agent/runner.ts` | AgentRunner：LLM 调用 → tool_use → 工具执行 → 结果注入 → 循环，支持流式/阻塞 |
| 会话管理 | `src/agent/session.ts` | Session：对话历史、执行计划（ExecutionPlan）、已完成工作账本 |
| 持久化会话 | `src/agent/persistent-session.ts` | PersistentSession：SQLite 持久化的会话，含序列化/反序列化 |
| Provider 适配 | `src/providers/deepseek.ts` | DeepSeek API 适配器（chat completions + streaming） |
| Provider 注册 | `src/providers/registry.ts` | Provider 工厂注册表（按名查找 Provider 实现） |
| 工具系统 | `src/tools/base.ts`、`src/tools/builtin.ts` | Tool 接口 + 内置工具（计算器、文件操作等） |
| 存储层 | `src/storage/db.ts` | better-sqlite3 数据库初始化（WAL 模式、migrations） |
| 数据仓库 | `src/storage/session-repo.ts`、`usage-repo.ts`、`provider-repo.ts` | 会话/用量/Provider 配置的 CRUD |
| 文件锁 | `src/storage/locks.ts` | 跨进程文件锁（SQLite 单写者保障） |
| 加密 | `src/util/crypto.ts` | AES-256-GCM 加密/解密（存储敏感配置） |
| 配置加载 | `src/config/loader.ts` | 从 config.json + env 加载并 Zod 校验配置 |
| Prompt 构建 | `src/prompts/system-prompt-builder.ts` | 运行时 system prompt 组装（模板 + 工具列表 + 上下文） |
| Skill 加载 | `src/skills/loader.ts` | 文件系统 Skill 加载与解析 |
| IPC 桥接 | `src/ipc/*.ts` | Electron IPC handlers（暴露给渲染进程的 API） |
| 共享层 | `src/shared/errors.ts`、`logger.ts`、`types.ts` | 零依赖基础类型与工具 |

## 读码优先级

1. 任务相关：`harness-kit/project.profile.md` → 本文件 → `harness-kit/core/routing.md`
2. 改 Agent 核心：`src/agent/runner.ts` → `src/agent/session.ts` → `src/agent/types.ts`
3. 改 Provider：`src/providers/base.ts` → `src/providers/deepseek.ts` → `src/providers/registry.ts`
4. 改存储：`src/storage/db.ts` → 对应 repo → `src/storage/locks.ts`
5. 改 Electron：`electron/main.ts` → `src/ipc/index.ts` → 对应 handler
6. 改 CLI：`chat.ts`（独立入口，不依赖 Electron）
7. 避免先读：旧 spec/plan（`docs/plan/第一阶段实现指南.md` 等）可能与当前代码不同步

## 待确认项

- `electron/renderer/` 目录是否已存在及渲染进程前端技术栈（当前 `electron/main.ts` 加载 `renderer/index.html`）。
- `src/skills/` 与 `.claude/skills/` 的区分：前者是 Agent 运行时的 skill 系统，后者是 Claude Code 的 skill 镜像。
