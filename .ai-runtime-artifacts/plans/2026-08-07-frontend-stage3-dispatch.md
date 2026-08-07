---
artifact: implementation-dispatch
route: orchestration:dispatcher-workflow
plan: .ai-runtime-artifacts/plans/2026-08-07-frontend-stage3-plan.md
skills:
  - orchestration
skills_evidence:
  - harness-kit/core/orchestration/dispatcher-workflow.md
source:
  - harness-kit/core/orchestration/dispatcher-workflow.md
  - harness-kit/core/orchestration/skill-preferences.md
created_at: 2026-08-07
---

# 阶段3：UI 组件体系 — Harness 执行图

> 实施步骤以 [plan](2026-08-07-frontend-stage3-plan.md) 为准；本文件只描述并行 GROUP / WU 与派发。

## 执行图

```
GROUP-1（单 WU, 基础组件层）:
  WU-01: 4 个新组件文件 + CSS 样式 + i18n key + HTML script 标签
         dialogs.js / sidebar.js / context-menu.js / chat-input-form.js
         + zh.json + style.css + index.html

GROUP-2（并行, 2 WU, 依赖 GROUP-1）:
  WU-02: sessions.js 集成（confirm→uiConfirm + 右键菜单替代 confirm/prompt hack）
  WU-03: settings.js + chat.js + app.js 集成
         （settings confirm→uiConfirm, chat 会话右键, app 侧边栏拖拽）
```

```
┌─────────────────────────────────────────────────────────────┐
│ WU-01                                                        │
│ dialogs.js + sidebar.js + context-menu.js + chat-input-form  │
│ + zh.json + style.css + index.html                           │
│ 7 files, ~620 lines (400 JS + 100 CSS + 15 i18n + 4 tags)    │
└────────────────────────────┬────────────────────────────────┘
                             │ GROUP-1 完成
                             ▼
          ┌──────────────────────────────────────┐
          │ GROUP-2 (并行, 2 WU)                  │
          │                                      │
          │ WU-02                WU-03           │
          │ sessions.js          settings.js     │
          │ 1 file, ~40行改动    + chat.js       │
          │                      + app.js        │
          │                      3 files, ~50行  │
          └──────────────────┬───────────────────┘
                             │
                             ▼
                     阶段3 完成
```

## WU 详情

### GROUP-1

```markdown
WU-01:
  标题: UI 组件体系 — 4 个基础组件 + CSS + i18n + HTML
  文件:
    - src/renderer/js/components/dialogs.js (新建, ~120行)
    - src/renderer/js/components/sidebar.js (新建, ~100行)
    - src/renderer/js/components/context-menu.js (新建, ~80行)
    - src/renderer/js/components/chat-input-form.js (新建, ~100行)
    - src/renderer/locales/zh.json (修改, +15 keys)
    - src/renderer/style.css (修改, +100行)
    - src/renderer/index.html (修改, +4 script tags + 1 resize handle)
  依赖: 无
  wu_type: feature
  agent_role: coder
  workspace_scope: wu
  wu_skills: incremental-implementation, verification-before-completion, frontend-ui-engineering
```

### GROUP-2

```markdown
WU-02:
  标题: sessions.js 集成 — confirm→uiConfirm + 右键菜单
  文件: src/renderer/js/features/sessions.js (修改, ~40行)
  依赖: WU-01
  wu_type: feature
  agent_role: coder
  workspace_scope: wu
  wu_skills: incremental-implementation, verification-before-completion

WU-03:
  标题: settings.js + chat.js + app.js 集成 — confirm替换 + 右键 + 侧边栏
  文件:
    - src/renderer/js/features/settings.js (修改, ~15行)
    - src/renderer/js/features/chat.js (修改, ~15行)
    - src/renderer/js/app.js (修改, ~20行)
  依赖: WU-01
  wu_type: feature
  agent_role: coder
  workspace_scope: wu
  wu_skills: incremental-implementation, verification-before-completion
```

## 文件不相交验证

| 文件 | WU-01 | WU-02 | WU-03 |
|---|---|---|---|
| `js/components/dialogs.js` | ✅ 新建 | — | — |
| `js/components/sidebar.js` | ✅ 新建 | — | — |
| `js/components/context-menu.js` | ✅ 新建 | — | — |
| `js/components/chat-input-form.js` | ✅ 新建 | — | — |
| `locales/zh.json` | ✅ | — | — |
| `style.css` | ✅ | — | — |
| `index.html` | ✅ | — | — |
| `js/features/sessions.js` | — | ✅ | — |
| `js/features/settings.js` | — | — | ✅ |
| `js/features/chat.js` | — | — | ✅ |
| `js/app.js` | — | — | ✅ |

**GROUP-2 内 WU-02 与 WU-03 文件完全不相交，可安全并行派发。**

## 变更记录

| 轮次 | 日期 | 变更摘要 |
| --- | --- | --- |
| 1 | 2026-08-07 | 初稿 |
