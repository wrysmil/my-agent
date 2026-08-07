---
artifact: implementation-dispatch
route: orchestration:dispatcher-workflow
plan: .ai-runtime-artifacts/plans/2026-08-07-frontend-stage5-plan.md
skills:
  - writing-plans
  - orchestration
skills_evidence:
  - .claude/skills/writing-plans/SKILL.md (loaded)
source:
  - harness-kit/core/orchestration/dispatcher-workflow.md
  - harness-kit/core/orchestration/skill-preferences.md
created_at: 2026-08-07
---

# 阶段5：聊天系统升级 — Harness 执行图

> 实施步骤以 [plan](2026-08-07-frontend-stage5-plan.md) 为准；本文件只描述并行 GROUP / WU 与派发。

## 执行图

```
GROUP-1 (并行, 2 WU, 文件完全不相交):

  ┌──────────────────────────────────────────────────────────────┐
  │ WU-01: 支持基础设施                                           │
  │   state.js (+~65行: pollTimers/pollMsgCounts + 4 函数)        │
  │   zh.json (+~10 keys: bash权限/文件删除/轮询/队列 i18n)       │
  │   i18n.js (+~10 keys: DEFAULT_TABLE 同步)                     │
  │   style.css (+~50行: §14 @-mention + §15 权限卡片样式)        │
  │   4 files, ~135 lines                                         │
  └──────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │ WU-02: chat.js 聊天系统                                      │
  │   消息队列发送管道 (send→_sendOneMessage+processQueue)         │
  │   流事件提取 (_handleStreamEvent)                              │
  │   停止增强 (cancel→清空队列+通知)                              │
  │   轮询集成 (onPollMessages+switchSession/newSession 生命周期)   │
  │   @-mention 高亮 (_highlightMentions+TreeWalker)               │
  │   权限卡片 (_handleBashPermission+_handleDeleteConfirm)        │
  │   1 file, ~350 lines                                          │
  └──────────────────────────────────────────────────────────────┘

                             ▼
                     阶段5 完成
```

## WU 详情

### GROUP-1（并行）

```markdown
WU-01:
  标题: state.js 轮询/队列基础设施 + zh.json/i18n.js/style.css
  文件:
    - src/renderer/js/state/state.js (修改, +65行)
    - src/renderer/locales/zh.json (修改, +10 keys)
    - src/renderer/js/shared/i18n.js (修改, +10 keys DEFAULT_TABLE)
    - src/renderer/style.css (修改, +50行)
  依赖: 无
  wu_type: feature
  agent_role: coder
  workspace_scope: wu
  wu_skills: incremental-implementation, verification-before-completion

WU-02:
  标题: chat.js 聊天系统升级 — 队列+停止+轮询+mention+权限
  文件:
    - src/renderer/js/features/chat.js (修改, ~+350/-50行)
  依赖: 无（与 WU-01 文件不相交；通过全局变量接口解耦）
  接口契约（WU-01 提供，WU-02 引用）:
    - pollTimers: Map, pollMsgCounts: Map
    - startPolling(sessionId), stopPolling(sessionId)
    - enqueueMessage(sessionId, msg), processMessageQueue(sessionId)
    - zh.json: chat.streaming_cancel, bash.permission.*, delete_file.confirm.*, chat.poll_detected, chat.queue_count, chat.tool_executing
  wu_type: feature
  agent_role: coder
  workspace_scope: wu
  wu_skills: incremental-implementation, verification-before-completion, frontend-ui-engineering
```

## 文件不相交验证

| 文件 | WU-01 | WU-02 |
|---|---|---|
| `js/state/state.js` | ✅ 修改 | — |
| `locales/zh.json` | ✅ 修改 | — |
| `js/shared/i18n.js` | ✅ 修改 | — |
| `style.css` | ✅ 修改 | — |
| `js/features/chat.js` | — | ✅ 修改 |

**GROUP-1 内 WU-01 与 WU-02 文件完全不相交，可安全并行派发。**

## 接口契约（WU-01 → WU-02 跨 WU 约定）

WU-02 的 chat.js 通过全局作用域引用 WU-01 定义的接口：

| 引用 | 来源 | 类型 |
|---|---|---|
| `pollTimers` | state.js | `Map<sessionId, setInterval>` |
| `pollMsgCounts` | state.js | `Map<sessionId, number>` |
| `startPolling(sid)` | state.js | 函数（幂等） |
| `stopPolling(sid)` | state.js | 函数 |
| `enqueueMessage(sid, msg)` | state.js | 函数（追加到 messageQueues） |
| `processMessageQueue(sid)` | state.js | 函数（FIFO 消费） |
| `t('chat.streaming_cancel')` | zh.json → i18n.js | string |
| `t('bash.permission.*')` | zh.json → i18n.js | string |
| `t('delete_file.confirm.*')` | zh.json → i18n.js | string |
| `t('chat.poll_detected')` | zh.json → i18n.js | string |
| `.msg-mention` | style.css | CSS class |
| `.permission-card` | style.css | CSS class |

## 变更记录

| 轮次 | 日期 | 变更摘要 |
| --- | --- | --- |
| 1 | 2026-08-07 | 初稿：2 WU 并行 GROUP-1，文件完全不相交 |

## Next

- 执行图确认 → 说「开始实现」或「并行执行」
- 只改 plan 任务、不改并行策略 → 仅改 `*-plan.md`
- 只改 WU 拆分 / 依赖 → 改本文件并告知 Leader 审阅
- 实现完成后 → 尾盘：语法检查 → collective-test → code-review
