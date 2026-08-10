---
artifact: spec
route: source-driven-development -> superpowers:brainstorming
skills:
  - source-driven-development
  - brainstorming
skills_evidence:
  - .agents/skills/source-driven-development/SKILL.md
  - skipped: brainstorming (SKILL.md not found in available project or user skill paths)
source:
  - 用户：「你写一个修复方案，然后我让其他人来执行」
  - .ai-runtime-artifacts/specs/2026-08-08-chat-streaming-render-fix.md
  - .ai-runtime-artifacts/execution-logs/2026-08-08-session-persistence-fix.md
  - .ai-runtime-artifacts/stack/2026-08-10-chat-session-stream-stack.md
  - web/src/features/chat/useChatStream.ts
  - web/src/features/chat/types.ts
  - src/web/server/routes/messages.ts
  - src/web/server/sse.ts
  - src/agent/session-serde.ts
  - D:/studyspace/源码学习/Orkas/src/renderer/modules/conversation.js（Orkas 2026.7.17）
  - D:/studyspace/源码学习/Orkas/src/main/preload.js（Orkas 2026.7.17）
created_at: 2026-08-10
status: draft
approved: false
revision: 2
---

# Chat 会话流隔离、缓存与恢复修复方案

## 1. 目标

修复用户在会话 A 生成中切到 B、再切回 A 时出现的：

- A 的 token、工具状态或消息进入 B；
- 切换后 `streaming / idle / done` 状态错误；
- 历史消息重复、错序或丢失；
- 已排队的 rAF 更新在错误会话执行；
- 旧流失去控制句柄，无法精确停止；
- 消息重复导致列表高度、滚动位置和气泡布局异常；
- 刷新或连接短暂中断后无法判断运行是否仍在继续。

本方案不改消息气泡的视觉设计，也不重新设计 Agent runner；重点是建立明确的会话、运行和消息归属。

## 2. 已确认根因

### 2.1 React state 所有权错误

`useChatStream(sessionId)` 只有一份 `messages/status/controllerRef`。路由参数变化时 `ChatPage` 通常不会卸载，因此 A、B 实际共享同一套可变状态。

### 2.2 in-flight 快照使用了新 sessionId

会话切换 effect 的 setup 阶段拿到的是新 `sessionId`，但闭包中的 messages/status 可能仍是旧视图数据，导致 A 快照写到 B key。

### 2.3 stale 判断缺少会话身份

当前只比较 generation 数字。A 与 B 的 generation 都可能为 `1`，旧流会被误判为有效流。generation 不能代替 `(sessionId, streamId/runId)`。

### 2.4 rAF 与异步回调没有目标会话

`flushTextRaf()` 直接修改当前消息列表；切换前排队、切换后执行的 callback 会写入新会话。

### 2.5 历史与临时消息依靠不稳定指纹合并

当前使用 role、文本前 80 字和 block 数量推断消息身份，并且 overlap 算法固定 `slice(1)`。相同开头、空 thinking、工具块数量变化都会产生误合并。

### 2.6 传输连接与模型运行耦合

服务端 `runner.runStream()` 被 SSE response 循环直接驱动。客户端真正断开时，服务端会关闭对应 controller；这不能可靠支持刷新后的恢复或重新订阅。

## 3. 方案对比

### 方案 A：给 `ChatPage` 加 key，切换时 abort

优点：改动少，能立即降低串流概率。

缺点：切走就停止生成；无法后台继续；不能解决恢复、重连和历史合并；不满足用户需求。

结论：拒绝作为正式方案，只可作为紧急降级开关。

### 方案 B：前端按 session 建运行时容器

每个 session 独立保存消息、状态、流控制器和 rAF 缓冲。页面只订阅当前 session。

优点：能彻底解决当前 A/B 串流和状态污染；实现成本可控。

缺点：刷新后内存容器消失；服务端连接断开时运行仍可能停止。

结论：必须实施，作为 P0。

### 方案 C：前端隔离 + 服务端 Run Registry 与事件重放

服务端把模型运行从 SSE 连接中解耦，按 runId 缓存有限事件并允许重新订阅；前端按 sessionId/runId 恢复。

优点：同时解决切换、刷新、重连和运行状态恢复，最接近 Orkas。

缺点：涉及前后端协议和运行生命周期，工作量明显更大。

结论：推荐目标架构。分 P0、P1 落地，避免一次重写全部链路。

## 4. 推荐架构

### 4.1 三层身份

所有运行时数据必须同时具备：

- `sessionId`：数据属于哪个会话；
- `runId`：属于该会话的哪次发送；
- `messageId/blockId`：稳定消息和内容块身份。

`generation` 可保留为同一 run 内的本地版本号，但不得用于跨 session 身份判断。

#### 稳定 ID 契约（P0）

- `clientMessageId`：浏览器在发送前生成 UUID，同一次用户重试必须复用；服务端以
  `(sessionId, clientMessageId)` 做幂等键。
- `runId`：服务端接受发送后生成 UUID，代表一次模型执行；从 P0 开始存在。
- `streamId`：一次 SSE 连接的 UUID。P0 首次连接时与 run 同时创建，但
  `streamId !== runId`；P1 重连会为同一 run 创建新 streamId。
- `messageId`：服务端生成并写入 JSONL。用户消息优先直接采用
  `clientMessageId`；assistant 消息在 run 创建时生成。
- `blockId`：text/thinking block 由服务端生成 UUID；tool_use 使用现有 tool-use ID；
  tool_result 使用 `result:<toolUseId>`。

`Message`、`SerializedMessage` 和 history API 在 P0 增加可选 `id`、`runId`；
内容块增加可选 `id`。新写入数据必须包含 ID。

旧 JSONL 不做原地重写。读取缺少 ID 的旧记录时，以
`legacy:<sha256(sessionId|recordIndex|role|turnId)>` 派生稳定 messageId，
blockId 使用 `<messageId>:<blockIndex>`。同一文件内容不变时，派生结果必须稳定。
这样无需数据迁移即可兼容旧会话；回滚到旧版本时新增字段会被结构宽松读取忽略。

### 4.2 前端 Session Runtime Store

建立独立模块，例如 `chatRuntimeStore`：

```text
sessions: Map<sessionId, SessionRuntime>

SessionRuntime:
  messages
  historyState
  activeRunId
  status
  error
  scroll/draft 可选状态

runs: Map<runId, RunRuntime>

RunRuntime:
  sessionId
  streamId
  abortController
  lastSeq
  pendingTextBuffer
  rafHandle
  status
```

规则：

1. SSE callback 捕获不可变的 `targetSessionId + targetRunId`。
2. reducer 更新前再次验证 event envelope 的身份。
3. 后台 A 事件只更新 `sessions[A]`，当前视图 B 不订阅 A 的消息。
4. 页面切回 A 时直接选择 `sessions[A]`，不搬运 B 的 state。
5. SessionRuntime 的 `status` 独立；切换页面不得把运行中的 A 重置成 idle。
6. controller 按 runId 保存，不能在切换时简单设为 null。

实现统一使用项目已有 Zustand 5，不再保留 `useSyncExternalStore` 二选一。
不得把运行态塞进 React Query；React Query 只负责服务端历史快照和 session 列表。

Store 生命周期：

- terminal run 在 persisted history 完成收敛后从 `runs` 移除；
- 非当前且无 active run 的 session runtime 采用 LRU，最多保留 20 个；
- 删除 session 时先 abort active run，再清理 run、rAF、timer、draft 和 runtime；
- 页面切换不 dispose；应用卸载只断开 subscriber，是否停止 run 由显式 abort 决定。

### 4.3 事件协议

每条 SSE 事件统一携带 envelope：

```typescript
interface ChatStreamEnvelope<T> {
  sessionId: string;
  runId: string;
  streamId: string;
  seq: number;
  event: ChatStreamEventName;
  data: T;
}
```

约束：

- `seq` 在 run 内按**每个物理 SSE frame**唯一、严格递增；禁止多个 event 共用 seq；
- 客户端拒绝 sessionId/runId 不匹配的事件；
- 同一 run 中 `seq <= lastSeq` 的事件幂等忽略；
- message/block 使用服务端稳定 ID，不在历史加载时重新生成；
- `message_start`、delta、tool、usage、done、error、aborted 全部使用同一 envelope。

服务端必须通过唯一 `emitEvent()` 分配 seq 并写 frame，业务适配器不得自行复用 seq。
`Last-Event-ID` 表示客户端已完整收到的最后一个 seq，重放从 `seq > Last-Event-ID`
开始，边界为排他。

### 4.4 历史与临时层合并

删除 `computeInflightTail`、文本指纹和 `isSameTailMessage`。

使用两层模型：

- `persistedMessagesById`：history API 返回的权威数据；
- `optimistic/runOverlayById`：尚未持久化的 user/assistant/tool block。

合并规则：

history API 返回：

```typescript
interface SessionHistoryResponse {
  sessionId: string;
  revision: number; // 当前 JSONL 有效记录数；每成功 append 一条递增
  messages: SerializedMessage[];
}
```

成功终态 SSE 事件返回 `persistedRevision` 与最终 assistant `messageId`；
failed/aborted 不宣称已持久化 assistant。合并规则：

1. persisted 中不存在相同 messageId 时保留 overlay，不能用旧快照覆盖；
2. persisted 中存在相同 messageId，且 history `revision >= persistedRevision` 时，
   才由 persisted 原位替换 overlay；
3. persisted 版本不足时 overlay 胜出，避免 token/tool 状态回退；
4. 相同 blockId 仅应用更高 seq 的状态；
5. history 请求发出和返回时都核对目标 sessionId；
6. 终态事件到达后触发一次 history refetch；满足第 2 条才原子删除 overlay；
7. refetch 失败时保留已完成 overlay 并标记 `awaiting_persistence`，下次进入会话重试；
8. 消息排序使用持久化记录顺序；未提交 overlay 排在其 run 对应用户消息之后；
9. failed/aborted overlay 标记终态并保留错误/中止展示；若 history 中不存在对应
   assistant message，不执行 persisted 替换；
10. 重复 history/refetch 不得增加消息数量。

### 4.5 rAF 与定时器

- 每个 run 单独维护 pending buffer 和 rAF handle；
- rAF callback 使用 `runId` 定位目标 runtime，不读取“当前会话最后一条消息”；
- done/error/abort 时同步 flush 或取消该 run 的 rAF；
- store dispose、session 删除时清理对应 rAF、timeout 和 controller；
- 切换会话不清理后台运行中的 run。

### 4.6 服务端 Run Registry 与 API（P1）

新增进程级 `RunRegistry`，建议职责：

```text
sessionId -> active runId
runId -> controller/status/eventBuffer/subscribers/lastSeq
```

行为：

1. 创建 run 后由后台任务独立消费 `runner.runStream()`；
2. SSE route 只订阅事件，不拥有模型运行；
3. 路由切换或网络短断只移除 subscriber；
4. 只有显式 abort API 终止 run；
5. 同 session 同时只允许一个非终态 run；新请求固定返回 `409 RUN_ALREADY_ACTIVE`，
   不再提供静默 replace；
6. session 删除时先 abort active run，等待终态最多 5 秒，再删除会话；
7. 单进程是本期明确约束；不支持多实例共享 Registry。

#### API 契约

P0 保留兼容入口：

```text
POST /api/sessions/:sessionId/messages/stream
body: { clientMessageId, text, model?, thinkingLevel? }
response: SSE；message_start 必须含 runId/streamId/messageId
-> 409 RUN_ALREADY_ACTIVE（同 session 已有非终态 run）

POST /api/sessions/:sessionId/runs/:runId/abort
-> 202 aborting / 200 terminal（按 sessionId + runId 校验，重复调用幂等）
```

P1 新接口：

```text
POST /api/sessions/:sessionId/runs
-> 202 { run: { runId, sessionId, status, userMessageId, assistantMessageId, createdAt } }
-> 409 { error: { code: "RUN_ALREADY_ACTIVE", activeRunId } }

GET /api/sessions/:sessionId/runs/active
-> 200 { run: RunSummary | null }

GET /api/sessions/:sessionId/runs/:runId/events
headers: Last-Event-ID?: <seq>
-> 200 text/event-stream
-> 404 RUN_NOT_FOUND
-> 410 REPLAY_WINDOW_EXPIRED { historyRevision }

POST /api/sessions/:sessionId/runs/:runId/abort
-> 202 { runId, status: "aborting" }
-> 200 { runId, status: terminalStatus } // 幂等重复 abort
-> 404 RUN_NOT_FOUND
-> 409 RUN_SESSION_MISMATCH
```

P1 上线后旧 `messages/stream` 在一个兼容版本内作为 create + subscribe 适配器保留，
内部必须走同一个 RunRegistry，不再直接启动第二个 runner。

#### 状态机

```text
queued -> running -> completing -> succeeded
                  \-> failed
queued/running/completing -> aborting -> aborted
queued/running/completing/aborting --进程重启--> interrupted
```

所有终态幂等。terminal event 与 ledger 持久化完成后才释放 session activeRunId。
订阅连接状态（connecting/open/disconnected）不属于 run 状态。

#### 事件缓存、背压与清理

- 每 run 最多 1,000 个事件且最多 2 MiB，任一先到即淘汰最旧事件；
- 全局 event buffer 最大 64 MiB，超限优先淘汰最早的终态 run；
- 终态 run 从 terminal event 起保留 5 分钟；
- active run 即使无 subscriber 也继续运行；
- `res.write()` 连续 5 秒无法恢复或单 subscriber 待发送超过 1 MiB时断开该订阅，
  不终止 run；
- 请求的 Last-Event-ID 早于最老缓存 seq 时返回 410，客户端改走 history +
  active-run 查询，不进行不完整重放；
- graceful shutdown 最多等待 active run 10 秒，之后写 interrupted ledger 并 abort。

#### 崩溃与重启

在 session 目录新增 `<sessionId>.runs.jsonl` 轻量 ledger，只记录
`runId/sessionId/status/startedAt/updatedAt/userMessageId/assistantMessageId`，不记录
token delta。状态变化 append 写入；启动时将最后状态非终态的 run 追加为 interrupted。
history 仍是消息真相源，ledger 仅用于恢复运行状态。

### 4.7 UI 切换与布局

- `MessageList` 只接收当前 session selector 的数据；
- 可给消息列表容器使用 `key={sessionId}` 重置会话级滚动 observer，但这只是视图重置，不承担流隔离；
- 输入草稿按 sessionId 保存；
- 当前会话无运行时不得显示其他 session 的 ActivityStrip/ThinkingDots；
- 切回运行中的 A，状态应仍为 streaming/tool_executing；
- 重复消息修复后再评估 CSS；不要用 overflow 样式掩盖重复 DOM。

## 5. 分阶段交付边界

### P0：先消除串流和状态污染

- 引入 SessionRuntime/RunRuntime；
- 扩展 Message/SerializedMessage/content block 稳定 ID，并兼容旧 JSONL；
- 从 P0 开始生成独立 runId 与 streamId，现有 SSE 全事件携带统一 envelope；
- 删除单一 `messages/status/controllerRef` 的跨会话所有权；
- 事件更新校验 sessionId + runId；
- 每个物理 SSE frame 使用唯一 seq；
- rAF 按 run 隔离；
- 使用稳定 messageId 合并 history；
- 精确 abort 使用 `(sessionId, runId)` 并保持幂等；
- 补齐竞态测试。

P0 后允许“切走后旧 HTTP 流继续”，但不承诺刷新后继续。

### P1：可靠后台运行与恢复

- 服务端 RunRegistry；
- subscriber 分离；
- Last-Event-ID 按 run 去重和重放；
- 刷新后的 active run 查询与恢复；
- run ledger、TTL、buffer cap、背压和 shutdown 处理；
- 旧 stream API 兼容适配。

### P2：体验完善

- 每会话草稿和滚动位置；
- 侧边栏后台运行/完成徽标；
- 断线重连提示；
- interrupted run 的明确展示。

## 6. 必须删除或替换的旧机制

- module-level `generationBySession` 作为流归属判断；
- 单一 `streamGenerationRef`；
- `inFlightBySessionRef` 快照搬运；
- `computeInflightTail` 和文本指纹合并；
- 切换 effect 中 `controllerRef.current = null`；
- callback 通过“当前最后一条 assistant 消息”确定更新目标；
- 全局只按 seq 的重连去重。

## 7. 验收标准

### 会话隔离

1. A 正在输出时切 B，B 永不出现 A 的 message/tool/thinking/usage。
2. A、B 同时运行时，各自只更新自己的 SessionRuntime。
3. A→B→A 后，A 内容连续且无重复，状态仍正确。
4. A、B 的本地 generation 数字相同时也不得串流。
5. 会话切换与 rAF flush 同帧发生时不得写错会话。

### 历史与持久化

1. history 重复 refetch 后消息数不增加。
2. history 返回顺序与切换顺序交错时，旧响应不得覆盖新 session。
3. optimistic 消息持久化后按 messageId 原位替换。
4. tool/thinking block 不因回切而重复或永久 streaming。

### 中止与恢复

1. 停止 A 只终止 A 的指定 run，不影响 B。
2. 切换会话不等于 abort。
3. P1 完成后，短暂断线或刷新可重新订阅 active run。
4. 服务重启后的未完成 run 显示 interrupted，不伪装成 streaming。

### UI

1. 切换过程中不出现旧会话闪帧。
2. ThinkingDots、ActivityStrip 仅显示当前 session 的运行态。
3. 消息列表无重复节点导致的宽高和滚动异常。
4. 长代码块/表格仍保持现有 overflow 保护。

## 8. 最低测试矩阵

P0：

- Hook/store 单测：A streaming → B → A；
- Hook/store 单测：A 与 B generation 相同；
- Hook/store 单测：切换前排队 rAF、切换后执行；
- reducer 单测：重复 seq、乱序 seq、错误 sessionId/runId；
- serde 单测：新 ID round-trip、旧 JSONL 派生 ID 稳定；
- history 单测：请求竞态、revision/overlay 合并、重复 refetch；
- abort 集成测试：只取消 `(sessionId, runId)` 指定运行；
- 服务端测试：两个 session 并发、同 session 返回 409；
- Playwright：真实侧边栏快速切换，DOM 不包含其他会话文本；
- Playwright：A/B 同时运行后分别回切，状态和布局正确。

P1：

- RunRegistry 状态机与幂等终态测试；
- disconnect → reconnect → replay；
- replay buffer 过期返回 410 并回退 history；
- 慢 subscriber 断开但 run 继续；
- buffer/TTL/global cap 清理；
- run ledger 重启后标记 interrupted；
- 兼容 `messages/stream` 不创建重复 runner。

测试必须使用可控的延迟 ReadableStream/假 runner，不依赖真实模型。

执行命令：

```powershell
# 环境：Windows PowerShell 5.x、Node.js 22.x、npm（lockfileVersion 3）
npm ci
npm run check
npm test

Set-Location "web"
npm ci
npm run build
npm test
npm run e2e
```

预期：所有命令 exit code 0；P0/P1 对应新增测试全数通过。无需真实 provider key；
测试统一使用 fake runner。启动真实 Web 仅用于人工验收，环境变量沿用现有配置，
本方案不新增 secret 或外部服务。

## 9. 实施注意事项

- 先写可稳定失败的 A→B→A 测试，再改实现。
- 不要通过给页面加 key 来宣称完成；key 只解决视图重置。
- 不要继续扩展文本指纹；必须使用稳定 ID。
- 不要让 React Query 同时承担实时 stream store，以免 server cache 与运行态互相覆盖。
- P0 和 P1 应分开提交，便于定位回归。
- 当前本地依赖安装不完整，执行者开始前先恢复 lockfile 对应依赖；不得通过跳过前端测试交付。

## 10. 协议迁移、发布与回滚

1. P0 先发布后端宽松读 + 新字段双写 + history 新字段，再发布前端新 store；
2. 前端在兼容窗口内接受旧事件，但旧事件只能进入当前请求捕获的 session/run，
   不允许写入其他 session；服务端与前端升级后关闭旧事件分支；
3. P1 先部署 RunRegistry 与新 API，再切换前端 create/subscribe；旧
   `messages/stream` 保留一个版本；
4. 回滚前端时，后端继续保留旧适配入口；回滚后端时，新前端检测新 API 404 后
   降级到 P0 入口，但不承诺刷新重连；
5. 新增 JSONL 字段保持 optional，旧版本读取时忽略；不执行破坏性数据重写；
6. `<sessionId>.runs.jsonl` 是旁路 ledger，回滚可停止读取但不得删除；
7. 完成一个兼容版本且遥测无旧入口调用后，才允许另开任务移除旧 API。

## 11. 与既有方案的关系

`.ai-runtime-artifacts/specs/2026-08-08-chat-streaming-render-fix.md` 中的结构化 blocks、工具渲染和 overflow 设计继续有效。

本方案替代其中关于单一 `useChatStream` 状态、in-flight 快照、generation stale 判断和历史指纹合并的会话生命周期设计。

## Spec 自检

- 问题、根因和不在范围内事项已明确；
- 对比了紧急方案、前端隔离方案与完整恢复方案；
- 推荐方案包含数据所有权、事件协议、持久化、恢复和 UI 边界；
- 已补稳定 ID、P0/P1 边界、逐 frame seq、API、状态机、容量和崩溃语义；
- 已补旧 JSONL 兼容、发布顺序、回滚、环境命令与分阶段测试；
- 验收标准覆盖用户报告的串流、断流、状态和布局问题；
- 未修改业务代码；
- brainstorming skill 在当前可用路径中缺失，已按 Harness 契约记录 skipped。

## Next

- 确认方案无误 → 说「写计划」或「制定实施计划」
- 需要调整方案 → 直接说修改意见
- 若交给其他执行者：请同时提供本 spec、既有 2026-08-08 spec，以及本次诊断中的关键文件位置
