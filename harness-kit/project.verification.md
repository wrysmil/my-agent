# Project Verification

本文件描述当前项目的验证命令。

## Harness 验证

```bash
bash harness-kit/scripts/harness-check.sh
```

> 脚本位于 `harness-kit/scripts/` 时以 **source** 布局检查 kit 自身；投影与 `project.*` 更新后应在项目根执行并人工确认根目录 `AGENTS.md`、`.claude/`、`.ai-runtime-artifacts/` 子目录齐全。

## 应用验证

| 命令 | 用途 |
| --- | --- |
| `npm run check` | TypeScript 全量类型检查（tsc --noEmit） |
| `npm test` | Vitest 单元测试（`test/**/*.test.ts`） |
| `npm run test:watch` | Vitest watch 模式 |
| `npm run dev` | 完整开发启动：rebuild native addon → tsc 编译 electron → copy assets → 启动 Electron |
| `npm run build` | 生产打包（electron-builder） |
| `npm run chat` | CLI 模式 Agent（tsx chat.ts，不依赖 Electron） |

## 静态检查

| 命令 | 用途 |
| --- | --- |
| `npm run check` | TypeScript 类型检查（`tsconfig.json` 覆盖 `src/`、`test/`、`electron/`，noEmit） |
| `bash harness-kit/scripts/harness-check.sh` | Harness 文件与产物 front matter |

## 最小验证策略（Leader）

1. 改 `src/` 任意 .ts 文件：`npm run check`（类型检查）。
2. 改 `src/` 逻辑文件（含 runner、session、tools、providers）：`npm test`（Vitest 单测）。
3. 改 `electron/` 或 `src/ipc/`：`npm run check` + 手动确认 Electron 窗口启动（`npm run dev`）。
4. 改 `src/storage/` 或涉及 better-sqlite3：`npm test` + 确认 native addon 兼容（`npx @electron/rebuild -w better-sqlite3`）。
5. 声称完成前：运行与本 diff 相关的上表命令并贴输出摘要（`verification-before-completion`）。

## 待确认项

- Electron 端到端测试策略：`test/e2e/deepseek-agent.e2e.ts` 需要 `DEEPSEEK_API_KEY`，是否应纳入 CI 或仅手动跑？
- 是否需要在 CI 中跑 `npm run build`（electron-builder 打包耗时较长）？
- `vitest.config.ts` 当前仅配置 `include: ["test/**/*.test.ts"]`，是否需要添加 coverage 配置？
