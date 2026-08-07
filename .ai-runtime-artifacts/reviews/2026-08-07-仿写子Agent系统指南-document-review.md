---
artifact: document-review
route: superpowers:document-review
skills:
  - document-review
skills_evidence:
  - .agents/skills/document-review/SKILL.md
source:
  - docs/spec/仿写子Agent系统指南.md
created_at: 2026-08-07
---

# 仿写子Agent系统指南 — 审查报告

## 文档类型

**技术实现指南**（兼具设计文档与实施计划特征）

信号：架构决策（七条硬决策）、分阶段路线图（S0–S3）、代码片段+文件路径、测试矩阵 → 匹配 design + plan 双重规则。

审查规则加载：
- [x] `review-rules/plan.md`（实施计划审查规则）
- [x] `review-rules/design.md`（架构/技术设计审查规则）
- [x] `checklists/review-checklist.md`（通用文档审查检查清单）

## 总体结论

**可以作为子Agent开发的核心参考文档，但不能作为独立实施文档直接使用。** 文档作为"仿写学习指南"质量极高（9/10），但作为"可独立执行的开发文档"存在关键缺口：缺少环境准备阶段、强依赖外部源码（Orkas）、缺少项目元数据。建议与 [subagent-implementation-plan.md](../specs/subagent-implementation-plan.md) 配套使用——前者是"为什么/做什么"的设计蓝图，后者是"在 my-agent 怎么做"的适配方案。

---

## 审查结果

### 1. 文档完整性

**评分：基本完整（7.5/10）**

**已覆盖：**
- 架构决策与心智模型（S0，七条硬决策，含决策理由）✅
- 分阶段路线图（S0→S1→S2→S3），每阶段有产出和验收 ✅
- 完整模块拆解（S1.1–S1.8，每模块有源码对照/代码片段/验收标准/代码量预估）✅
- 测试矩阵（单元/集成/安全，含测试原则）✅
- 反模式目录（17 条常见坑 + 正确做法）✅
- 术语表（附录 B，19 个术语）✅
- Orkas 源码完整对照表（附录 A）✅
- 给 AI 的任务索引（附录 C）✅
- S1、S1.8 自检脚本（附录 D、E）✅
- Q&A 索引（附录 F）✅

**缺失：**
- ❌ 文档元数据（无版本号、创建日期、作者、最后修改日期）
- ❌ 无变更日志（从 Orkas 搬到 my-agent 时的差异未标注版本演进）
- ❌ `agent.json` 完整字段规格未给出（仅 S2.1 有接口定义，但缺少各字段的可选/必选/默认值矩阵）
- ⚠️ S2.3（路由/楼层）对无 UI 的 CLI 项目的适用性未讨论

### 2. 逻辑清晰度

**评分：清晰（9/10）**

**优点：**
- 层次分明：S0 纠偏 → S1 闭环 → S2 产品 → S3 对齐，渐进式递进
- 每模块五段式结构：源码位置 → 类型定义 → 代码片段 → my-agent 适配要点 → 验收标准
- "学习策略"开篇即声明节奏（读→写→对比），降低读者焦虑
- 七条硬决策每条有「✅ 正确 / ❌ 错误」对比，有效防歧义
- 依赖图（ASCII art）直观展示模块关系

**可改进：**
- S0.3 七条硬决策与 S0.3 #7（回传分两层）信息密度过高，新手可能一次消化不了 → 建议加一个"速查卡片"
- 附录 C（给 AI 的阶段任务索引）与正文的阶段划分存在细微不一致：S1.5–S1.7 合并为一个任务，但正文是分开讲的

### 3. 环境准备完整性

**评分：不完整（4/10）** ⚠️ 红色警报

根据 `review-rules/plan.md`：**"第一阶段必须是环境准备"**。本文 S0 是概念纠偏，不是环境准备。这是一个结构性偏离。

**缺失的关键环境项：**

| 缺失项 | 影响 |
|--------|------|
| 无可执行的 `env-check` 验证脚本 | 读者无法一键确认前置条件就绪 |
| 前置模块（Runner/session-store/locks/paths） | 仅列出名称，无版本号/接口签名快照 |
| `async-mutex` 等外部依赖的版本声明 | S1.7 用到 `Semaphore`，但未声明需要安装 `async-mutex` |
| Node.js/TypeScript 版本要求 | 未声明最低版本 |
| Orkas 源码获取方式 | "读 30–60 分钟 Orkas 源码" 是 S0 之后每个模块的第一步，但未说明 Orkas 仓库地址或如何获取 |
| 无平台差异说明 | Windows/macOS/Linux 下的路径/Shell 差异未涉及 |

**前置条件已列但不够精确：**
```
✅ 已列：Runner、paths.ts、storage.ts、session-store.ts、locks.ts、第四阶段工具、Skill 指南
❌ 缺少：每个前置模块的"接口快照"（如 Runner.runStream 的签名），导致读者可能用到不兼容的 API
```

**建议：** 在 S0 之前插入 **S-1：环境就绪检查**，包含：
1. 依赖版本清单（`async-mutex`、`zod`、`vitest` 等）
2. `env-check.sh` / `env-check.ps1` 一键验证脚本
3. Orkas 源码获取说明
4. 前置模块接口快照

### 4. 测试计划

**评分：基本完整（6/10）**

**已覆盖：**
- 测试矩阵分三类：单元、集成、安全 ✅
- 测试原则明确："测不变量、恢复、并发、跨层契约、文本陷阱；不测纯 getter/仅类型包装" ✅
- 验收标准每模块都有 ✅
- S1、S1.8 有自检脚本 ✅

**缺失：**
- ❌ 无测试覆盖率目标（如行覆盖率/分支覆盖率百分比）
- ❌ 无测试数据准备方案（fixture 目录只列了 `fixtures/orchestration/`，未说明内容格式）
- ❌ 无 mock 策略说明（子 Agent 测试中，LLM 调用应 mock 还是 stub？）
- ❌ 无 CI 集成说明
- ❌ 集成测试的"完整闭环"场景缺少预期 token 消耗量级（有助于判断测试是否跑偏）

### 5. 架构决策记录

**评分：优秀（9.5/10）**

七条硬决策是本文档最亮眼的部分。每条决策包含：
- 决策内容（是什么）
- 反面模式（❌ 不做什么）
- 正确做法（✅ 怎么做）
- 技术理由（为什么）

额外亮点：S2.4 的"三种派发的本质区别"表格把容易混淆的 `run_worker` / `dispatch_to` / `hand_off_to` 语义讲得非常清楚。

**轻微缺陷：**
- 七条硬决策未使用 ADR（Architecture Decision Record）编号格式，不利于跨文档引用
- S0.3 #7（同步 vs 异步入队）本质上是第七条硬决策，但放在"七条"之后作为补充，标题层级不一致

### 6. 可执行性

**评分：良好（7/10）**

**优点：**
- S1.1–S1.8 每个模块有「你需要定义的」「代码量」「验收」三段式，可直接作为 task 派发 ✅
- 代码片段是完整可跑的 TypeScript（非伪代码）✅
- "踩坑"小节防止常见错误 ✅

**不足：**
- 任务粒度不均：S1.5（200 行）vs S1.2（25 行）差距 8 倍，S1.5 应进一步拆分
- "关掉源码，凭理解自己写"是可操作的行动指令，但**不可验证**——无法判断"凭理解"的产出是否质量过关
- 缺少故障排查指南（如"worker 跑完但主 Agent 没收到结果怎么排查"）

### 7. 风险与回滚

**评分：不完整（3/10）**

**已覆盖：**
- 17 条常见坑（反模式）覆盖了主要的技术风险 ✅

**缺失：**
- ❌ 无"如果 S1 实现后性能差怎么办"的降级路径
- ❌ 无"如果 Orkas 源码理解错误导致架构偏差"的检测机制
- ❌ 无回滚方案（每个阶段实现后如何回退到上一阶段？）
- ❌ 无阻塞性依赖标注（哪些模块必须先完成？正文有说但缺一个集中表格）

---

## 缺失项清单（按优先级）

| 优先级 | 缺失项 | 类型 | 影响 |
|--------|--------|------|------|
| **P0** | 缺少环境准备阶段（S-1） | 结构性 | 读者不知道从哪开始、环境是否就绪 |
| **P0** | Orkas 源码获取方式未说明 | 前置依赖 | 仿写第一步就是读源码，找不到源码后续全堵 |
| **P1** | 文档元数据（版本/日期/作者） | 元数据 | 无法判断文档时效性 |
| **P1** | 各阶段风险与回滚方案 | 风险管理 | 实现出问题无降级路径 |
| **P1** | 测试覆盖率目标 + 数据准备 | 质量保证 | 不知测到什么程度算完成 |
| **P2** | 外部依赖版本号（async-mutex 等） | 环境 | 版本不匹配可能导致行为差异 |
| **P2** | 故障排查指南 | 可维护性 | 出问题只能读源码 |
| **P2** | ADR 编号格式 | 可引用性 | 跨文档引用不便 |
| **P3** | CLI 无 UI 场景的适用性讨论 | 适配 | S2 路由/楼层章节对无 UI 项目可能浪费读者时间 |
| **P3** | 变更日志 | 可追溯性 | 无法追踪文档演进 |

---

## 改进建议（具体可操作）

### 建议 1：增加 S-1 环境就绪阶段

```markdown
# S-1：环境就绪（15 分钟）

## 依赖版本
- Node.js ≥ 18.0.0
- TypeScript ≥ 5.0
- async-mutex ≥ 0.4.0
- vitest ≥ 1.0.0

## Orkas 源码
git clone <orkas-repo-url> /path/to/orkas
本文档中 `src/main/features/group_chat/` 均相对于此目录。

## 前置模块接口快照
- Runner.runStream(params: RunStreamParams): Promise<AgentResult>
  - RunStreamParams: { sessionId, messageText, systemPrompt, signal? }
  - AgentResult: { text, meta? }

## 一键验证
bash env-check.sh
# 预期输出：✅ Node.js v18+ | ✅ async-mutex | ✅ Runner 可用 | ✅ session-store 可用
```

### 建议 2：拆分 S1.5（200 行过大）

当前 S1.5–S1.7 合并为一个大模块（200+ 行）。建议拆为：
- S1.5a `runNestedDispatch` 骨架（~80 行）
- S1.5b `runActorTurn` 实现（~60 行）
- S1.7（abort 级联 + dispatchSlots）独立验收

### 建议 3：补测试数据方案

```
fixtures/orchestration/
  ├── agent.json              # 最小命名 agent 规格（S2 用）
  ├── worker-expected-result.txt  # S1 闭环预期输出
  └── abort-scenario.json     # abort 级联测试输入
```

### 建议 4：为七条硬决策加 ADR 编号

```markdown
## S0.3 架构决策记录

- **ADR-001**：嵌套运行是同步的
- **ADR-002**：session 隔离是底线
- **ADR-003**：并发用信号量、独立于全局槽
- …
```

### 建议 5：标注对 CLI 无 UI 项目的适用性

在 S2 开头加一段：

> **my-agent（CLI）适配：** S2.2（名册）、S2.3（@路由/楼层）依赖群聊 UI。若你的项目是纯 CLI，S2 仅做 §2.1（loadAgent）+ §2.4（run_worker(to)），跳过名册与路由。

### 建议 6：加 doc-frontmatter

```yaml
---
title: 仿写子Agent系统 — 从零构建指南
version: v1.0.0
created: <YYYY-MM-DD>
author: <作者>
status: draft | review | approved
prerequisites:
  - 仿写Agent框架指南.md §第三阶段
  - Orkas 源码（仓库地址）
---
```

---

## 作为子Agent开发文档的适用性评估

| 使用场景 | 适用性 | 说明 |
|----------|--------|------|
| **学习子Agent原理与架构** | ⭐⭐⭐⭐⭐ | 完美。概念讲透、源码对照完整、代码可直接抄。 |
| **仿写/移植 Orkas 子Agent** | ⭐⭐⭐⭐⭐ | 最佳用途。每条"对应源码"注释精确到文件和行号。 |
| **独立实现子Agent系统** | ⭐⭐⭐ | 需要先剥离 Orkas 依赖。概念可复用，代码需适配。 |
| **作为项目正式开发文档** | ⭐⭐ | 缺少元数据、环境准备、风险矩阵。不适合直接当 spec。 |
| **作为 AI 子Agent 派发的 task 源** | ⭐⭐⭐⭐ | 阶段拆分清晰、验收标准明确。附录 C 可直接粘贴为 task prompt。配合 `subagent-implementation-plan.md` 效果更好。 |

**总体：推荐作为"设计蓝图 + 学习教程"，配套 `subagent-implementation-plan.md` 作为"项目适配方案"，两者互补构成完整的子Agent开发文档体系。**

---

## References 检查

- [x] `review-rules/plan.md` — 阶段结构、任务粒度、环境准备、测试计划、风险与回滚
- [x] `checklists/review-checklist.md` — 基础检查、内容完整性、清晰度、环境准备、可执行性
- [x] 文档与 `subagent-implementation-plan.md` 的互补关系已确认

## Next

- **不通过审查**（P0 缺失：环境准备阶段 + Orkas 源码获取方式未说明）
- 建议操作：
  1. 补 S-1 环境就绪阶段（建议 1）
  2. 补文档元数据 frontmatter（建议 6）
  3. 若作为正式项目文档，补风险与回滚章节
  4. 保持与 `subagent-implementation-plan.md` 的双向链接
- 补充后可作为**子Agent开发的核心参考文档**使用
