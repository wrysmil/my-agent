---
title: Web 前端重写 spec v3 — § 12 交互合同三路并行审查综合报告（v2 review）
date: 2026-08-08
artifact: document-review
route: superpowers:document-review
skills:
  - document-review
skills_evidence:
  - .claude/skills/document-review/SKILL.md（已 Load）
  - .claude/skills/document-review/review-rules/design.md（已 Load）
  - .claude/skills/document-review/checklists/review-checklist.md（已 Load）
source:
  - .ai-runtime-artifacts/specs/2026-08-08-web-frontend-react-rewrite-spec.md（被审文档 v3，§ 12 交互合同重点）
  - .ai-runtime-artifacts/contracts/2026-08-07-web-frontend-api-contract.md（v3 关联契约）
  - src/web/server/sse.ts:SSE_EVENT_TYPES（13 个事件）
  - src/web/server/errors.ts:ApiErrorCode（22 个 code）
  - web/js/app.js + web/js/features/{chat,sessions}.js（现有 vanilla JS 失败诊断）
created_at: 2026-08-08
status: draft
approved: false
prior_review: reviews/2026-08-08-web-frontend-spec-document-review.md（v1 review，15 Critical / 20+ Important，spec v1）
reviewers:
  - name: Reviewer D
    focus: 契约一致性 / 19 endpoint 覆盖度 / 错误码完整性 / SSE 事件对齐
    verdict: BLOCK
  - name: Reviewer E
    focus: 状态机完整性 / 边界场景 / 测试可执行性
    verdict: BLOCK
  - name: Reviewer F
    focus: 闭环 / 用户痛点修复度 / 现有 vanilla JS 失败诊断
    verdict: BLOCK
overall_verdict: BLOCK
---

# Web 前端重写 spec v3 — § 12 交互合同三路并行审查综合报告（v2 review）

> **结论：BLOCK** — 三路 reviewer 一致 BLOCK，共 **13 项 Critical（去重）** / **18 项 Important（去重）**。建议**重大修订**后再走 self-review → 用户 review → writing-plans。

v1 review 15 Critical 全部已在 spec v2/v3 解决（移除 httpOnly cookie、改 SSE 为 fetch+ReadableStream、改用 HashRouter、补后端最小改动清单、统一端口与 i18n）。v2 review 重点审查 § 12 交互合同新增内容，并发现新 Critical：

| 维度 | v1 review | v2 review |
|---|---|---|
| 范围 | spec v1 全文 | spec v3 § 12 + 关联章节 |
| Critical 数 | 15 | 13（去重） |
| 主要攻击面 | SSE / 路由 / 端口 / 后端最小改动 | 错误码全表 / 状态机边界 / 19 endpoint 全覆盖 / 用户高频动作缺失 |

---

## 文档类型

架构/技术设计文档（spec，含 § 12 交互合同 — 对应 `review-rules/design.md` § 5）。

---

## 审查规则加载

- [x] 通用审查流程（`SKILL.md`）
- [x] 文档类型特定规则：`review-rules/design.md` § 5（技术细节）
- [x] 环境准备审查规则：`review-rules/design.md` § 4 + `checklists/review-checklist.md`

---

## 评分

| 维度 | 评分 | 说明 |
|---|---|---|
| **1. 文档完整性** | 基本完整（v1→v3 大幅改善） | § 12 共 60+ 交互；缺用户高频动作（复制/重新生成/撤销）+ 部分 ApiErrorCode 缺覆盖 |
| **2. 逻辑清晰度** | 部分清晰 | § 6.4.3 状态机有自相矛盾；§ 7.1 与 § 12.10 局部冲突 |
| **3. 契约契合度** | 不一致 | 错误码 HTTP 状态 3 处错；错误码枚举漏 7 个；SSE 事件漏 2 个；§ 12.5 P-2 引用不存在 endpoint |
| **4. 可执行性** | 部分达标 | 测试断言缺期望值；submitting 超时阈值缺失；reconnecting 终止态未定义 |
| **5. 用户痛点修复度** | 7-8/10 | "交互为 0"和"404 问题"基本解决；"聊天实现"端到端覆盖；但缺复制/重新生成/撤销/点赞点踩 |

---

## Critical 缺失项（去重合并，按优先级排序）

> 三路 reviewer 各自发现的 Critical 项已去重合并（D4 + E2 合并为一项；D3 + E7 合并为一项）。

### C1. **缺 `GET /api/providers/active` 交互覆盖** — Reviewer D
契约 § 1.1 第 2 行 `GET /api/providers/active`（handler `getActiveProvider`）。spec § 12 全文未引用。启动时拉当前激活 provider 作为 `defaultModel` 显示 + 切换激活后回读。
**修复**：§ 12.5 加交互 P-active（合并到 P-1 自动预取）；明确 `useQuery` / `queryClient.setQueryData` 路径。

### C2. **§ 12.5 P-2 引用不存在的 endpoint: `GET /api/providers/:id`** — Reviewer D
spec § 12.5 P-2 写 "行点击 → `GET /api/providers/:id`"，但 contract § 1.1 / § 9 ROUTES 表**均无**该路由。实施按 spec 写必 404。
**修复方案**：(a) 改为从 P-1 已加载的 `queryKeys.providers.all` 缓存按 id 取（推荐）；(b) 开 issue 加 `GET /api/providers/:id` 并列入 § 12.11。**采用 (a)**：P-2 注明"本地缓存读取"+写清缓存失效时机。

### C3. **§ 12.10 Provider 校验错 HTTP 状态码（应为 422 而非 400）** — Reviewer D + E
- `PROVIDER_INVALID_BASE_URL` → spec 写 400，实际 422
- `PROVIDER_INVALID_TYPE` → spec 写 400，实际 422
- `PROVIDER_API_KEY_EMPTY` → spec 写 400，实际 422

**修复**：§ 12.10 改为 422；段首注明"HTTP 状态码以契约 § 3 / `errors.ts:ERROR_STATUS_MAP` 源码为准"。

### C4. **§ 12.10 错误码枚举缺 7 个 + 1 命名错位** — Reviewer D + E

| 漏掉的 code | 实际 status | spec § 12.10 处理 |
|---|---|---|
| `VALIDATION_FAILED`（spec 误写为 `VALIDATION_ERROR`） | 422 | 命名错位 |
| `PROVIDER_ALREADY_EXISTS` | 409 | 漏 |
| `SESSION_ALREADY_EXISTS` | 409 | 漏 |
| `CHAT_ABORTED` | 200 | 漏（abort 走 200；spec 未明示非错误） |
| `CHAT_INVALID_EVENT` | 500 | 漏 |
| `STREAM_ALREADY_RUNNING` | 409 | 漏（流重启竞态） |
| `STREAM_NOT_FOUND` | 404 | 漏（abort 引用已结束 streamId） |

**特别严重**：`CHAT_ABORTED` 200 — spec § 12.1.2 没声明 abort 在前端的成功路径如何走（依赖后端 200 还是 4xx/5xx 触发 fallback）。`STREAM_NOT_FOUND` 在断网重连后 abort 时触发，前端如未处理可能误显示 Toast。
**修复**：§ 12.10 增加这 7 行；将 `VALIDATION_ERROR` 统一改为 `VALIDATION_FAILED`。

### C5. **§ 12.1.1 流式帧处理遗漏 2 个 SSE 事件** — Reviewer D
spec § 12.1.1 "流式帧" 行只列 11 个事件，但 `sse.ts:SSE_EVENT_TYPES` 真实枚举 **13 个**：
- 漏 `content_block_start`（块开始；`useChatStream` 需要知道 assistant 块边界才能正确处理 text replacement 与 tool_use 切换）
- 漏 `content_block_stop`（块结束；同样需要）

§ 6.4.2 表格正确，但 § 12.1.1 表述与 § 6.4.2 不一致。
**修复**：§ 12.1.1 改写为"覆盖全部 SSE_EVENT_TYPES 13 种事件，处理细则见 § 6.4.2"，避免两节不同步。

### C6. **§ 6.4.3 状态机 error / reconnecting 入口条件冲突** — Reviewer E
同一段内两条互相矛盾的规则：
- "error: error 事件或网络断开 → 标记失败"
- "reconnecting: 网络断开 5xx 或 reader 抛错 → 指数退避"

"网络断开" / "reader 抛错" 同时被声明为 error 和 reconnecting 的入口。`useChatStream` 实现者无法判断走哪条。
**修复**：明确分流——`submitting` 阶段 POST 失败/网络断 → `error`（POST 不可幂等重发）；`streaming` 阶段 reader 抛错或网络断 → `reconnecting`（仅 resync 已收帧语义）；§ 7.1 与 § 6.4.3 对齐。

### C7. **`submitting` 超时阈值缺失** — Reviewer E
§ 6.4.3 仅说 "submitting: POST /messages/stream 等待响应头"，§ 12.1.1 未给超时阈值。若后端响应头一直不来（DDOS、代理 hang），前端会无限停留在 submitting。
**修复**：§ 6.4.3 增加 "submitting 超时 10s 后切 error 并 Toast '服务无响应'"；写到 § 12.1.1 / § 12.10 G-7 fallback。

### C8. **`reconnecting` 终止状态未定义** — Reviewer E
§ 6.4.3 仅说 "超过后 Toast '连接已断开，请刷新'"——未说明 5 次重连耗尽后进 `error` 还是新 `disconnected` 态，也未说明"已渲染的 assistant 文本"如何处置（保留还是回滚）。
**修复**：明确 `reconnecting` 终止时进入 `error`（commit 已收内容到 cache，标红 assistant 消息）+ Toast；§ 12.10 增 `CHAT_STREAM_INTERRUPTED`（建议加的新 code）或在 `INTERNAL` / `CHAT_RUNNER_ERROR` 行加注。

### C9. **§ 11 "21 wire-routes" 与实际 19 个 endpoint 不一致** — Reviewer E
契约 § 1 实际 19 个 endpoint（Provider 8 + Session 5 + Chat 2 + Agent 2 + Skill 2）。spec § 12 也覆盖 19。但 § 11 A3 / § 1.1 / § 11 A12 均称"21 wire-routes"，§ 9.2 M6 也称"覆盖 21 个 wire-route 中至少 80%"。
**修复**：统一改为"19 wire-routes"。

### C10. **§ 12.10 PAYLOAD_TOO_LARGE "自动截断"是危险的实现指令** — Reviewer E
§ 12.10 行 "PAYLOAD_TOO_LARGE | 413 | Toast '内容过长，请精简' | Composer 自动截断并提示"。自动截断会**静默丢失用户已输入的尾部内容**，违反 § 1.2 目标 4"保留行为"中"用户已写内容应可恢复"的隐含期望；与 § 7.1 行 "Toast '内容过长，请精简'"（无截断指令）冲突。
**修复**：删除"自动截断"，仅保留 Toast + 高亮超出字符数 + 阻止提交；§ 12.1.1 入参校验里加 "text > 32000 时前端先 Toast 阻止提交，不发请求"。

### C11. **§ 12.1.5 压缩触发缺少量化阈值** — Reviewer F
spec 原文："Composer 旁"压缩"按钮（自动判断 token 用量；或手动点）"。仅一句"自动判断"未给阈值；契约 § 1.2 `POST /api/sessions/:cid/compact` 返回 `{ used, limit, ratio, willCompact: true }`，**前端如何决定"自动触发"** 没有规则（>80%？>90%？每条消息后？只在 done 后？）。
**修复**：§ 12.1.5 增补"自动触发规则"段（如"每次 `message_stop` 后，若 `used/limit > 0.9` 则弹 Modal 询问是否压缩"），并写明 modal 文案。

### C12. **§ 12 缺少"重新生成助手回复"交互（用户高频动作）** — Reviewer F
spec § 12.1.3 只覆盖"失败消息的重试"。但用户高频动作是"已成功生成但想换一个回答"（regenerate）。当前 spec 没有这条交互，实现时会被迫合并到"重试发送"按钮，导致按钮语义模糊。
**修复**：§ 12.1 新增 12.1.7 "重新生成回复"——触发：assistant 消息下方"↻ 重新生成"按钮；HTTP：同 12.1.1 但 `text` 替换为上一条 user 消息的原文；与"重试"区别于"是否删除旧 assistant 消息"。

### C13. **§ 12 全集缺"复制消息文本"交互（用户基本动作）** — Reviewer F
整篇 § 12 没有"点击消息气泡 → 复制到剪贴板"。这是阅读聊天历史时用户最常做的事。
**修复**：§ 12.1 / § 12.3 加 MessageBubble hover/右键菜单"复制"项；写明 `navigator.clipboard.writeText` + Toast "已复制"反馈。

---

## Important 缺失项（精选 Top 18，去重合并）

| # | 项 | 章节 | 来源 |
|---|---|---|---|
| I1 | abort 请求体 `{ streamId: string }` 应为 `{ streamId?: string }` | § 12.1.2 | D |
| I2 | § 12.10 表格列重排为「code → HTTP status → UI 反馈 → 自动行为」四列 + 段首补"22 个 code 全覆盖" | § 12.10 | D |
| I3 | § 12.11 缺 `GET /api/providers/:id`（如不补请显式说明本地缓存读取） | § 12.11 | D |
| I4 | § 7.1 与 § 12.10 UI 反馈不一致（CHAT_RUNNER_ERROR 应专属于助手消息红条，不应被 Toast 化；CHAT_SESSION_BUSY 用 retryAfterMs 替代硬编码 1s） | § 7.1 / § 12.10 | D + E |
| I5 | 边界场景：多 tab in-flight 429 时，禁用秒数 = retryAfterMs，timer 到期自动恢复，disable 期间可继续编辑 draft | § 12.1.1 | E |
| I6 | 边界场景：发送按钮在 submitting / streaming / reconnecting 期间 disabled；aborted 后清空旧 controller ref、重置 streamId 缓存 | § 6.4.3 | E |
| I7 | 边界场景：streaming 期间"重试发送"按钮不出现；停止按钮走 § 12.1.2，文本固定为"停止" | § 12.1.3 | E |
| I8 | `done` vs `message_stop` 双事件触发语义：任一即可，或 200ms 缓冲期等 done | § 6.4.2 / § 12.1.1 | E |
| I9 | reconnecting 状态无独立测试用例 | § 8.2 / § 12.1.1 | E |
| I10 | § 6.4.3 "error 状态 commit" 与 § 12.1.3 "重试删除占位"语义冲突 → 改为"保留 partial 文本待用户决定" | § 6.4.3 | E |
| I11 | § 7.1 + § 12.10 Toast 文案风格不一致（imperative + 行动建议；≤16 字 zh / ≤80 字 en；复合提示拆 title + body） | § 7.5 | E |
| I12 | § 12.9 G-6 "上线 Toast" 过度打扰 → debounce 1.5s 后才触发 online Toast | § 12.9 | E |
| I13 | 自动滚动打断用户阅读 → 仅当 `scrollTop + clientHeight >= scrollHeight - 100px` 时滚动；用户向上滚后下方出现"↓ N 条新消息"浮动按钮 | § 12.3 C-8 | E + F |
| I14 | § 12.1.6 @ 提及测试断言需严格 `body.text === 原 draft + '@<name>'` | § 12.1.6 | E |
| I15 | § 12.4 S-1 / S-7 搜索无结果空态规格 + 匹配字段（name fuzzy + id prefix + preview contains） | § 12.4 | F + E |
| I16 | § 12.5 P-4 / P-5 缺 "提交期间 disable submit button + spinner + cancel 不可用" | § 12.5 | F |
| I17 | § 12 缺"撤销刚才发送的消息"（send 后 5 秒内可撤回） | § 12.1 | F |
| I18 | § 12.5 P-7 / P-8 / P-9 缺 cache 失效策略（setQueryData 原地更新 vs invalidate refetch） | § 12.5 | D + F |

---

## Suggestion（精选 Top 8）

1. § 12.10 表头"HTTP"列每行都明确状态码（避免读表歧义） — E
2. § 6.4.2 `error` 事件与 § 12.1.1 `CHAT_RUNNER_ERROR` 处理方式不一致（§ 6.4.2 区分 code） — E
3. § 6.4.2 未列出的事件类型应显式忽略（不 throw） — E
4. § 6.4.3 未给 `submitting → reconnecting` 路径（明确 submitting 网络断 → error，不进 reconnecting） — E
5. § 12.10 row1 共用 INVALID_JSON 与 VALIDATION_ERROR 但 § 12.5 P-4/P-5 分开列 → 统一为 VALIDATION_FAILED — D + E
6. § 12.5 P-4 / P-5 `RETURN_TYPE` 风格不一致（`{ provider }` vs `{ ok: true }`）→ 段首统一约定 — D
7. § 12.7 A-2 错误码 AGENT_SPEC_INVALID_JSON Modal 内容来源未定义（error.details 未明示） — D
8. § 1.3 非目标加一条"不优化移动端触摸交互（kebab button 触发菜单）" — F

---

## Nit（精选 Top 8）

1. § 12.11 表格"期望功能"列改为祈使语气函数名（rename session / export session） — D
2. § 12.1.5 紧凑端点 `:cid` 与 § 12.1.x `:id` 命名统一 — D
3. § 12.1.4 "错误码 SESSION_CORRUPT_FILE → Toast + 详情链接" 与 § 12.10 "详情 Modal" 不一致 → 统一 Modal — D
4. § 12.2 D-1 `limit: 10` 含义写明"显示 Dashboard 首页最多 10 条" — D
5. § 6.4.3 reconnecting "重连不重发 POST" 与 § 7.1 "监听 online 事件恢复" 表述不一致 — E
6. § 7.3 size-limit 未列入 devDependencies 表 — E
7. § 12.10 row1 共用 INVALID_JSON 与 VALIDATION_ERROR 但 § 12.5 P-4/P-5 分开列 — E
8. § 12.9 G-1 命令面板"会话"数据源未说明（useSessions() Query cache） — E

---

## 改进建议（按优先级）

### P0（必须修订才能继续）

1. **§ 12.10 错误码全表重写** — 见 C3 / C4（22 个 code 全覆盖 + 状态码对齐 422 + VALIDATION_FAILED 改名）
2. **§ 6.4.3 状态机重写** — 见 C6 / C7 / C8（error/reconnecting 分流；submitting 10s 超时；reconnecting 终止态）
3. **§ 12.5 P-2 改本地缓存读取** — 见 C2
4. **§ 12.5 加 P-active 交互** — 见 C1
5. **§ 12.1.1 流式帧列 13 个事件** — 见 C5
6. **§ 11 + § 9.2 改 19 wire-routes** — 见 C9
7. **§ 12.10 PAYLOAD_TOO_LARGE 删自动截断** — 见 C10
8. **§ 12.1.5 压缩量化阈值** — 见 C11
9. **§ 12.1 新增 12.1.7 重新生成回复** — 见 C12
10. **§ 12.1 / § 12.3 加复制消息文本** — 见 C13

### P1（修订后必须补）

11. **§ 12.1.2 streamId optional + 注"无 streamId 时按 cid abort"** — 见 I1
12. **§ 12.10 表格重排 + 段首"22 个 code 全覆盖"注** — 见 I2
13. **§ 12.11 显式说明 P-2 本地缓存读取 + § 7.1 / § 12.10 UI 反馈一致性** — 见 I3 / I4
14. **边界场景补全**（多 tab in-flight / 按钮禁用 / 重试按钮出现时机） — 见 I5 / I6 / I7
15. **`done` vs `message_stop` 双事件触发语义明确** — 见 I8
16. **reconnecting 独立测试用例 + 验证项** — 见 I9
17. **§ 6.4.3 "error 状态 commit" 与 § 12.1.3 "重试删除占位" 统一为"保留 partial 待用户决定"** — 见 I10
18. **Toast 文案规范**（imperative + 行动建议；≤16 字 zh / ≤80 字 en） — 见 I11
19. **online Toast debounce 1.5s + 自动滚动条件 + "↓ N 条新消息" 浮动按钮** — 见 I12 / I13
20. **§ 12.1.6 @ 提及测试断言严格 `body.text` 验证** — 见 I14
21. **§ 12.4 搜索无结果空态 + 匹配字段规格** — 见 I15
22. **§ 12.5 表单提交期间 disable + spinner** — 见 I16
23. **§ 12.1 加"撤销发送"交互** — 见 I17
24. **§ 12.5 P-7/P-8/P-9 setQueryData 替代 invalidate** — 见 I18

### P2（实现阶段关注）

25. § 6.4.2 `error` 事件细分 CHAT_RUNNER_ERROR / 其他 — S1
26. § 6.4.2 未列出事件显式忽略 — S3
27. § 6.4.3 明确 submitting → error（不经过 reconnecting） — S4
28. § 12.5 返回类型统一 `{ provider }` vs `{ ok: true }` — S6
29. § 12.7 A-2 Modal 内容来自 `error.details` + requestId fallback — S7
30. § 1.3 非目标加移动端触摸交互 — S8

---

## 用户痛点修复度评分（v2 review 视角）

| 痛点 | 修复度 | 备注 |
|---|---|---|
| **"什么都交互不了"** | 8/10 | § 12 共 60+ 交互覆盖，但缺 8 个用户高频动作（复制 / 重新生成 / 撤销 / 点赞点踩 / 消息搜索 / 多会话并发 / 清空 composer / 导出含 assistant 消息）|
| **"和后端的交互为0"** | 9/10 | § 12.1-§ 12.8 共 47 个后端交互（含 § 12.5 P-1 / P-2 / P-`active` / P-3..P-10）。P-2 endpoint 不存在风险已标 C2 |
| **"点什么都404"** | 9/10 | § 12.11 列 6 缺失 endpoint + § 12.10 全错误码映射；C4 补完后可达 10/10 |
| **"最重要的聊天也实现不了"** | 8/10 | § 12.1 端到端覆盖；修复了 vanilla JS 3 个核心 bug（streamId / abort / compact endpoint）；缺 C11 阈值 / C12 重新生成 / C13 复制 |

**总体：8.5/10 — spec v3 已远超现状，但 Critical 14 项仍需修订才能进入 plan 阶段**。

---

## 与 v1 review 对比

| 维度 | v1 review（spec v1） | v2 review（spec v3） |
|---|---|---|
| Critical 数 | 15 | 13（去重） |
| 攻击面 | 后端契合度（SSE/路由/CSP/端口）| 交互合同完整性（错误码/状态机/用户高频动作）|
| 严重程度 | 阻断性（SSE 走不通会全失败）| 局部性（局部交互漏体验退化）|
| 风险类型 | 架构错 | 设计错 + 体验错 |

**v1 review 的 15 项 Critical 全部已在 spec v2/v3 解决**（移除 httpOnly cookie、改 SSE 为 fetch+ReadableStream、改用 HashRouter、补后端最小改动清单、统一端口 4321 与 i18n 路径、补依赖版本表、Node/浏览器下限、.env.example 等）。

---

## 现有 vanilla JS 失败诊断（Reviewer F 提供）

读 `web/js/app.js`（782 行）+ `web/js/features/{chat,sessions}.js`（118 + 694 行）发现的关键 bug，spec v3 必须修复：

| 现有 bug | spec v3 修复位置 |
|---|---|
| `EVENT_AGENT_LAUNCH` / `EVENT_SKILL_USE` 处理仅把 `/agent xxx` 文本塞 textarea，无真正后端调用 | § 12.7 A-4 / § 12.6 K-4 标"不实现 + UI 隐藏"|
| `stream()` 函数只传 `{ text }` 不传 `systemPrompt` | § 12.1.1 入参显式列 `systemPrompt?` |
| `lastSeq` 用 cid 当 key（实际是字符串数字而非真正 last id）| § 12.1.1 streamId 流程修正 |
| `stop` 只调 `controller.abort()` 未调 `POST /messages/abort` | § 12.1.2 双端 abort |
| `compactFlow` 调用 `/compact/preview`（契约中不存在，必 404）| § 12.1.5 单步 + Modal |
| t() 在 i18n 缺失时回退到 key（不是 fallback 字符串）→ UI 显示 `[session.new]` | § 7.5 i18n fallback 规则 |

---

## 后续步骤

按 document-review skill：

**审查不通过 → 返回修改文档**

按 Harness 阶段门禁，spec 修订后须重新走：

1. **Spec self-review**（placeholder / consistency / scope / ambiguity）
2. **用户 review**（已通过本次三路并行审查给出修订方向）
3. **再次三路审查**（可选，重点验证 v2 review 的 13 项 Critical 是否全部解决）

建议流程：

| 步骤 | 谁 | 产物 |
|---|---|---|
| 1. 修订 spec（按 P0/P1） | Leader（直接 Write/Edit） | spec.md 更新到 v4 |
| 2. Spec self-review | Leader | inline 修复 |
| 3. 用户 review | 用户 | 「写计划」或给修改意见 |
| 4. 三路再审查（可选） | 3 个 reviewer subagent | reviews/...-document-review-v3.md |
| 5. 写实施计划 | Leader（Load `writing-plans`） | plans/2026-08-08-web-frontend-react-rewrite-plan.md |

---

## Next

- **审查不通过**（BLOCK）→ 返回修改 spec v4（按 13 Critical + 18 Important 修订）
- **修订后再走 self-review + 用户 review**
- **通过后** → 进入 `writing-plans` 阶段（写实施计划）