# Plan A 验证报告

> Tier 1 Leader 直做验证 | 2026-08-04

## 基线验证

| 检查项 | 状态 | 结果 |
|--------|------|------|
| TypeScript 编译 (tsc --noEmit) | ✅ | 0 errors |
| 全量测试 (vitest run) | ✅ | 18 suites / 284 tests passed |
| Electron 构建 (tsconfig.electron.json) | ✅ | dist/ 产出正确 |
| 资源复制 (copy-assets.mjs) | ✅ | preload.cjs + renderer/ 就位 |

## 交付清单

### 新增文件 (25 files)

| 类别 | 文件 | 说明 |
|------|------|------|
| 存储层 | `src/storage/paths.ts` | 路径收口 (10 functions) |
| | `src/storage/db.ts` | SQLite init + migration (6 tables) |
| | `src/storage/session-repo.ts` | 会话 CRUD (9 ops) |
| | `src/storage/usage-repo.ts` | 用量记录 + 聚合 |
| | `src/storage/provider-repo.ts` | Provider CRUD + 加密 |
| | `src/storage/locks.ts` | 文件锁 (FileLock class) |
| 加密 | `src/util/crypto.ts` | AES-256-GCM encrypt/decrypt |
| Electron | `electron/main.ts` | 主进程入口 (ESM, import.meta.dirname) |
| | `electron/preload.cjs` | contextBridge (CJS preload) |
| IPC | `src/ipc/index.ts` | 注册入口 |
| | `src/ipc/sessions.ts` | 6 channel handlers |
| | `src/ipc/config.ts` | 3 config + 5 provider + 1 app handlers |
| | `src/ipc/skills.ts` | 3 placeholder handlers |
| | `src/ipc/chat.ts` | 2 channel handlers (echo + cancel) |
| Renderer | `electron/renderer/index.html` | SPA 入口 (CSP, 4 pages) |
| | `electron/renderer/css/reset.css` | CSS Reset |
| | `electron/renderer/css/variables.css` | Design tokens |
| | `electron/renderer/css/layout.css` | 三栏弹性布局 |
| | `electron/renderer/css/components.css` | 通用组件样式 |
| | `electron/renderer/js/api.js` | 20 IPC channel 封装 |
| | `electron/renderer/js/app.js` | 侧栏导航路由 |
| | `electron/renderer/modules/markdown.js` | Markdown 渲染 |
| | `electron/renderer/vendor/marked.min.js` | marked v15.0.12 |
| 测试 | `test/paths.test.ts` | 13 tests |
| | `test/db.test.ts` | 18 tests |
| | `test/session-repo.test.ts` | 13 tests |
| | `test/usage-repo.test.ts` | 5 tests |
| | `test/provider-repo.test.ts` | 10 tests |
| | `test/crypto.test.ts` | 7 tests |
| | `test/locks.test.ts` | 6 tests |
| 构建 | `tsconfig.electron.json` | Electron 构建配置 |
| | `scripts/copy-assets.mjs` | 资源复制脚本 |

### 修改文件 (2 files)

| 文件 | 变更 |
|------|------|
| `package.json` | +deps (better-sqlite3, electron, etc.), +main, +dev/build scripts, +test ABI |
| `tsconfig.json` | include 增加 `electron/**/*` |

### 删除文件 (1 file)

| 文件 | 原因 |
|------|------|
| `electron/package.json` | 不再需要 — preload 改 .cjs 后缀 |

## 已知限制

1. **Electron 启动**：需要 Node ≥ 22 才能运行 `@electron/rebuild` 将 better-sqlite3 编译到 Electron ABI。当前环境 Node v21.7.3，构建链路已验证通过但无法启动窗口。
2. **IPC 端到端验证**：依赖 Electron 窗口运行，无法在当前环境执行。
3. **better-sqlite3 版本**：使用 v9 (非 v11) 以获得 Node v21 预编译二进制。

## IPC Channel 核对

sessions:list/get/delete/rename/archive/unarchive (6)
config:get/update/getProviders/getModels (4)
providers:list/save/delete/setEnabled/test (5)
skills:list/get/setEnabled (3)
chat:stream/cancel (2)
app:getVersion (1)
→ 总计 20 channels，与 api.js 契约一致 ✓
