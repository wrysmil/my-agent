# S1 子 Agent 核心闭环 — 代码审查

> **审查对象：** `src/orchestration/` (4 新文件) + `src/storage/session-store.ts` (修改) + `test/orchestration/` (3 测试文件)  
> **审查维度：** 正确性 / 可读性 / 架构 / 安全概览 / 性能概览  
> **日期：** 2026-08-07

---

## 审查结论: APPROVE ✅

实现质量高，五个维度均达标。365 测试全绿（含 27 个 orchestration 专项测试）。

---

## 五轴评估

### 正确性 ✅
- `actorSessionId` 四分支路由正确，agent/user kind 抛错
- `runNestedDispatch` abort 级联正确（预中止 + `once:true` + finally 清理）
- `classifyWorkerOutcome` 三分支（aborted 优先）
- `dispatchSlots` acquire/try-finally-release 成对
- 测试对每种边界都有断言

### 可读性 ✅
- 命名清晰：`buildDispatchTools` / `runNestedDispatch` / `withoutDispatchTools`
- WORKER_WORKFLOW 四条规则、XML 回传协议、config 线程化原因均有注释

### 架构 ✅
- 循环依赖正确化解：dispatch.ts 静态 import 纯函数 + tools.ts 动态 import
- 零 Runner 核心改动：`addTool()` 注入
- config 因 `AgentRunner.config` 私有而显式线程化，注释说明动机

### 安全 ✅
- `escapeXml` 覆盖全部 5 个 XML 特殊字符
- `genWorkerId` 进程内零碰撞
- session-store gworker 增补与 `assertPathSegment` 一致

### 性能 ✅
- Semaphore 并发上限 4（可环境变量调节）
- 动态 import 一次性开销
- 每次 dispatch 新建轻量 Session + AgentRunner，无 N+1

---

## 发现 (4 项，均为 Optional/Nit/FYI)

1. **[Optional]** `dispatch.ts` — `workerRunner.run()` 若抛异常不归入 `<worker-error>` 信封。建议加 try/catch。
2. **[Nit]** `dispatch.ts` — `buildWorkerResultPayload` 正文未转义（与 error 分支不对称）。可接受，当前消费者是指挥官 LLM。
3. **[Nit]** `actor.ts` — `ActorKind: "user"` 和 `USER_ID` 当前无使用（S2 占位）。可保留。
4. **[FYI]** `dispatch.ts` — `cid` 不做校验。S2 持久化时存储边界有 `assertPathSegment` 防御。

---

## ### References 检查

| Reference | 状态 |
|-----------|------|
| `security-checklist.md` | PASS |
| `performance-checklist.md` | N/A (非 UI/API/DB) |
