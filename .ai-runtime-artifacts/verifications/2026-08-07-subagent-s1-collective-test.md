# S1 子 Agent 核心闭环 — 集体测试

> **源 dispatch：** [2026-08-07-subagent-s1-dispatch.md](../plans/2026-08-07-subagent-s1-dispatch.md)  
> **worktree：** `d:/studyspace/project/.harness-worktrees/my-agent/wt-2026-08-07-subagent-s1`  
> **日期：** 2026-08-07

---

## 1. 编译验证

```bash
$ npx tsc --noEmit
```
**结果：PASS** — 零错误，strict mode 通过。

---

## 2. 全量测试

```bash
$ npx vitest run
```

| 指标 | 值 |
|------|-----|
| Test Files | 26 passed (26) |
| Tests | 365 passed (365) |
| Duration | 6.43s |

### 新增测试文件 (3)

| 文件 | 测试数 | 覆盖内容 |
|------|--------|----------|
| `test/orchestration/actor.test.ts` | 8 | actorSessionId 各 kind 路由、genWorkerId 唯一性、常量校验 |
| `test/orchestration/dispatch.test.ts` | 12 | runNestedDispatch 黑盒：task 信封、回传协议、abort 级联、worker 工具隔离、ProviderRegistry 继承 |
| `test/orchestration/tools.test.ts` | 7 | withoutDispatchTools 过滤、buildDispatchTools → addTool 集成、端到端 run_worker 闭环 |

### 回归测试 (23 文件, 338 测试)

全部通过，零回归。

---

## 3. 新增/修改文件清单

| 文件 | 类型 | 行数(估) |
|------|------|----------|
| `src/orchestration/actor.ts` | 新建 | ~40 |
| `src/orchestration/workflow.ts` | 新建 | ~50 |
| `src/orchestration/tools.ts` | 新建 | ~100 |
| `src/orchestration/dispatch.ts` | 新建 | ~180 |
| `src/storage/session-store.ts` | 修改 | +6 行 (gworker kind) |
| `test/orchestration/actor.test.ts` | 新建 | ~80 |
| `test/orchestration/dispatch.test.ts` | 新建 | ~120 |
| `test/orchestration/tools.test.ts` | 新建 | ~100 |

---

## 4. Done Criteria 逐项验证

| WU | Done Criteria | 状态 |
|----|--------------|------|
| WU-01 | ActorKind 含 4 种 kind | ✅ |
| WU-01 | actorSessionId 正确路由 | ✅ (测试覆盖) |
| WU-01 | genWorkerId 唯一性 | ✅ (100 次不重复) |
| WU-02 | isEphemeralSession("gworker-*") → true | ✅ (运行时验证) |
| WU-02 | sessionKindOf("gworker-*") → "gworker" | ✅ |
| WU-02 | SessionStore.create("gworker") 不抛错 | ✅ |
| WU-03 | WORKER_WORKFLOW 含关键词 | ✅ |
| WU-03 | buildWorkerSystemPrompt 含 Worker constraints | ✅ |
| WU-04 | dispatchSlots 为 Semaphore(4) | ✅ |
| WU-04 | withoutDispatchTools 过滤调度工具 | ✅ (测试覆盖) |
| WU-04 | runNestedDispatch abort 级联 | ✅ (测试覆盖) |
| WU-04 | 回传协议 XML 正确 | ✅ (测试覆盖) |
| WU-05 | 3 测试文件 | ✅ |
| WU-05 | 集成验证：run_worker 端到端 | ✅ (MockProvider 闭环) |

---

## 5. 架构约束检查

| 约束 | 状态 |
|------|------|
| 不引入 gmember/名册/群聊概念 | ✅ |
| 不使用 WorkerState 注册表 | ✅ |
| 不引入 runActorTurn 间接层 | ✅ |
| Runner 核心无侵入（addTool 方式注入） | ✅ |
| dispatchSlots 用 Semaphore 非 Mutex | ✅ |
| 子 Agent 不注 drainSteer（不传回调即隔离） | ✅ |
| agent kind 抛错（S2 保留） | ✅ |

---

## 6. 已知偏差与后续

| 偏差 | 说明 | 影响 |
|------|------|------|
| dispatch.ts 辅助函数未导出 | escapeXml 等为模块私有，测试通过 vi.mock 黑盒覆盖 | 低 — S2 按需导出 |
| buildDispatchTools opts 增加了 config 参数 | AgentRunner 运行时依赖 this.config.agent.*，必须传 config | 低 — 调用方已有 config |

### 后续（S2）
- agent.json 加载 (`src/orchestration/agent-spec.ts`)
- `run_worker(to)` 命名分支
- skill_list 过滤
- 命名 agent system prompt

---

## ### References 检查

| Reference | 状态 |
|-----------|------|
| `definition-of-done.md` | PASS — 全部 done criteria 满足，365 测试通过，零回归 |
| `orchestration-patterns.md` | PASS — 无路由角色/角色嵌套/深层树 反模式 |
| `testing-patterns.md` | PASS — AAA 模式、Mock 层次合理（vi.mock 在测试文件内） |

---

**结论：S1 核心闭环 — APPROVE ✅**
