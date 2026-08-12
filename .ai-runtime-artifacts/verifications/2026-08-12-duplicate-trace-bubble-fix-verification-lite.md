---
status: draft
approved: false
task: 切会话重复 trace bubble 修复
date: 2026-08-12
---

# Verification Lite — 重复气泡（同 run 多 trace bubble）

## 根因

`mergePersistedWithOverlay` 在切会话回来触发 history refetch 时：

- **overlay**（流式占位）：`id=asst-${runId}`，可能尚无 `messageId`
- **persisted**（后端 history）：`id=hist-${messageId}`，`messageId` 来自后端

两者 **identity 不匹配** → overlay 被 `splice` 插入为第二条 assistant → 同一次 AI 回复渲染出多个 trace bubble。

## 修复（两笔）

### 1. 重复 trace bubble

`mergePersistedWithOverlay` 增加 **runId 二次去重**：overlay `asst-${runId}` 与 persisted `hist-${messageId}` identity 不匹配时，不再 splice 插入第二条 assistant。

### 2. 最终回复被吞（本次）

history 收敛（`revision >= requiredRevision`）时，原先**整段丢弃 overlay**。但后端 history refetch 可能**尚未写入 final text 行**，persisted 只有 thinking/tool blocks → 正文消失。

修复：`persisted-wins` 时调用 `mergeAssistantTextFromOverlay`——**保留 persisted 的 trace 结构，若 overlay 含更长 text 则合并 overlay 文本**。

## 验证命令

```powershell
Set-Location "d:\studyspace\project\my-agent\web"
pnpm exec vitest run tests/features/chat/chat-session-stream-isolation.test.tsx tests/features/chat/trace-bubble-session-switch.test.tsx
pnpm exec tsc -b
```

## 结果

| 检查项 | 结果 |
|--------|------|
| merge runId 去重单测 | PASS |
| merge 保留 overlay final text 单测 | PASS（新增） |
| chat-session-stream-isolation | 25/25 PASS |
| trace-bubble-session-switch | 4/4 PASS |
| tsc | 0 errors |
| Playwright 流中 A↔B 反复切换 | `gconv-5d343682187d`：2 user + 2 trace（2 次 send），无同 run 重复 |

## 手动复测建议

1. 新建会话，发一个会触发多步工具调用的复杂问题
2. AI 生成中反复切到其他会话再切回（≥6 次）
3. 预期：**同一次提问只有 1 个灰色 trace bubble**，不应出现多个不同步数的重复块
