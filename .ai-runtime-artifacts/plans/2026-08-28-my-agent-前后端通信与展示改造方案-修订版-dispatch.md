---
artifact: dispatch
title: 阶段一执行图 — 协议骨架
date: 2026-08-28
plan: 2026-08-28-my-agent-前后端通信与展示改造方案-修订版.md
status: completed
---

# 阶段一：协议骨架 — 执行图

## 执行图

```
GROUP-1（并行）:
  WU-01: 协议核心类型 + 帧类型定义
         文件: web/src/lib/api-protocol/types.ts, frames.ts, schema.ts, index.ts
         依赖: 无
         wu_type: feature
         agent_role: coder
         里程碑: M1

  WU-02: 错误码迁移
         文件: web/src/lib/api-protocol/errors.ts, web/src/lib/api.ts, web/src/lib/error.ts
         依赖: 无（与 WU-01 文件不相交）
         wu_type: feature
         agent_role: coder
         里程碑: M2
```

## WU 详情

### WU-01：协议核心类型 + 帧类型定义

**目标**：创建 `web/src/lib/api-protocol/` 目录，定义 RpcId、四象限类型、MuxFrame/HostFrame 帧类型、zod schema

**交付物**：
- `web/src/lib/api-protocol/types.ts` — RpcId brand 类型、四象限 discriminated union
- `web/src/lib/api-protocol/frames.ts` — 27 种旧事件映射到新帧类型
- `web/src/lib/api-protocol/schema.ts` — zod schema 校验
- `web/src/lib/api-protocol/index.ts` — 统一导出

**验收项**：
1. `RpcId` brand 类型编译通过（`tsc --noEmit`）
2. 四象限类型可通过 `message.type` narrow（单元测试）
3. 所有旧事件已映射到新帧类型（类型覆盖检查）
4. 27 种旧事件全部映射（类型覆盖测试）
5. zod schema 可校验所有帧（schema 测试用例）

### WU-02：错误码迁移

**目标**：将 27 个 `ApiErrorCode` 枚举迁移到统一的 `RpcError` 类型，更新所有调用方

**交付物**：
- `web/src/lib/api-protocol/errors.ts` — RpcError 类型定义
- `web/src/lib/api.ts` — 改造，废弃 ApiErrorCode
- `web/src/lib/error.ts` — 改造，使用新 RpcError

**验收项**：
1. 所有 ApiErrorCode 映射到 RpcError（编译检查 + 单元测试）
2. 旧调用方已更新（`grep -r "ApiErrorCode" web/src` 返回空）
3. 新错误码格式统一（schema 校验测试）
