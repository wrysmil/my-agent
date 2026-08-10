---
artifact: review
route: spec-stage-iteration
skills:
  - brainstorming
  - frontend-ui-engineering
  - api-and-interface-design
  - ui-ux-pro-max
skills_evidence:
  - .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md frontmatter
source:
  - .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md (v3.2)
  - .ai-runtime-artifacts/reviews/2026-08-07-web-frontend-spec-v3.1-review.md (v3.1 BLOCK)
  - .ai-runtime-artifacts/reviews/2026-08-07-web-frontend-spec-v3-review.md (v3 BLOCK)
created_at: 2026-08-07
batch_id: SPEC-REVIEW-V3.2
worktree_id: ""
worktree_path: ""
reviewer_instance: reviewer (subagent a8490c770ff51e4f4)
verdict: BLOCK
---

# Web Frontend Spec v3.2 — 独立审查

> **写入者：** Leader（reviewer readonly 返回正文后落盘）。
> **审查对象：** `.ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md` v3.2
> **变更焦点：** v3.1 Reviewer BLOCK 的 6 项 findings 修复（§ 4.4.1 三态 + polyfill、/usage 注、F-17 typo、slash.test.js 路径）
> **审查者：** Harness Reviewer（独立 subagent）

## 6 项修复逐项判定表

| 编号 | 级别 | 状态 | 证据位置 |
|---|---|---|---|
| v3.1-C1 | Critical | ✅ | line 521「**首次访问默认 `system`**（与 § 3.3 一致）」+ line 522 三态描述；line 264 § 3.3 默认值一致；§ 9 R-26 仍要求 polyfill → 已落实 |
| v3.1-C2 | Critical | ⚠️ **形式满足、代码有 bug** | line 524-548 polyfill 代码块存在 + 含 `matchMedia('(prefers-color-scheme: dark)')` + addEventListener/addListener 双分支 + 「取一次快照后不再监听」最差降级 + 注释「落实 § 9 R-26」—— 但 **addListener 第二参数 `mql` 错位导致 Safari < 14 分支永不工作**（见 Critical #2） |
| v3.1-I1 (F-7) | Critical→Important | ⚠️ **描述满足、运行时崩** | line 502、520、522 三态描述完整 + `data-theme="system"` + `data-system-theme="dark\|light"` 双属性设计意图明确 —— 但 **line 506-515 CSS 选择器未覆盖 `data-theme="system"` 分支，运行时 CSS 变量不应用**（见 Critical #1） |
| v3.1-I2 (F-19) | Important | ✅ | line 858 「Modal 顶部固定提示「**数据仅本机，不外传**」（仅 localhost 单用户，不脱敏但显式标注）」 |
| v3.1-S1 (F-17) | Suggestion | ✅ | line 1037 「**`/history` 列表 > 50 条**：HistoryModal 内显示「查看更多」按钮」（CompactModal → HistoryModal 已修复） |
| v3.1-S2 | Suggestion | ✅ | line 1725 F18 ⑫「`web/js/features/slash.test.js` 单测」完整路径 |

**总评：** 4 项 ✅ + 2 项 ⚠️。2 项 ⚠️ 是 v3.2 修复引入的运行时 bug（CSS selector 漏写 + API 误用），均达 Critical 级。

## Findings

### Critical（v3.2 修复引入）

1. **CSS 选择器遗漏 `data-theme="system"` 分支，首访 system 模式 CSS 变量全部失效**
   - `.ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md:506-515` 的实际 CSS 规则：
     ```css
     :root[data-theme="dark"], :root:not([data-theme])[data-system-theme="dark"] { --bg-base: #0F172A; ... }
     :root[data-theme="light"], :root:not([data-theme])[data-system-theme="light"] { --bg-base: #FFFFFF; ... }
     ```
   - 但 § 4.4.1 polyfill 代码 `:531-534` 把 `<html>` 设为 `data-theme="system" data-system-theme="dark|light"`。在 system 模式下：
     - `:root[data-theme="dark"]` 不匹配（data-theme 是 `"system"`）
     - `:root:not([data-theme])[data-system-theme="..."]` 不匹配（data-theme 已设）
     - **两个选择器都不命中 → `--bg-base` 等所有 token undefined → 页面降级到浏览器默认（白色背景 + 黑色文字）**
   - spec 解释文 line 550 明确写「**为什么必须 `data-theme="system"` + `data-system-theme="dark|light"` 双属性：** CSS 选择器嵌套（`:root[data-theme="system"][data-system-theme="dark"]`）」—— 声称要用 `:root[data-theme="system"][data-system-theme="dark"]` 这个选择器，但实际 CSS 里根本没写。
   - 这是 v3.2 直接抄写双属性机制时漏写关键选择器，是 v3.2 修复引入的 Critical 运行时 bug。
   - **修复**：在 line 506、512 的两个选择器中各加 `:root[data-theme="system"][data-system-theme="dark"]` 与 `:root[data-theme="system"][data-system-theme="light"]` 分支，或改为 `:root[data-theme="dark"], :root[data-theme="system"][data-system-theme="dark"]` 简化形式。

2. **Safari < 14 polyfill 调用 `mql.addListener(mql, cb)` 第二参数 `mql` 多余且破坏监听注册**
   - `.ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md:540`：
     ```js
     } else if (typeof mql.addListener === "function") {
       mql.addListener(mql, (e) => apply(e.matches));
     }
     ```
   - `MediaQueryList.addListener()` 是已废弃的单参 API（仅接受 callback）。`addListener` 第一个参数 `mql` 会被浏览器当成 callback 注册；当 OS 主题切换时浏览器调用 `mql()` → `TypeError: mql is not a function`。**真正的 callback（第二参数）被忽略 → Safari < 14 polyfill 完全不工作**，R-26「OS 切换延迟」无法缓解。
   - **修复**：改为 `mql.addListener((e) => apply(e.matches));`（与 line 537 的 `addEventListener` 形态一致）。

### Important（v3.2 修复引入）

3. **§ 9 风险表 line 1889「dark mode 默认 用户可能不习惯」未随 v3.2 默认值变更更新**
   - 现默认是 `system`（line 521），不再 dark mode 默认，但该行风险描述与缓解措施（首次访问 onboarding 气泡）仍是 dark-mode-as-default 语境。读者会误以为 spec 默认 dark。
   - **修复**：把「dark mode 默认」改为「设计系统默认 dark token」并相应调整缓解措辞，或删除该条（system 模式下 OS 决定用户第一印象，无需特别引导）。

### Suggestion

4. **§ 4.4.1 line 550 解释文与实际 CSS 规则脱节**
   - line 550 描述「`:root[data-theme="system"][data-system-theme="dark"]` 让暗 / 亮 token 在同一 CSS 文件内共存」，但 line 506-515 的 CSS 规则并未出现这个选择器。
   - **修复**：随 Critical #1 一并把示例 CSS 补完整。

5. **§ 12.4 changelog 仅列 6 项 fix，未同步追加 v3.2 引入新问题的处置位**
   - line 2011-2022 的 6 项 fix 表里没有 v3.2 引入的两条 Critical 的反向 changelog（即未说明 v3.2 修复了 v3.1 哪些项 + 留下了哪些新 issue）。
   - **修复**：补一行「v3.2 已知遗留: CSS selector 缺 system 分支、addListener 第二参数错」给下游 plan 兜底。

### Nit

无。

## 修复期间引入的新问题（v3.1 → v3.2）

| 项 | 说明 | 严重度 |
|---|---|---|
| § 4.4.1 CSS selector 缺 `[data-theme="system"]` 分支 | 运行时崩，首访 system 模式 token undefined | Critical |
| § 4.4.1 polyfill `mql.addListener(mql, cb)` 第二参数错 | Safari < 14 监听永远不触发 → R-26 未缓解 | Critical |
| § 9 R-18「dark mode 默认」描述与 § 4.4.1 默认 `system` 矛盾 | 读者误以为默认 dark | Important |
| § 4.4.1 line 550 解释文与实际 CSS 脱节 | 解释文举例的选择器不存在 | Suggestion |
| § 12.4 changelog 缺 v3.2 引入问题记录 | 下游 plan 无法溯源 | Suggestion |

## 证据

**已 Read：**
- `.ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md` line 1-2036（完整）
- `.ai-runtime-artifacts/reviews/2026-08-07-web-frontend-spec-v3.1-review.md` line 1-147（完整）
- `.ai-runtime-artifacts/reviews/2026-08-07-web-frontend-spec-v3-review.md` line 1-196（完整）

**已 grep：**
- `data-theme`：6 处（line 506/512/520/522/534/544），确认三态属性写法落地
- `默认`：第 505 行注释「首次访问若 user 未设 → 走 system 模式」+ line 521「首次访问默认 `system`」+ line 264 § 3.3 默认值，三处一致
- `prefers-color-scheme\|addListener\|matchMedia`：第 271、522、531、538、540、857、1033、1055、1072、1899 命中，polyfill 描述覆盖全
- `CompactModal\|HistoryModal\|slash.test.js\|slash.js`：line 1037 typo 已修；line 1725 ⑫ 完整路径已加

**已 WebFetch：**
- MDN `MediaQueryList.addListener` 文档：签名 `addListener(func)` 仅一个参数，func 为 callback。验证 line 540 `mql.addListener(mql, (e) => apply(e.matches))` 第二个参数会被忽略、第一个参数 `mql`（MediaQueryList 对象）被当作 callback 调用 → TypeError

## 未验证项

- § 4.4.1 line 506-515 CSS 规则仅列示意片段（`/* ... dark tokens */` 注释），实际 dark token 完整列表（`--bg-surface`、`--text-primary` 等 14 个 token）是否在 `:root[data-theme="system"][data-system-theme="dark"]` 分支内一并补齐 —— 假设按 dark 分支同等补全即可，需 plan/WU 阶段对照 line 458-473 表逐项落地
- § 4.4.1 polyfill 在 Safari 13 真机行为（除 addListener API 外是否还有其他差异）—— 需真机验证
- v3.2 changelog § 12.4 与 § 12.3 F-7 行「v3.2 补 § 4.4.1」交叉引用一致性：形式 OK，但 F-7 标 Important 而 v3.2 修复的 I1（实际引入 Critical）严重程度被低估

## Skills 使用

- 已加载: 无
- 已跳过: 无（按 harness 约定，复审任务不预读 skill）

## Next（给 Leader）

- **必须先修 2 项 Critical**（CSS selector + addListener 第二参数）再进 plan
- 修 1 项 Important（§ 9 R-18 dark mode 默认描述）
- 修 2 项 Suggestion（CSS 示例补全 + § 12.4 changelog 追加 v3.2 引入问题）
- 修完再派 reviewer 走 v3.3 审查；本轮 BLOCK

## 复盘建议

v3.2 在抄写 v3.1 Reviewer 要求的「双属性 + polyfill」机制时：

1. **只抄 JS 代码** —— polyfill 函数照搬，但没意识到 `mql.addListener` 是单参 API
2. **只描述 CSS 意图** —— line 550 解释文提到 `:root[data-theme="system"][data-system-theme="dark"]`，但 line 506-515 实际 CSS 并未实现该选择器

**教训：** Reviewer 关注的「运行时验证」类问题（CSS 选择器、API 调用形态）必须用 WebFetch / grep 二次确认，不能仅做「文本对齐」式修复。修复 spec 时每个新增代码块都要 Read + 验证，不能默认「Reviewer 说要 X，所以加了 X 就是修了」。