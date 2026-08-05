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
| `npm test` | 运行全部 Vitest 单测（vitest run） |
| `npm run test:watch` | 监听模式运行测试（vitest） |

## 静态检查

| 命令 | 用途 |
| --- | --- |
| `npm run check` | TypeScript 类型检查（tsc --noEmit） |

## 最小验证策略（Leader）

1. 改 `src/` 任何文件：`npm run check && npm test`
2. 改 `test/` 测试文件：`npm test`
3. 改 `tsconfig.json` 或 `vitest.config.ts`：`npm run check && npm test`
4. 声称完成前：运行与本 diff 相关的上表命令并贴输出摘要（`verification-before-completion`）

## 待确认项

- 后续是否需要新增 lint（ESLint）或格式化（Prettier）检查？
- 是否需要新增 E2E 或集成测试命令（`src/providers/` 或 `src/agent/` 实现后）？
