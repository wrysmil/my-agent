---
artifact: execution-log
wu_id: WU-03a
wu_type: feature
agent_role: implementer
title: F0 Design System 落地 + theme.js (含 Safari < 14 polyfill)
plan: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md § 6.2
spec: .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md § 4.4 + § 4.4.1 + § 5.4.1
dispatch: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-dispatch.md (GROUP-3 / WU-03a)
created_at: 2026-08-07
status: success
---

# WU-03a (F0) — Design System 落地 — 执行日志

## 1. 目标

为 my-agent Web 前端所有页面提供完整 design tokens + dark/light/system 三态主题切换 + Safari < 14 polyfill。

## 2. 范围

### 2.1 允许文件（全部新建）

| 路径 | 行数 | 说明 |
| --- | ---: | --- |
| `web/style.css` | 294 | 完整 Design System（14 dark + 14 light + 6 menu + typography + spacing + radius + motion + 3-state CSS + reduced-motion） |
| `web/js/shared/theme.js` | 133 | applyTheme + Safari < 14 polyfill + localStorage 读取 + CustomEvent 监听 |

### 2.2 禁止项（遵守）

- **不**实现 `web/index.html`（留给 WU-03b F1）
- **不**实现 `/theme` 三态循环（留给 WU-04d F18 — `web/js/features/theme.js`，F0 仅暴露 `applyTheme` + localStorage 读 + `data-theme` 属性）
- **不**写 JSX / TS / 构建产物（vanilla CSS + JS）

## 3. v3.3 关键修复落实

### 3.1 CSS 三态选择器齐全

```css
:root[data-theme="dark"]                        { /* 14 dark tokens */ }
:root[data-theme="light"]                       { /* 14 light tokens */ }
:root[data-theme="system"][data-system-theme="dark"]   { /* 14 dark tokens (与上面完全一致) */ }
:root[data-theme="system"][data-system-theme="light"]  { /* 14 light tokens (与上面完全一致) */ }
```

**验证：** 每个 block 14 个 `--bg-*` / `--text-*` / `--border-*` / `--accent-*` / `--danger` / `--warning` / `--focus-ring` token 完整列齐，`dark` block 与 `system_dark` block token 完全一致，`light` block 与 `system_light` block token 完全一致。

### 3.2 Safari < 14 polyfill 修复（v3.2 Reviewer Critical）

```js
// 正确写法（v3.3）：
} else if (typeof mql.addListener === 'function") {
  mql.addListener(function (e) { applySystem(e.matches); });  // 单 callback 参数
}
```

**错误写法（v3.2 Reviewer 标记，已废弃）：**
```js
mql.addListener(mql, (e) => apply(e.matches));  // mql 被当作 callback 传入
//                                                  TypeError: mql is not a function
```

### 3.3 14 token 完整列齐（dark + light 对齐）

每个主题 block 都列出 14 个 token（含 `--border-subtle`、`--accent-primary-hover`、`--accent-run`、`--focus-ring` 等次级 token — spec § 4.4.1 末尾 light 表只有 8 个，本版本按 dark token 完整度补齐 6 个 light 对照值，确保 `dark == system_dark`、`light == system_light`）：

| Token | Dark | Light | 备注 |
| --- | --- | --- | --- |
| `--bg-base` | `#0F172A` | `#FFFFFF` | spec 明列 |
| `--bg-surface` | `#1E293B` | `#F8FAFC` | spec 明列 |
| `--bg-elevated` | `#334155` | `#FFFFFF` | spec 明列 |
| `--text-primary` | `#F8FAFC` | `#0F172A` | spec 明列 |
| `--text-secondary` | `#CBD5E1` | `#334155` | spec 明列 |
| `--text-muted` | `#64748B` | `#64748B` | spec 明列 |
| `--border-default` | `#334155` | `#E2E8F0` | spec 明列 |
| `--border-subtle` | `#1E293B` | `#F1F5F9` | 推断（slate-800 / slate-100） |
| `--accent-primary` | `#22C55E` | `#16A34A` | spec 明列 |
| `--accent-primary-hover` | `#16A34A` | `#15803D` | spec 明列 dark / 推断 light（green-700） |
| `--accent-run` | `#10B981` | `#059669` | spec 明列 dark / 推断 light（emerald-600） |
| `--danger` | `#EF4444` | `#DC2626` | spec 明列 dark / 推断 light（red-600） |
| `--warning` | `#F59E0B` | `#D97706` | spec 明列 dark / 推断 light（amber-600） |
| `--focus-ring` | `#38BDF8` | `#0284C7` | spec 明列 dark / 推断 light（sky-600） |

> 推断项说明：spec § 4.4.1 light 表仅列 8 token。本版本按 Tailwind `-600` 级填充，保证 4.5:1 对比，与 spec § 4.4.1 「Light 配色用 -600 级（保证 4.5:1 对比）」一致。

## 4. 验证命令（全部通过）

```bash
# [1] 文件存在
ls -la web/style.css web/js/shared/theme.js
# -rw-r--r-- 1 mima0000 staff  5635 Aug  7 22:44 web/js/shared/theme.js
# -rw-r--r-- 1 mima0000 staff 10369 Aug  7 22:43 web/style.css

# [2] CSS 变量行数（≥ 30）
grep -c "^  --" web/style.css
# 121  ✓

# [3] 三态 + 降级选择器行数（≥ 5）
grep -E "^\[data-theme|data-system-theme|prefers-reduced-motion|prefers-color-scheme" web/style.css | wc -l
# 13  ✓

# [4] CSS 变量去重数（≥ 30）
node -e "
const fs = require('fs');
const css = fs.readFileSync('web/style.css', 'utf-8');
const tokens = (css.match(/--[a-z][a-z0-9-]+/g) || []);
const uniq = new Set(tokens);
console.log('CSS variable count:', uniq.size);
if (uniq.size < 30) process.exit(1);
"
# CSS variable count: 73  ✓

# [5] JS 语法
node --check web/js/shared/theme.js
# PASS  ✓
```

### 4.1 Block 计数（确认 14 token 列齐）

```
dark         14  ✓
light        14  ✓
system_dark  14  ✓ (与 dark 完全一致)
system_light 14  ✓ (与 light 完全一致)
system_dark  6   ✓ (6 色菜单 — dark -400)
system_light 6   ✓ (6 色菜单 — light -600)
```

## 5. 主题切换职责切分（与 spec § 5.4.1 注 2 一致）

| 文件 | 职责 | 调用关系 |
| --- | --- | --- |
| `web/js/shared/theme.js`（本 WU） | 启动时从 `localStorage['my-agent.theme']` 读值，初始化 `<html data-theme>`；监听 `prefers-color-scheme` 变化（system 模式）；监听 `my-agent-theme-change` CustomEvent 重新应用 | `app.js` 第一步调用 `themeModule.init()` |
| `web/js/features/theme.js`（F18 WU-04d） | 三态循环 `dark → light → system → dark`，写回同一 key，分发 CustomEvent | 通过 `dispatchEvent(new CustomEvent('my-agent-theme-change', { detail: { theme } }))` 通知 F0 |

**CustomEvent 通信方式（约定）：**
- `event.type` = `'my-agent-theme-change'`
- `event.detail.theme` = `'dark' | 'light' | 'system'`
- F18 负责写 localStorage + dispatch；F0 负责 applyTheme + 监听 OS 偏好。

## 6. 关键决策记录

1. **`bg-elevated` 在 light 主题用 `#FFFFFF`**（spec 明列），但同时在 body 上加 `box-shadow: 0 1px 3px rgba(0,0,0,0.06)` 区分层级 — 当前 CSS 未强制此 shadow，**留给 F6 组件层实现**（用 `box-shadow` 配合 token）。

2. **不使用 `:root:not([data-theme])[data-system-theme]` 退化路径** — spec § 4.4.1 明确指出 `data-theme` 必须始终有值（默认 `system`），由 F0 `applyTheme` 在启动时设上。本 WU 在 `applyTheme` 内强制输入白名单（`dark / light / system`），非法值退化到 `system`。

3. **font @import 而非 `<link>`** — spec § 4.4.2 同时给出两种；选 `@import` 让 `web/style.css` 自包含（即使未来 F1 改变 `<link>` 顺序，字体仍随 CSS 加载）。index.html 仍保留 `preconnect` 链接（性能优化，与字体加载并行）。

4. **未实现 `applyTheme` 的去抖** — `prefers-color-scheme` 变化由 OS 主动推送（频率极低），无需去抖；如果未来 F11 发现抖动再加。

5. **`getStoredTheme` 容错 localStorage 禁用**（隐私模式 / SecurityError），try/catch 静默退化到 `system`。

## 7. 跨 WU 依赖 / 契约

- **F1（web/index.html）**：需 `<link rel="preconnect">` 引用 fonts.googleapis.com / fonts.gstatic.com（性能优化）。
- **F6（基础组件）**：将使用 `--bg-*` / `--text-*` / `--border-*` / `--accent-*` / `--focus-ring` / `--space-*` / `--radius-*` / `--motion-*` token。
- **F15（app.js）**：第一步调用 `themeModule.init()`。
- **F18（web/js/features/theme.js）**：通过 CustomEvent `'my-agent-theme-change'` 通知 F0 重设 CSS。

## 8. 返回

```yaml
wu_status: success
skills_loaded:
  - harness-kit/references/orchestration-patterns.md (read)
  - harness-kit/references/accessibility-checklist.md (read)
  - harness-kit/references/performance-checklist.md (read)
verification: PASS (5/5)
files_changed:
  - new: web/style.css (294 行 / 73 unique tokens / 14 token per theme block × 4)
  - new: web/js/shared/theme.js (133 行 / node --check PASS / Safari polyfill v3.3 修复落实)
v3_3_fixes:
  - css_three_state_selectors: 4 块完整（dark / light / system_dark / system_light），token 完整列对齐
  - safari_polyfill: 修复（v3.2 误写 addListener(mql, cb) → v3.3 addListener((e) => cb)）
  - fourteen_tokens_aligned: 是（dark 14 == system_dark 14；light 14 == system_light 14）
forbidden_items_avoided:
  - 未实现 web/index.html（留给 WU-03b F1）
  - 未实现 /theme 三态循环（留给 WU-04d F18）
  - 未引入 JSX / TS / 构建产物
```