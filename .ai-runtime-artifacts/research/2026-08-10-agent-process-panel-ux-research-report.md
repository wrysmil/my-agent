---
artifact: research-report
route: web-investigator
skills:
  - frontend-ui-engineering
  - frontend-design
skills_evidence:
  - .agents/skills/frontend-ui-engineering/SKILL.md
  - .agents/skills/frontend-design/SKILL.md
source:
  - 用户提供的 Kimi 过程面板截图
  - 用户提供的当前项目过程面板截图
  - https://openai.com/index/introducing-deep-research/
  - https://claude.com/blog/research
  - https://platform.kimi.com/docs/guide/use-thinking-models
  - https://www.interaction-design.org/literature/topics/progressive-disclosure
  - https://www.uxtigers.com/post/progressive-disclosure
created_at: 2026-08-10
---

# Agent 过程面板交互调研

## 调研问题

当前项目已将一次 run 的持久化记录恢复到同一个 assistant 消息，但 UI 仍把数据结构直接暴露为：

- 一个默认展开、内部滚动的“过程信息”工具面板；
- 每个模型调用各自对应一个“思考过程”折叠条；
- 流式时另加 ActivityStrip；
- 最终正文继续包在大白色 assistant 卡片内。

结果是同一任务出现多个视觉容器、多个滚动区和多个同名控制项。用户无法快速回答三个最重要的问题：现在在做什么、已经做了多少、最终结果在哪里。

## 对照产品与原则

### Kimi

用户截图显示 Kimi 将一次任务的搜索、网页读取、代码执行和思考状态组织为**一个连续过程面板**，而不是为每个 reasoning block 建独立卡片。每一步是一行，使用图标、动作标题、结果数量与状态表达层级；最终回答位于过程面板之后。

Kimi 官方模型文档说明 `reasoning_content`、`content` 与多步工具调用属于同一任务连续上下文。这支持“内部保留多段 reasoning，展示层统一成一次任务过程”的投影方式，而不是把 provider 消息边界变成 UI 边界。

### ChatGPT Deep Research

OpenAI 官方说明长任务运行时使用 sidebar 展示步骤摘要与来源，用户可以实时跟踪并中断调整；最终报告仍回到聊天主内容。关键不是照搬侧栏，而是把**过程摘要**与**最终产物**分层。

### Claude Research

Anthropic 官方强调多次搜索、逐步探索与最终带引用结果。公开资料未给出足够细的组件规范，因此只采用“过程可核验、最终答案优先”的原则，不臆造 Claude 的具体像素实现。

### Progressive disclosure

IxDF 与相关 UX 资料的一致原则：

- 主视图只显示完成当前任务所需的信息；
- 高级细节保留为一个低摩擦的次级层；
- Agent 活动日志不应全部铺开，也不应完全隐藏；
- 展开深度应有限，避免折叠面板内再堆折叠面板；
- 标签应描述内容，例如“查看 8 个步骤”，避免重复的泛化标签“思考过程”。

## 对当前项目的结论

推荐采用“**单一 Run Trace + 最终答案优先**”模式，视觉接近 Kimi，但不复制 Kimi 的产品结构：

1. 每条 assistant 消息最多一个过程入口；
2. `thinking/tool_call/tool_result` 都投影为同一条有序 timeline；
3. 默认折叠，运行中自动展开；一旦 final text 出现则自动收起，但尊重用户手动选择；
4. 折叠摘要显示当前/最终状态与统计，例如：
   - 运行中：`正在搜索网页 · 5 个步骤 · 00:18`
   - 已完成：`已完成 12 个步骤 · 使用 5 个工具`
   - 有错误：`完成，但有 1 个步骤失败`
5. 展开后只有外层页面滚动，不设置固定 `max-height` 内部滚动；
6. thinking 不再显示为多个同名卡片，而作为 timeline 的轻量步骤：
   - 流式内容只显示简短状态“正在分析搜索结果”；
   - 完整 reasoning 文本按需在该步骤下二次展开；
7. tool call 与 tool result 合并成一个步骤，通过 `toolId/toolCallId` 配对；
8. 最终正文脱离过程容器，保持第一视觉优先级。

## 不建议照搬

- 不照搬 Kimi 左侧机器人头像和整套品牌图标；当前项目已有 Lucide 与语义色 token。
- 不照搬 ChatGPT 的独立 sidebar；当前项目聊天宽度约 860px，侧栏会挤压正文且需要新增跨组件状态。
- 不展示完整 chain-of-thought 作为默认内容；默认只呈现用户可核验的动作、输入摘要、结果状态和来源。
- 不新增第三层 modal/drawer；当前任务用消息内一个 details 层即可。
- 不继续保留 `ProcessTracker + 多个 ThinkingBlock + ActivityStrip` 三套并列入口。

## 项目适配边界

- React 19.1、Tailwind 4、Lucide、现有语义色 token 均可复用，不新增 UI 依赖。
- 保留现有 `Block` 数据协议和 SSE 协议；本期只增加展示层派生 selector/模型。
- 保留 `MessageBubble` 与 Markdown 正文渲染；重构过程相关子组件。
- 必须支持键盘、可见焦点、`aria-expanded/aria-controls`、状态文本，不以颜色作为唯一状态。
