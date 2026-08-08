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
  - .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md (v3.1)
  - .ai-runtime-artifacts/reviews/2026-08-07-web-frontend-spec-v3-review.md (v3 BLOCK)
created_at: 2026-08-07
batch_id: SPEC-REVIEW-V3.1
worktree_id: ""
worktree_path: ""
reviewer_instance: reviewer (subagent a81c049ed35fd6103)
verdict: BLOCK
---

# Web Frontend Spec v3.1 — 独立审查

> **写入者：** Leader（reviewer readonly 返回正文后落盘）。
> **审查对象：** `.ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md` v3.1
> **变更焦点：** v3 Reviewer BLOCK 的 26 项 findings 修复 + F-20 § 5.4.1 拆分计划文档化
> **审查者：** Harness Reviewer（独立 subagent）

## 26 项 findings 逐项判定表

| # | 级别 | 状态 | 证据位置 |
|---|------|------|----------|
| F-1 | Critical | ✅ | § 3.1.5 line 220-241：`AgentRunner.compactNow(cid)` + `Session.getTokenEstimate()` + cid-mutex 逻辑自洽 |
| F-2 | Critical | ✅ | `GET /api/providers/active` § 3.1.1:154 + § 6.2:1384；`PATCH /api/providers/active/model` § 3.1.1:156 + § 6.2:1390；`POST /api/sessions/:cid/compact` § 3.1.2:170 + § 6.2:1397；`MODEL_NOT_FOUND` § 3.4.2:329 |
| F-3 | Critical | ✅ | § 7.2 line 1677 F18 行 11 文件（slash.js + 9 Modal + theme.js）+ slash.test.js，与 § 5.4.1 line 996-1007 一致 |
| F-4 | Critical | ✅ | § 5.4.1 line 936-948 原重复块已删除；现仅 line 978-990 边界 + line 993-1014 F18 清单 |
| F-5 | Critical | ✅ | § 6.1 line 1327 事件枚举含 `tool_start`；§ 6.4 line 1557-1558 `case "tool_start"`；§ 6.1 line 1340 对齐表 `tool_start | ✅` |
| F-6 | Critical | ✅ | § 3.1.5 line 234 + § 5.4.1 line 806 明确「不依赖 context_status，改用 Session.getTokenEstimate()」；§ 6.1 line 1345 对齐表标注「❌ 当前实现不 yield + /compact Modal 不依赖」 |
| F-7 | Important | ⚠️ | § 3.3 line 264 三态 ✅；§ 5.4.1 line 809 三态循环 ✅；**§ 4.4.1 line 502 仍写 dark\|light + 默认 dark**（与 § 3.3 矛盾）|
| F-8 | Important | ✅ | 全文 `my-agent.theme`（§ 3.3:264、§ 5.4.1:809/985、§ 5.4.1:1024-1025）；未发现 `_theme` 残留 |
| F-9 | Important | ✅ | § 5.4.1 line 889 `case "compact": openCompactModal(cid)` |
| F-10 | Important | ✅ | § 9 line 1847 R-22 + § 3.1.5 line 239 cid-mutex 描述一致 |
| F-11 | Important | ✅ | § 3.1.2 line 166 query 参数 + line 174-179 ListSessionsQuerySchema |
| F-12 | Important | ✅ | § 5.4.1 line 1000-1007 11 文件清单含 ToolsModal/SkillsModal/SkillDetailModal/CompactModal |
| F-13 | Important | ✅ | § 5.4.1 line 763 标题「与 CLI 数字菜单对齐 + Web 独有补充」；line 766 显式否认 chat.ts:478-523 存在 |
| F-14 | Important | ✅ | § 5.4.1 line 768-778 CLI 6 项 → Web 触发映射表 + 「YAGNI：slash 重复收益小」说明 |
| F-15 | Suggestion | ✅ | § 8.2.1 line 1736-1756 18 条 DoD 完整 |
| F-16 | Suggestion | ✅ | § 5.4.1 line 990 内存策略 + § 9 line 1848 R-23 |
| F-17 | Suggestion | ⚠️ | § 5.4.1 line 989 分页机制 ✅，但 typo「CompactModal 内」→「HistoryModal 内」 |
| F-18 | Suggestion | ✅ | § 5.4.1 line 808 catch + execCommand 回退；§ 9 line 1850 R-25 |
| F-19 | Suggestion | ❌ | § 5.4.1 line 810 + 990 无「仅本地单用户」注 |
| F-20 | Suggestion | ✅ | § 12.3 line 1962-1974 v4 拆分计划文档化 |
| F-21 | Suggestion | ✅ | § 5.4.1 line 1020-1025 注 2 F0 vs F18 职责切分表 |
| F-22 | Suggestion | ✅ | § 5.4.1 line 985「主题切换不影响 CSP + 不引入 inline style + 不需要 'unsafe-inline'」 |
| F-23 | Nit | ✅ | § 5.4.1 line 818-833 字典统一用 `requiresArgs: false/true` |
| F-24 | Nit | ✅ | § 5.4.1 line 894-898 `default` 兜底 + console.error + toast |
| F-25 | Nit | ✅ | § 5.8.1 line 1111「toast 可带 1 个 action 按钮」 |
| F-26 | Nit | ✅ | § 5.4.1 line 991「/agent <id>（v2 残留已清理）」+ 注 1 line 1018 |

**总评：** 22 项 ✅ + 2 项 ⚠️ + 2 项 ❌。⚠️/❌ 项是 v3.1 修复时的覆盖不全 + 新引入的内部矛盾。

## Findings

### Critical（v3.1 修复引入 / 未关闭）

1. **§ 3.3 vs § 4.4.1 默认 theme 矛盾**
   - § 3.3 line 264：`my-agent.theme` = `"dark" | "light" | "system"`（**默认 `system`**）
   - § 4.4.1 line 502：「切换实现：`<html data-theme="dark|light">` + 顶栏按钮。`localStorage.my-agent.theme` 持久化，**首次访问默认 dark**」
   - F-7 升级三态只动了 § 3.3 + § 5.4.1，未触 § 4.4.1。同一 spec 内两份独立 section 给出矛盾默认值。
   - **修复**：以 § 3.3 为准改 § 4.4.1 line 502 — 删除「`<html data-theme="dark|light">`」「首次访问默认 dark」字样，加 `system` 模式 + `matchMedia` 监听描述。

2. **§ 9 R-26 显式要求「§ 4.4.1 + F0 shared/theme.js 加 polyfill」，但 § 4.4.1 完全没写 system 模式 + addListener 降级实现**
   - § 9 line 1851 R-26：「§ 4.4.1 + F0 `shared/theme.js` 加 polyfill：检测无 `addEventListener` 时降级为 `addListener`（已废弃但 Safari < 14 支持）」
   - § 4.4.1：未提 polyfill、未提 `system` 模式如何落到 CSS 变量
   - 风险 R-26 实际未缓解
   - **修复**：§ 4.4.1 增补「system 模式实现：F0 `shared/theme.js` 启动时调 `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ...)`；polyfill：检测无 addEventListener 时降级 `addListener(mediaQueryList, cb)`（Safari < 14）」

### Important（F-7 / F-19 未完整关闭）

3. **F-7 § 4.4.1 部分修复**
   - 原 Finding 7 显式列出「§ 3.3 line 224 + § 4.4.1 line 455」两处都需升级
   - v3.1 § 12.3 line 1941 修复表误写「§ 3.3 + § 5.4.1」，漏 § 4.4.1
   - § 4.4.1 design system 段（line 455-503）只描述 2 态（dark + light），新增的 `system` 在 CSS 层无落地路径
   - **修复**：同上一条 Critical

4. **F-19「仅本地单用户」注未加**
   - 原 Finding 19 要求 `/usage` 命令附近加「仅本地单用户使用」注
   - § 5.4.1 命令表 line 810 `/usage` 行 + line 990 内存策略段都没有该说明
   - § 1.4 总体声明 127.0.0.1-only，但未就近标注到 /usage
   - **修复**：§ 5.4.1 line 810 命令表 `/usage` 行的「触发 UI」列追加「Modal 内提示「数据仅本机，不外传」」

### Suggestion（F-17 typo + 路径不全）

5. **F-17 修复留下 copy-paste typo**
   - § 5.4.1 line 989：`/history 列表 > 50 条：**CompactModal 内**显示「查看更多」按钮`
   - 应为「**HistoryModal 内**」（/history 触发的是 HistoryModal）
   - **修复**：替换 typo

6. **§ 7.2 F18 行 slash.test.js 路径未指定**
   - line 1677 ⑫ 描述「slash.test.js 单测」但无路径
   - 与 F18 中其他文件路径风格不一致（其他都写完整相对路径）
   - **修复**：补为 `web/js/features/slash.test.js`

### Nit

7. **F-23「optionalArgs + requiresArgs」双字段并存**
   - § 5.4.1 line 833 `/model`：`requiresArgs: false, optionalArgs: true` 同时存在
   - 配套判断逻辑 line 856-863 分两段检查
   - 简化方向可在 plan/WU 设计中合并，不阻断 spec 审批

## 修复期间引入的新问题（v3 → v3.1）

| 项 | 说明 |
|---|---|
| § 3.3 vs § 4.4.1 默认 theme 矛盾 | Critical |
| R-26 polyfill 落地缺失 | Critical |
| F-17 copy-paste typo | Suggestion |
| F-19 「仅本地单用户」注漏加 | Suggestion |

## 证据

**已 Read：**
- `.ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md` line 1-1975（完整）
- `.ai-runtime-artifacts/reviews/2026-08-07-web-frontend-spec-v3-review.md` line 1-196（完整）
- `harness-kit/core/orchestration/agents/reviewer.md` line 1-97
- `.agents/agents/reviewer.md` line 1-62

**已对照：**
- `src/agent/types.ts` `AgentRunEvent` 联合：§ 6.1 line 1335-1349 对齐表覆盖完整
- `src/agent/runner.ts` 公开 API 现状：§ 3.1.5 提议扩展与既有 `runStream/run` 并列；语义明确
- `src/cli/menu.ts` 主菜单 6 项：§ 5.4.1 line 768-778 映射表准确

**已 grep：**
- `_theme` vs `my-agent.theme`：v3.1 全部统一为 `my-agent.theme`
- `chat.ts:478-523`：v3.1 line 766 显式否认该文件存在（与仓库实际一致）

## 未验证项

- § 3.1.5 `AgentRunner.compactNow()` / `Session.getTokenEstimate()` 的具体实现边界 — 需 plan 阶段 WU 设计验证
- § 7.2 F18 ⑫ `slash.test.js` 单测路径 — 见 Suggestion，未明确

## Next（给 Leader）

- **必须先修 2 项 Critical**（§ 4.4.1 默认值 + R-26 polyfill）再进 plan
- 修 2 项 Important（F-7 § 4.4.1 + F-19 /usage 标注）
- 修 2 项 Suggestion（F-17 typo + slash.test.js 路径）
- 修完再派 reviewer 走 v3.2 审查；本轮 BLOCK