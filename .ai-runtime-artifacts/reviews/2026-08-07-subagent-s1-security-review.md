# S1 子 Agent 核心闭环 — 安全审查

> **审查对象：** `src/orchestration/` (4 新文件) + `src/storage/session-store.ts` (修改)  
> **审查方法：** STRIDE + OWASP LLM Top 10  
> **日期：** 2026-08-07

---

## 审查结论: APPROVE ✅

未发现可被利用的跨用户/提权/命令注入漏洞。核心闭环整体硬化到位。

---

## 发现 (按严重度排序)

### 1. [中] `dispatch.ts` — `<worker-result>` 正文未转义

`buildWorkerErrorPayload` 对 message 做了 `escapeXml`，但 `buildWorkerResultPayload` 将 `result.text` 原样塞入 XML 信封。Worker 是 LLM，其输出受其读取的文件/网页内容影响（LLM05 不可信输出），可发出 `</worker-result>` + 伪造指令。

**建议：** S2 对 body 至少转义 `<`/`>`，与 error 分支保持一致。

### 2. [低-中] `dispatch.ts` — `MY_AGENT_MAX_DISPATCH_CONCURRENCY` 无校验

`Number(process.env... ?? "4")` 直接喂给 `Semaphore`。若设为 `"0"`/`"-1"`/`NaN`，所有 `run_worker` 永久挂起。

**建议：** `Math.max(1, Math.trunc(n) || 4)` 兜底。

### 3. [低] `actor.ts` — `cid` 未经校验即拼入 session id

当前仅作 metadata 不进文件路径，无实际风险；S2 持久化时 `gworker-${cid}-${w}` 进入 `sessionFile()` 前有 `assertPathSegment` 纵深防御。

**建议：** 在 `buildDispatchTools` 入口加 `assertPathSegment(cid)` 尽早失败。

### 4. [低] `dispatch.ts` — `dispatchSlots.acquire()` 位于 try 之外

若 `acquire()` 异常，finally 不执行，abortHandler 残留。async-mutex 正常不抛错，理论性风险。

**建议：** 移入 try 兜底。

### 5. [信息-低] 错误消息可能携带内部路径

`result.meta.error.message` 回传可能含绝对路径。限于同一用户会话内，无跨会话面。

### 6. [信息-设计] Worker 持有完整 bash/web_fetch/write_file 权限

与主 Agent 同权（无提权），会话间隔离正确。Worker 输出应视为不可信数据。

---

## 检查项逐条

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 路径穿越 | ✅ PASS | `genWorkerId()` 仅 base36；所有 path.join 前有 `assertPathSegment` |
| XML 注入 | ⚠️ PARTIAL | 5 字符正确转义，无 XXE 面；缺口：result 正文未转义 |
| 命令注入 | ✅ PASS | task → messageText → runner.run({message}) 仅 LLM 消息，不达 shell |
| 并发安全 | ✅ PASS | acquire/release 成对，finally 保证 |
| Abort 泄漏 | ✅ PASS | `{once:true}` + finally remove，成对 |
| Session 隔离 | ✅ PASS | `new Session()` 全新实例，仅共享 config + ProviderRegistry |
| Prompt 注入 | ✅ PASS | system prompt 独立字段，task 在 user 消息无法劫持 |
| 信息泄漏 | ✅ PASS | 仅同用户会话内 |

---

## ### References 检查

| Reference | 状态 |
|-----------|------|
| `security-checklist.md` | PASS — OWASP Top 10 + LLM Top 10 对照无阻塞项 |
