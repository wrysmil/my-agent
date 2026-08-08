---
artifact: execution-log
wu_id: WU-04d
wu_type: feature
agent_role: coder
title: F18 /theme Slash 命令循环 + localStorage 持久化 + CustomEvent 派发
plan: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md § 6 WU-04d
spec: .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md § 5.4.1 (注 2 /theme)
dispatch: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-dispatch.md (GROUP-4 / WU-04d)
created_at: 2026-08-07
status: success
---

# WU-04d (F18) — /theme 命令循环 — 执行日志

## 1. 目标

实现 `/theme` slash 命令循环(F18 第 10 个 slash 命令),不实现其他 9 个 modal
命令(留 WU-07a)。

## 2. 范围

### 2.1 允许文件(全部新建)

| 路径 | 行数 | 说明 |
| --- | ---: | --- |
| `web/js/features/theme.js` | 219 | IIFE → `window.MyAgent.themeFeature`;`installThemeCommand({ appendOutput, clearOutput })` 返回 handler |
| `test/web/features-theme.test.ts` | 530 | 30 用例,node:vm 加载 + 完整 mock(window.MyAgent.theme + appendOutput + clearOutput + localStorage + document.dispatchEvent) |

### 2.2 禁止项(遵守)

- **不**实现其他 9 个 F18 slash 命令(compact/clear/export/import/help/sessions/
  skill/agent/model) → 留 WU-07a
- **不**改 `web/js/shared/theme.js`(WU-03a 已稳定)
- **不**改 `web/index.html`(留 WU-07a 一起加 `<script defer>` 引用)

## 3. 设计决策

### 3.1 命令行为

```
/theme              → 循环到下一态(dark → light → system → dark)
/theme dark         → 直接设 dark
/Theme Dark         → 大小写不敏感 → dark
/  THEME   LIGHT    → 多余空白兼容 → light
theme System        → 无前导斜杠 → system
/theme reset        → 调 clearOutput()(可选,留 UI 备用)
/theme bogus        → 错误提示(appendOutput 一行说明)
```

### 3.2 与 WU-03a 协作

- 复用 `window.MyAgent.theme.{setTheme, getTheme, getSystemTheme}`
  (该 API 由 F15 app.js 在启动时挂载,WU-04d 不实现)
- 当前阶段若 `window.MyAgent.theme` 不存在:
  - `getCurrentTheme` 退到 `localStorage`
  - `getSystemThemeResolved` 退到 `'light'`
  - 持久化与 CustomEvent 照常派发
- 派发 `CustomEvent('my-agent:theme-change', { detail: { theme, systemTheme } })`
  (与 `shared/theme.js` 监听的 `'my-agent-theme-change'` 名称不一致;
  本 WU 严格按 spec/plan 要求使用冒号命名,留 F15 统一)

### 3.3 注册方式

```js
function installThemeCommand(options) { ... return handler; }
```

- 返回 handler 闭包(handler(rawInput) → void),便于测试直调
- 若 `window.MyAgent.slash.register` 存在,自动注册到全局派发器
- index.html 已预留 `<script defer src="./js/features/theme.js">`(F1 WU 加),
  无需修改

### 3.4 持久化与通知时序

每次成功命令:
1. `applyTheme(theme)` 内: 调 `setTheme` → 写 localStorage → 派发 CustomEvent
2. `appendOutput({ role: 'system', content: '当前主题: <t> (跟随系统: <s>)' })`

错误命令(未知值):
- 不写 localStorage
- 不调 setTheme
- 不派发事件
- 仅 `appendOutput` 一行错误提示

## 4. 验证命令(全部通过)

```bash
# [1] 文件存在
ls -la web/js/features/theme.js test/web/features-theme.test.ts
# -rw-r--r--  1 mima0000  staff   9496 Aug  7 23:42 web/js/features/theme.js
# -rw-r--r--  1 mima0000  staff  17842 Aug  7 23:42 test/web/features-theme.test.ts

# [2] JS 语法
node --check web/js/features/theme.js
# PASS  ✓

# [3] TypeScript check(整库)
npm run check
# PASS  ✓ (tsc --noEmit,0 errors)

# [4] 测试(仅 features-theme)
npm test -- test/web/features-theme
# Test Files  1 passed (1)
#      Tests  30 passed (30)
#   Duration  ~16ms
```

### 4.1 30 个用例覆盖

| 组 | 用例数 | 覆盖 |
| --- | ---: | --- |
| 全局导出 | 3 | themeFeature 挂载、常量、纯函数导出 |
| installThemeCommand 返回值 | 2 | 返回 handler;降级 noop 不抛 |
| /theme 设值 | 3 | dark / light / system 各一条 |
| /theme 无参循环 | 4 | dark/light/system 起始各一;连续三次 |
| 大小写不敏感 | 3 | /Theme Dark / 多余空白 / 无斜杠 |
| 错误处理 | 1 | 未知值不写不调不派发 |
| /theme reset | 2 | reset 调 clearOutput;大写也生效 |
| CustomEvent 派发 | 2 | type + detail;无参循环每次都派发 |
| localStorage 持久化 | 2 | 每次写;localStorage 抛错不阻塞 |
| 降级路径 | 1 | 无 window.MyAgent.theme 走 localStorage |
| 辅助函数 | 4 | nextInCycle / buildStatusMessage / normalizeArg |
| 源码约定 | 3 | 无 import/require、IIFE 包裹、MyAgent.themeFeature 挂载 |

## 5. 跨 WU 依赖 / 契约

- **F15 (app.js)**: 启动时挂载 `window.MyAgent.theme`
  (setTheme/getTheme/getSystemTheme 实现);若不挂载,本模块降级到 localStorage 仍能工作。
- **F18 (slash.js)**: `window.MyAgent.slash.register(name, handler)` 接口契约;
  本 WU 已留注册入口,silent fallback 到「不注册 + 返回 handler」模式。
- **F18 其余 9 个命令**: 留 WU-07a。

## 6. 关键决策记录

1. **`/theme reset` 行为** — spec § 5.4.1 注 2 提到 reset 但未定义具体语义;
   选「清空 transcript」(调 clearOutput)。留 UI 层可改语义,handler 是 closure 形态。

2. **大小写不敏感正则** — 允许 `/  THEME   LIGHT  `(slash 与 theme 间多个空格)。
   用 `^\s*\/*\s*theme\s+(...)$` 而非更紧的 `^\/?theme`,对真实用户输入宽容。

3. **`getThemeApi` 失败时仍派发事件** — 事件订阅者(包括 shared/theme.js)可独立收到通知,
   即使 `setTheme` 未实际改 dataset。这保证事件链不断,但要求订阅方做幂等检查。

4. **测试用 `node:vm` 而非 jsdom** — 与 shared-icons.test.ts 一致,避免引入新依赖;
   mock window.MyAgent.theme + appendOutput + clearOutput + localStorage + document。

5. **`getTheme` mock 状态可变** — 真实 API 行为:setTheme 后 getTheme 返回新值。
   测试里用 closure `let currentState = initial`,setTheme 调用时更新,getTheme 返回当前值。
   这样循环测试(dark → light → system → dark)能正确反映状态推进。

## 7. 返回

```yaml
wu_status: success
skills_loaded:
  - harness-kit/references/accessibility-checklist.md (read)
  - harness-kit/references/performance-checklist.md (read)
verification: PASS (4/4)
files_changed:
  - new: web/js/features/theme.js (219 行 / node --check PASS)
  - new: test/web/features-theme.test.ts (530 行 / 30 tests PASS)
forbidden_items_avoided:
  - 未实现其他 9 个 F18 slash 命令(留 WU-07a)
  - 未改 web/js/shared/theme.js(WU-03a 已稳定)
  - 未改 web/index.html(留 WU-07a 一起加 defer script)
```

## 8. 已知遗留(留后续 WU)

- `window.MyAgent.theme.{setTheme, getTheme, getSystemTheme}` API 由 F15 app.js
  实现挂载;当前未挂载,功能降级到 localStorage 仍能跑通单元测试。
- CustomEvent 名称(`my-agent:theme-change`)与 `shared/theme.js` 监听名
  (`my-agent-theme-change`)不一致;F15 应做对齐,或在 shared/theme.js 增加
  对冒号名的监听。
- index.html 已含 `<script defer src="./js/features/theme.js">`(F1 已加),
  无需修改。
