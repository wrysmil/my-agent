---
artifact: document-review
route: superpowers:document-review
skills:
  - document-review
skills_evidence:
  - .agents/skills/document-review/SKILL.md
  - harness-kit/.agents/skills/document-review/review-rules/design.md
  - harness-kit/.agents/skills/document-review/checklists/review-checklist.md
source:
  - .ai-runtime-artifacts/specs/2026-08-10-chat-session-stream-isolation-spec.md
  - 独立 Reviewer 39944698-8fdc-416f-874d-766f3f53226a
  - 对抗架构 Reviewer e71cd71d-4514-4978-8047-50a738ab1b22
created_at: 2026-08-10
---

# Chat 会话流隔离、缓存与恢复方案审查报告

## 文档类型

架构/技术设计文档。

## 审查规则加载

- [x] `document-review` 通用流程
- [x] `review-rules/design.md`
- [x] `checklists/review-checklist.md`
- [x] 两名未参与撰写的独立子 Agent 只读审查
- [x] 抽查当前 `useChatStream`、SSE route、session serde 与 Orkas 对照实现

## 审查结论

**BLOCK**

方案方向正确，前端按 session/run 隔离以及 P1 RunRegistry 均有必要；但身份、协议、迁移和生命周期契约尚未闭合，当前不能直接交给执行者实施。

## 审查结果

### 1. 文档完整性

**评分：不完整（6/10）**

覆盖了问题、目标架构、阶段划分和测试场景，但关键协议仍有未决项。

### 2. 逻辑清晰度

**评分：基本清晰（8/10）**

问题到方案的推导清楚；P0 依赖 P1 才提供的 runId/envelope，阶段边界存在自相矛盾。

### 3. 环境准备完整性

**评分：不完整（3/10）**

已指出本地依赖不完整，但缺少 Node/npm 版本、安装目录、安装命令、启动命令、测试命令和预期输出。

### 4. 接口与迁移可执行性

**评分：不足（4/10）**

缺少完整 HTTP/SSE 契约、存量 JSONL 兼容、发布顺序和回滚方案。

## Critical Findings

### C1. P0 依赖不存在的稳定 messageId/blockId

Spec 第 102、164、178、231、277 行要求稳定 ID，但当前：

- `Message` 和 session serde 不保存 messageId；
- history 每次加载都会重新生成 message/block ID；
- 未定义旧 JSONL 数据如何兼容或迁移。

必须明确 ID 的生成点、持久化格式、SSE/history 映射、旧数据 fallback，以及 clientMessageId 的重试幂等语义。

### C2. P0 要求 runId，但 runId/envelope 被划入 P1

Spec 第 229 行要求 P0 校验 `sessionId + runId`，第 239 行却把统一 envelope 放入 P1。当前只有连接级 streamId。

必须固定阶段契约：

- P0 中 runId 与 streamId 是否等价；
- P1 中 runId 与 subscription/streamId 如何分离。

### C3. seq 去重规则会丢事件

Spec 第 161–163 行规定 `seq <= lastSeq` 即忽略，但当前服务端可能用同一个 seq 写出多个物理 SSE frame。若按现方案实现，后续 `message_stop/usage` 等事件可能被错误丢弃。

必须规定每个物理 frame 唯一严格递增 seq，或使用 `(seq, subSeq)`。

### C4. history 无条件覆盖 overlay 会导致流式内容回退

Spec 第 178 行规定 persisted 覆盖 optimistic，但运行中的 persisted 快照可能落后于 overlay。

必须增加 `revision/committedSeq/runId`，定义：

- persisted 何时足够新；
- 持久化确认信号；
- overlay 原子移除条件；
- 消息排序键。

### C5. P1 缺少完整重连 API 契约

当前 POST stream 会创建新 runner，不能直接承担重新订阅。

必须定义：

- 创建 run；
- 独立订阅 run events；
- 查询 active run；
- 精确 abort；
- replay 窗口不足；
- terminal event 重放；
- 请求/响应和错误码。

### C6. RunRegistry 崩溃恢复承诺不可实现

纯内存 Registry 在进程崩溃后无法知道哪些 run 未完成。若保留“重启后标记 interrupted”，必须增加轻量 run ledger；否则应删除该承诺并定义 unknown 状态。

## Important Findings

1. 同 session 冲突策略仍写成“409 或 replace”，必须二选一。
2. 精确 abort 必须校验 `(sessionId, runId)`，并定义本地 abort 与服务端 abort 的幂等顺序。
3. RunRegistry 缺少状态机、原子创建/释放、TTL、单 run/全局容量、慢订阅者背压和 session 删除规则。
4. “有限 buffer”“短 TTL”没有数值，执行者无法验收。
5. 缺少协议版本、前后端部署顺序、兼容窗口、双读/双写及回滚方案。
6. 验收标准未分别标记 P0/P1，也未绑定具体测试文件与命令。
7. Spec source 应补本项目关键源码和 Orkas 的可复核版本/路径。
8. 应在计划前确定 Zustand 或 `useSyncExternalStore`，避免实施分叉。

## 可延后项

- 每会话草稿和滚动位置；
- 侧边栏后台运行徽标；
- reconnect 视觉提示；
- 分布式 RunRegistry；
- 完整事件溯源；
- 所有 delta 的持久化。

## 最小修订清单

1. 把稳定 ID 的生成、持久化、历史 API 和旧数据兼容纳入 P0。
2. 明确 P0 的 runId/streamId 关系。
3. 定义每个 SSE frame 的唯一 seq。
4. 补齐 create/subscribe/status/abort/replay API 契约与错误码。
5. 定义 history revision 与 overlay 收敛算法。
6. 固定同 session 并发策略。
7. 定义 RunRegistry 状态机、容量、TTL、背压、shutdown 和崩溃语义。
8. 增加协议迁移、部署顺序和回滚方案。
9. 增加环境准备和可复制验证命令。
10. 将验收测试分别标记 P0/P1。

## 子 Agent 一致意见

- SessionRuntime/RunRuntime 方向不是过度设计，是解决当前共享 state 串流问题的必要结构。
- 若“刷新后继续生成”是硬需求，RunRegistry 必要；否则 P1 可降级。
- 当前缺陷属于执行契约缺失，不是文字润色问题。

## Next

- 审查未通过 → 根据最小修订清单修改 spec；
- 修改后 → 再次委派独立文档 Reviewer；
- 审查通过后 → 用户说「写计划」进入实施计划阶段。
