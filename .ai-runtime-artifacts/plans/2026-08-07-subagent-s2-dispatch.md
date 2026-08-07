# 子 Agent S2 命名 Agent — 执行调度

> **源 spec：** [subagent-implementation-plan.md](../specs/subagent-implementation-plan.md) §4  
> **S1 基线：** main @ `036afb7`  
> **日期：** 2026-08-07

---

## 变更概览

| 文件 | 类型 | 内容 |
|------|------|------|
| `src/orchestration/agent-spec.ts` | 新建 | AgentSpec + loadAgentSpec |
| `src/orchestration/actor.ts` | 修改 | agent kind → gworker session (S1 保留位解锁) |
| `src/orchestration/workflow.ts` | 修改 | +buildNamedAgentSystemPrompt |
| `src/orchestration/tools.ts` | 修改 | run_worker + `to` 参数 |
| `src/orchestration/dispatch.ts` | 修改 | runNestedDispatch + agentSpec? |
| `test/orchestration/agent-spec.test.ts` | 新建 | agent-spec 测试 |
| `test/orchestration/actor.test.ts` | 修改 | agent kind 路由测试 |
| `test/orchestration/tools.test.ts` | 修改 | to 参数测试 |

---

## 执行图

### GROUP-1（并行 — 无相互依赖）

| WU | 描述 | 文件 | agent_role |
|----|------|------|------------|
| WU-S2-01 | AgentSpec + actor agent kind | `agent-spec.ts`(新) + `actor.ts`(改) | implementer |
| WU-S2-02 | buildNamedAgentSystemPrompt | `workflow.ts`(改) | implementer |

### GROUP-2（依赖 GROUP-1）

| WU | 描述 | 文件 | agent_role |
|----|------|------|------------|
| WU-S2-03 | run_worker(to) + agentSpec 透传 | `tools.ts`(改) + `dispatch.ts`(改) | coder |

### GROUP-3（依赖 GROUP-2）

| WU | 描述 | 文件 | agent_role |
|----|------|------|------------|
| WU-S2-04 | 测试 | `test/orchestration/agent-spec.test.ts`(新) + 修改现有测试 | coder |

---

## Next

用户确认「开始实现」后：WorktreeInit → GROUP-1 并行 → GROUP-2 → GROUP-3 → 尾盘
