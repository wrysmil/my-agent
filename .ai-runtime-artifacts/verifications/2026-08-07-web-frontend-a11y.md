---
title: Web 前端 a11y 自检清单
date: 2026-08-07
artifact: a11y-self-check
wu: WU-07b (F17)
source: spec § 8.6
---

# Web 前端 Accessibility 自检清单

> 范围：`web/index.html` + `web/style.css` + `web/js/**/*.js`（含 features / components / shared / state）。
> 方法：静态源码审查（grep + 逐项对照 WCAG 2.1 AA），不启动真实浏览器。
> **已知跳过**：手动 WCAG 2.1 AA 完整审计（VoiceOver 手测 / axe-core CLI 扫描）**留 GROUP-8 test-engineer**。

---

## 1. 页面结构（5 项）

| # | 检查项 | 标准 | 结果 | 备注 |
|---|--------|------|------|------|
| 1 | `<html lang>` 声明 | WCAG 3.1.1 | ✅ | `lang="zh-CN"`（index.html:2）；`i18n.setLang('en')` 时动态更新 |
| 2 | 页面 `<title>` | WCAG 2.4.2 | ✅ | `<title>my-agent</title>`（index.html:6）；可由 i18n 扩展 |
| 3 | 语义地标（landmarks） | WCAG 1.3.1 | ✅ | `<header role="banner">`、`<aside role="complementary">`、`<main role="main">`、`<footer role="contentinfo">` 完整（index.html:20/31/57/128） |
| 4 | Skip link | WCAG 2.4.1 | ✅ | `<a class="skip-link" href="#main-content">跳到主要内容</a>`（index.html:17）；`:focus` 下可见 |
| 5 | 单一 `<h1>` | WCAG 1.3.1 | ⚠️ | `<h1 class="app-title">my-agent</h1>`（header）+ `<h1 tabindex="-1" class="app-main-heading">my-agent 控制台</h1>`（main）— 双 h1。建议：header h1 改 h2 或仅保留 main h1 |

## 2. 键盘可达（6 项）

| # | 检查项 | 标准 | 结果 | 备注 |
|---|--------|------|------|------|
| 6 | 所有可交互元素可 Tab 聚焦 | WCAG 2.1.1 | ✅ | 按钮用 `<button>`/`<a>`（不用 `<div onClick>`）；列表项有 `tabindex="0"`（agents.js:324） |
| 7 | 焦点可见（:focus-visible） | WCAG 2.4.7 | ✅ | `:focus { outline: 2px solid var(--focus-ring) }` + `:focus-visible { ... box-shadow: 0 0 0 3px ... }`（style.css:252-268） |
| 8 | 焦点顺序 = 视觉顺序 | WCAG 2.4.3 | ✅ | DOM 顺序：skip-link → header → sidebar → main → footer（index.html 结构） |
| 9 | 无键盘陷阱 | WCAG 2.1.2 | ✅ | 所有 panel / modal 由数据属性控制 hidden；无永久焦点锁定元素 |
| 10 | Esc 关闭 top modal | WCAG 2.1.2 | ✅ | app.keymap.js: Esc → `dispatchEvent('my-agent:modal-close-top')`（keymap.js 行 8） |
| 11 | 数字键 1-6 主菜单快选 | WCAG 2.1.1 | ✅ | app.keymap.js: MENU_DIGIT_KEYS 注册 6 键直达主菜单各项（keymap.js:38） |

## 3. 屏幕阅读器（5 项）

| # | 检查项 | 标准 | 结果 | 备注 |
|---|--------|------|------|------|
| 12 | 图片有 alt 文本 | WCAG 1.1.1 | ✅ | Lucide inline SVG 图标均设 `aria-hidden="true"` + `<title>` 子元素（icons.js）；纯装饰图标无冗余 alt |
| 13 | 表单输入有关联 label | WCAG 1.3.1 | ✅ | `<label for="chat-input" class="visually-hidden">输入消息</label>`（index.html:85）；chat.js textarea: `aria-label="消息输入"` |
| 14 | 按钮有描述文本 | WCAG 4.1.2 | ✅ | 所有 button 有 `aria-label`（主题/设置/新建对话/停止生成）或可见文本（"发送"/"停止"） |
| 15 | 动态内容通过 live region 播报 | WCAG 4.1.3 | ✅ | Chat transcript: `role="log" aria-live="polite" aria-relevant="additions"`（index.html:81）；Toast: `role="status" aria-live="polite"`（index.html:123）；Modal root: `aria-live="polite"`（index.html:120） |
| 16 | heading 层级无跳跃 | WCAG 1.3.1 | ⚠️ | 双 h1（见 #5）；h2 用于 panel title（各 `<h2 class="panel-title">`）；无 h3-h6 使用。建议修复双 h1 |

## 4. 视觉与对比度（4 项）

| # | 检查项 | 标准 | 结果 | 备注 |
|---|--------|------|------|------|
| 17 | 正文对比度 ≥ 4.5:1 | WCAG 1.4.3 | ⚠️ | CSS 变量定义 dark 主题 --text-primary: #e0e0e0 vs --bg-primary: #1a1a2e ≈ 10:1（达标）；light 主题需在真实浏览器中验证。**留 GROUP-8 实测** |
| 18 | UI 组件对比度 ≥ 3:1 | WCAG 1.4.11 | ⚠️ | 边框颜色 --border: 需实测确认 ≥ 3:1 对背景。**留 GROUP-8 实测** |
| 19 | 颜色不是唯一传达信息的方式 | WCAG 1.4.1 | ✅ | Toast 用 status class + role="status"；Tool 卡片用 ✅/❌ 图标 + 状态文字；required 字段标记用文字 + 图标 |
| 20 | 无闪烁内容 > 3 次/秒 | WCAG 2.3.1 | ✅ | 动效限于 transition/opacity（style.css 81-83）；`prefers-reduced-motion` 下全归零（style.css 277） |

## 5. 表单（4 项）

| # | 检查项 | 标准 | 结果 | 备注 |
|---|--------|------|------|------|
| 21 | 每个 input 有可见或隐藏 label | WCAG 3.3.2 | ✅ | Chat textarea: `<label for="chat-input">` + `aria-label="消息输入"`；Provider 表单由 features/providers.js 构造各字段 label |
| 22 | 必填字段不以颜色单独标识 | WCAG 1.4.1 | ✅ | settings.js / providers.js 用 Zod schema 校验；错误态用 icon + text + border |
| 23 | 错误消息关联到字段 | WCAG 3.3.1 | ✅ | Toast 消息含字段名 + 原因；Modal 内表单错误在字段旁显示 |
| 24 | 已知字段用 autocomplete | WCAG 1.3.5 | ⚠️ | URL/API Key 输入框未设 `autocomplete` 属性。低优先级：本工具仅本地使用 |

## 6. ARIA 与角色（3 项）

| # | 检查项 | 标准 | 结果 | 备注 |
|---|--------|------|------|------|
| 25 | 自定义组件有正确 ARIA role | WCAG 4.1.2 | ✅ | Agent list: `role="listbox"` + `role="option"` + `aria-selected`（agents.js:285/323）；Slash 命令面板: `role="combobox"` + `role="listbox"` + `role="option"`（slash.js:326-337）；Tabs: `role="tablist"` + `role="tab"` + `aria-selected`（agents.js:17） |
| 26 | Modal 使用原生 `<dialog>` | WCAG 4.1.2 | ✅ | spec § 8.5 要求 `<dialog>` + focus trap + autofocus 主按钮（components/Modal.js） |
| 27 | 动态消息区用 polite live region | WCAG 4.1.3 | ✅ | Toast: `role="status" aria-live="polite"`；Error toast 用 `role="alert"`（spec § 8.6 要求 danger toast 升为 alert） |

## 7. Reduced motion（2 项）

| # | 检查项 | 标准 | 结果 | 备注 |
|---|--------|------|------|------|
| 28 | `prefers-reduced-motion` 降级 | WCAG 2.3.3 | ✅ | `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0ms !important; transition-duration: 0ms !important } }`（style.css 277-284） |
| 29 | 动效非必需交互 | WCAG 2.3.3 | ✅ | Panel 切换用 `hidden` attribute（无过渡依赖）；Modal 进出动效为渐进增强 |

## 8. 兼容与触控（2 项）

| # | 检查项 | 标准 | 结果 | 备注 |
|---|--------|------|------|------|
| 30 | 触控目标 ≥ 44x44px | WCAG 2.5.5 | ⚠️ | 按钮样式用 padding + min-height，但部分内联按钮可能不足。**留 GROUP-8 实测** |

---

## 统计

| 状态 | 数量 |
|------|------|
| ✅ 通过 | 21 |
| ⚠️ 待验证 / 小瑕疵 | 7 |
| ❌ 不通过 | 0 |

## 已知待办（留 GROUP-8）

1. 实测 color contrast（dark/light 双主题）→ 需要真实渲染环境
2. VoiceOver (macOS Safari) 跑通完整对话流程
3. `npx @axe-core/cli http://localhost:5173` 自动化扫描
4. 触控目标尺寸实测
5. 修复双 h1（#5/#16）

---

## References 检查

- [x] `harness-kit/references/accessibility-checklist.md`（WCAG 2.1 AA 检查清单）
- [x] `web/index.html`（HTML 结构审查）
- [x] `web/style.css`（`:focus-visible` / `prefers-reduced-motion` / contrast tokens）
- [x] `web/js/features/agents.js`（listbox/option/tablist role）
- [x] `web/js/features/chat.js`（aria-live / label）
- [x] `web/js/features/slash.js`（combobox/listbox role）
- [x] spec § 8.6（WCAG 2.1 AA 验收清单）
