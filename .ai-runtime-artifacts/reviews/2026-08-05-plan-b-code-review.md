# Plan B 代码审查报告

> **审查类型:** 五轴审查（正确性/可读性/架构/安全/性能）
> **审查者:** code-reviewer agent
> **审查范围:** dfe34b4 + 4f4476d (10 files, +2317/-16 LOC)
> **date:** 2026-08-05

## 总体判定: REQUEST CHANGES

3 个 BLOCK 需修复，10 个 WARN 建议修复，若干 INFO 改进项。

## BLOCK 问题

### B1. LLM 输出经 marked 直接 innerHTML，无 HTML 消毒
- **文件:** `electron/renderer/js/pages/chat.js:166`, `electron/renderer/modules/markdown.js:6`
- **风险:** `marked.parse()` 默认透传原始 HTML。LLM 输出不可信，存在 prompt injection → XSS 链路。CSP `script-src 'self'` 部分缓解但 `style-src 'unsafe-inline'` 仍可被利用。
- **修复:** 引入 DOMPurify 消毒 marked 输出

### B2. 页面重复进入导致事件监听器累积
- **文件:** `electron/renderer/js/app.js:66-77`, `sessions.js:15-18`, `settings.js:13-20`, `skills.js:12-27`
- **风险:** SessionsPage/SettingsPage/SkillsPage 无 `_initialized` 守卫，每次 navigate 都重新 bindEvents，监听器线性增长
- **修复:** 加 `_initialized` 守卫（同 ChatPage 模式）

### B3. chat 并发发送污染流状态
- **文件:** `electron/renderer/js/pages/chat.js:162, 213-231`
- **风险:** send() 无发送中守卫，第二次 send 覆盖 currentStream/currentAssistantEl，导致取消/错误归属错乱
- **修复:** 发送期间禁用按钮 + `if (this.currentStream) return`

## WARN 问题 (10项)

详见集体测试报告中的完整列表。重点:
- W1: 时间筛选分页失真
- W3: 流式监听器泄漏
- W4: 每 token 全量重渲染 O(n²)
- W6: 设置页保存语义缺陷
- W8: 多处未转义字段

## 正面评价

- CSP 已落地，关键用户输入走转义路径
- 每页独立对象、data-* 驱动导航，路由与状态解耦清晰
- 流式协议设计干净 (on/cancel)
- CSS 复用设计令牌、空态兜底、时间分组等 UX 细节到位
- 中文注释 + 英文标识符风格统一
