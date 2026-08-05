# Electron 启动失败 — 根因分析与架构审查报告

**日期：** 2026-08-05  
**审查范围：** Electron 启动流程、构建链、架构设计  
**结论：** 2 个 BLOCK 问题 + 3 个架构隐患；**无需全面重构 Electron，但需要关键修复**

---

## 1. 诊断过程

| 步骤 | 发现 | 结论 |
|------|------|------|
| `tsc --noEmit` | 编译通过，无类型错误 | TypeScript 编译正常 |
| `electron .` | `TypeError: Cannot read properties of undefined (reading 'whenReady')` | `require("electron")` 未返回正确模块 |
| 诊断 `require("electron")` | 返回 `string`（`electron.exe` 路径），非 `object` | Electron 内建模块未注入 |
| 检查 `process.type` | `undefined`（应为 `"browser"`） | Electron 主进程环境未初始化 |
| 检查 `process.versions.electron` | `33.4.11` ✅ | 确认运行在 Electron 的 Node.js 运行时内 |
| 检查 `ELECTRON_RUN_AS_NODE` 环境变量 | **`1`**（所有作用域） | 🔴 **根因！** |
| 清除后测试 | `process.type: browser` ✅ `has app: true` ✅ | Electron 正常启动 |

---

## 2. 根因分析

### BLOCK #1 (P0): `ELECTRON_RUN_AS_NODE=1` 环境变量

**影响：** 所有 Electron 应用在受影响的环境中完全无法启动。

**原理：** 当 `ELECTRON_RUN_AS_NODE=1` 时，Electron 将自身当作普通 Node.js 运行：
- 不初始化 Chromium/Electron 主进程环境 → `process.type = undefined`
- 不注入 `electron` 内建模块 → `require("electron")` 降级到 npm 包的 `index.js`
- npm 包的 `electron/index.js` 只返回 `electron.exe` 的文件路径（字符串），不是 Electron API

**定位：** 该变量在**进程环境**中设置（不在注册表 User/Machine 作用域），由父进程（Shell/IDE）继承。可能的来源：
- 某个启动脚本或 profile 文件（`.bashrc`、`.ps1` 等）中 `export ELECTRON_RUN_AS_NODE=1`
- 某个 `npx`/`npm` 包装脚本
- 终端模拟器或 VSCode 的启动环境配置

**修复：**
```
# 临时（当前终端）：
unset ELECTRON_RUN_AS_NODE          # bash/zsh
Remove-Item env:ELECTRON_RUN_AS_NODE  # PowerShell

# 永久：找到并删除设置该变量的脚本/profile 中的 export 语句
```

### BLOCK #2 (P1): `better-sqlite3` NODE_MODULE_VERSION 不匹配

**影响：** BLOCK #1 修复后，Electron 启动但 `better-sqlite3` 加载失败。

**现象：**
```
NODE_MODULE_VERSION 120 → 120 (当前 better-sqlite3 编译版本)
NODE_MODULE_VERSION 130 → 130 (Electron 33 要求版本)
```

**原因：** Electron 33 基于 Node 20.18.3 但使用了 ABI 版本 130（系统 Node 21.7.3 使用 ABI 120）。`better-sqlite3` 需要针对 Electron 的 headers 重新编译。

**修复（二选一）：**

| 方案 | 操作 | 前提条件 |
|------|------|----------|
| A) `@electron/rebuild` | `npx @electron/rebuild -w better-sqlite3` | 需要 Visual Studio Build Tools 2022（含 C++ 工作负载） |
| B) 切换为纯 JS SQLite | 替换 `better-sqlite3` → `sql.js`（WASM 实现） | 修改 `src/storage/db.ts` 适配新 API |

---

## 3. 架构问题

以下问题**不影响启动**，但构成技术债务：

### 3.1 双份 main 入口（冗余维护）

[electron/main.ts](electron/main.ts) 和 [electron/main.cjs](electron/main.cjs) 包含**几乎相同的代码**：
- `main.ts` — ESM 风格，编译为 `dist/electron/main.js`（**从未被 Electron 加载**）
- `main.cjs` — CJS wrapper，通过 `copy-assets.mjs` 复制到 `dist/electron/main.cjs`（**实际入口**）

`dist/electron/main.js`（编译产物）是**死代码**，永远不被加载。真正的入口 `main.cjs` 需要手动保持与 `main.ts` 同步，极易产生不一致。

### 3.2 `"type": "module"` 与 Electron CJS 不兼容

[package.json](package.json) 设置 `"type": "module"`，这导致：
- 所有 `.js` 文件被解析为 ESM
- 但 Electron 的内建 `electron` 模块只能通过 `require()` (CJS) 访问
- 因此被迫使用 `.cjs` 扩展名 + 手动复制的方式绕过

### 3.3 构建链复杂度

`dev` 脚本链式执行 4 个命令：
```
npx @electron/rebuild -w better-sqlite3 && tsc -p tsconfig.electron.json && node scripts/copy-assets.mjs && electron .
```
- 任一环节失败，整个启动失败
- `@electron/rebuild` 即使成功过，后续 `npm install` 也可能覆盖编译好的 `.node` 文件
- `copy-assets.mjs` 是弥补 `"type": "module"` 问题的补丁

---

## 4. 是否需要重构 Electron？

### 结论：**不需要全面重构，但建议优化架构。**

| 方面 | 评估 |
|------|------|
| 启动阻塞 | **P0** — `ELECTRON_RUN_AS_NODE` 环境变量污染（非代码问题） |
| 启动阻塞 | **P1** — `better-sqlite3` ABI 不匹配（构建环境问题） |
| 代码质量 | **P2** — 双份 main 入口冗余（技术债务） |
| 构建链 | **P2** — dev 脚本脆弱（建议合并简化） |

### 推荐行动计划

**立即执行：**
1. 找到并移除 `ELECTRON_RUN_AS_NODE=1` 的设置源
2. 安装 Visual Studio Build Tools 2022，运行 `@electron/rebuild`

**短期优化（本次迭代）：**
3. 淘汰 `electron/main.ts`（ESM 版本）和 `dist/electron/main.js`（死代码），以 `electron/main.cjs` 为唯一入口源
4. 将 `copy-assets.mjs` 合并到 `tsc` 构建步骤（或用 `npm` 脚本的 `postbuild` hook）

**中期改善（下一个迭代）：**
5. 评估是否用 `sql.js` 替代 `better-sqlite3`（消除原生模块依赖，简化构建链）
6. 评估是否引入 `electron-vite` 或 `electron-forge` 标准化构建流程

---

## 5. 附录：诊断命令速查

```bash
# 检查 ELECTRON_RUN_AS_NODE
echo $ELECTRON_RUN_AS_NODE          # bash
$env:ELECTRON_RUN_AS_NODE            # PowerShell

# 清除（当前会话）
unset ELECTRON_RUN_AS_NODE           # bash
Remove-Item env:ELECTRON_RUN_AS_NODE # PowerShell

# 验证 Electron 环境
node_modules/electron/dist/electron.exe -e "console.log(process.type)"
# 应输出: browser

# 重建原生模块
npx @electron/rebuild -w better-sqlite3
```
