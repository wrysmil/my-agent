# Plan B 执行调度

> **route:** orchestration
> **source plan:** `docs/superpowers/plans/2026-08-04-plan-b-four-screens.md`
> **approved:** true（用户说"按照harness的流程，对方案B进行编排并执行"）
> **date:** 2026-08-05

## 执行图

共享文件约束：`index.html` 和 `app.js` 被 Tasks 2-5 共享修改。因此新文件（CSS + JS page files）由 worker 并行创建，共享文件由 Leader 统一整合。

```
GROUP-1（并行，4 workers，文件不相交）:
  WU-01 (chat):    electron/renderer/css/chat.css + electron/renderer/js/pages/chat.js
  WU-02 (sessions): electron/renderer/css/sessions.css + electron/renderer/js/pages/sessions.js
  WU-03 (settings): electron/renderer/css/settings.css + electron/renderer/js/pages/settings.js
  WU-04 (skills):   electron/renderer/css/skills.css + electron/renderer/js/pages/skills.js

GROUP-2（Leader 整合，共享文件）:
  - electron/renderer/index.html: 替换4个页面占位 → 完整HTML结构 + 引入4个CSS + 4个JS
  - electron/renderer/js/app.js: 添加4个页面的 navigate() 初始化钩子
```

## WU 定义

### WU-01: 对话页文件
- **wu_type:** feature
- **agent_role:** coder
- **文件:** `electron/renderer/css/chat.css` (NEW), `electron/renderer/js/pages/chat.js` (NEW)
- **依赖:** 无
- **Skills:** auto → `incremental-implementation`
- **验证:** 文件语法正确、CSS 变量引用与 `variables.css` 一致、JS 无语法错误

### WU-02: 会话管理页文件
- **wu_type:** feature
- **agent_role:** coder
- **文件:** `electron/renderer/css/sessions.css` (NEW), `electron/renderer/js/pages/sessions.js` (NEW)
- **依赖:** 无
- **Skills:** auto → `incremental-implementation`
- **验证:** 文件语法正确

### WU-03: 设置页文件
- **wu_type:** feature
- **agent_role:** coder
- **文件:** `electron/renderer/css/settings.css` (NEW), `electron/renderer/js/pages/settings.js` (NEW)
- **依赖:** 无
- **Skills:** auto → `incremental-implementation`
- **验证:** 文件语法正确

### WU-04: Skills 管理页文件
- **wu_type:** feature
- **agent_role:** coder
- **文件:** `electron/renderer/css/skills.css` (NEW), `electron/renderer/js/pages/skills.js` (NEW)
- **依赖:** 无
- **Skills:** auto → `incremental-implementation`
- **验证:** 文件语法正确

## Git 策略

每 task 独立 commit（遵循 plan 定义的 commit 消息）：
1. `feat(renderer): add chat page CSS styles`
2. `feat(renderer): implement chat page with message bubbles, tool call cards, and streaming`
3. `feat(renderer): implement sessions management page with table, filter, batch ops, and pagination`
4. `feat(renderer): implement settings page with subnav and 6 tabs`
5. `feat(renderer): implement skills management page with card grid, category filter, and toggle switches`

## Next

GROUP-1 完成后 → Leader 整合 index.html + app.js → 验证 → 提交
