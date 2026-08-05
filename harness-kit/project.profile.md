# Project Profile

本文件是当前项目画像，由 Harness 初始化（project-profiler）生成。迁移到其他项目时须重新生成并由人 review 推断项与待确认项。

## 项目身份

**my-agent（LLM Agent 桌面运行时）** — 从零搭建的 Electron 桌面应用，内置 LLM Agent 主循环（工具调用、会话管理、持久化），以 DeepSeek 为主要 Provider。当前处于 **Electron 桌面化阶段**（分支 `feature/plan-a-electron-shell`）：将 CLI Agent 包装为 Electron 窗口应用，通过 IPC 桥接渲染进程与主进程。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面壳 | Electron 33、Node.js (ESM)、better-sqlite3（native addon） |
| 语言 | TypeScript 5.7、ES2023、strict 模式 |
| Agent 核心 | 自研 AgentRunner（LLM 调用 → 工具执行 → 流式/阻塞结果）、Session/PersistentSession |
| LLM Provider | DeepSeek（deepseek-chat / deepseek-reasoner） |
| 配置 | Zod schema + config.json |
| 测试 | Vitest 2.x |
| 构建 | tsc（双 tsconfig：默认 noEmit 检查、electron 编译到 dist/） + electron-builder |
| 存储 | better-sqlite3（会话、用量、Provider 配置）、JSONL（对话历史归档） |
| IPC | Electron contextBridge + preload（渲染进程 ↔ 主进程 handlers） |
| Harness | harness-kit（目录拷贝接入） |

## 主要目录

| 路径 | 职责 |
| --- | --- |
| `src/agent/` | AgentRunner、Session/PersistentSession、执行计划、上下文压缩 |
| `src/providers/` | LLM Provider 抽象层（base → DeepSeek 适配 + 注册表） |
| `src/tools/` | 工具抽象（Tool 接口、内置工具集） |
| `src/storage/` | SQLite 数据层（db、session-repo、usage-repo、provider-repo、locks）+ JSONL 归档 |
| `src/ipc/` | Electron IPC handlers（sessions、skills、chat、config） |
| `src/config/` | Zod schema 配置加载与校验 |
| `src/prompts/` | System prompt 构建器、运行时上下文注入 |
| `src/skills/` | Skill 加载器与类型 |
| `src/shared/` | 零依赖共享：错误类型、日志、通用类型 |
| `src/util/` | 工具函数（AES-256-GCM 加密等） |
| `electron/` | Electron 主进程入口（main.ts → BrowserWindow + IPC init） |
| `scripts/` | 构建辅助（copy-assets.mjs） |
| `test/` | Vitest 单元测试（含 e2e/） |
| `docs/` | 设计文档：spec/、plan/（含重构指南与桌面 UI spec） |
| `chat.ts` | CLI 聊天入口（`npm run chat`） |
| `config.json` | Agent 运行时默认配置（模型、provider、重试策略） |
| `harness-kit/` | Agent Harness 规范、适配器、脚本（勿当业务模块改） |
| `.ai-runtime-artifacts/` | spec / plan / verification / execution-log 等过程产物 |

## 禁区

- **勿读、勿提交**：`.env`（含 `DEEPSEEK_API_KEY`）、密钥、token、本机私有 MCP 配置。
- **勿在未过阶段门禁时**大规模改业务代码（Harness `routing.md`）；小改动除外。
- **勿删改** `harness-kit/` 内 `core/` 通用规则（项目差异写在 `project.*`）。
- **子 Agent 默认不** `git commit` / `push`（Leader + `git-xywh` 执行）。
- **better-sqlite3 是原生模块**：Electron ABI 需 `@electron/rebuild` 重编译；`npm run dev` 已内置此步骤。
- **electron/main.ts 使用 lazy-load**：IPC handlers 和 db 模块在 `app.whenReady()` 内动态 `import()`，避免 better-sqlite3 在非 Electron 环境下崩溃。

## 交付口径

- 非琐碎需求：先 spec → 人确认 → plan → 人确认 → 实现 → **尾盘**：集体测试 → 集体审查（Leader 落盘）→ execution-log 完成。
- 验收标准：`npm run check`（tsc --noEmit）通过 + `npm test`（vitest run）通过 + Electron 窗口可正常启动。
- 文档与根 `README.md` 不一致时，以 **已批准 spec/plan** 与当前代码为准，并记待确认项。

## 推断项

- 基于 `package.json` scripts：开发用 `npm run dev`（rebuild + tsc + copy-assets + electron .），生产打包用 `npm run build`（electron-builder）。
- 基于 `config.json`：默认 Provider 为 DeepSeek，模型 deepseek-chat（支持 tools/streaming）和 deepseek-reasoner（仅 streaming）。
- 基于 git log 提交格式：Angular 风格 + `Co-Authored-By: Claude`，分支命名 `feature/` 前缀。
- 基于 `src/ipc/` 结构：渲染进程通过 preload (contextBridge) 暴露 API，主进程 handlers 分别处理 sessions/skills/chat/config 四个域。
- 基于 `docs/superpowers/` 目录：桌面 UI 设计已完成 spec + 3 个 plan（electron-shell / four-screens / core-features）。

## 待确认项

- Electron 渲染进程前端框架（`electron/renderer/index.html` 加载的是原生 HTML/JS 还是框架构建产物？）。
- better-sqlite3 数据库文件存放路径约定（`src/storage/paths.ts` 中定义）。
- 是否计划支持除 DeepSeek 外的其他 LLM Provider（`src/providers/registry.ts` 可扩展）。
- CI/CD 是否已配置（当前未发现 `.github/workflows` 或 `.gitlab-ci.yml`）。
- 是否为学习项目（README 自称）→ 交付标准是否与正式产品对齐？
