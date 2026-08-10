# Chat 流式渲染修复 — 验证报告

> 日期：2026-08-08 | 类型：verification-lite

## 变更摘要

修复 4 个问题：
1. **后端 tool 事件丢失** — `adaptStreamEvent` 不处理 Runner 的 `AgentRunEvent` tool 事件
2. **前端不支持结构化内容** — `ChatMessage` 从 `{role, text}` 升级到 `{role, blocks: ContentBlock[]}`
3. **思考动画位置错误** — 从 ChatPage header 移到气泡内部
4. **内容撑开容器** — 添加 overflow 保护

## 验证结果

| 检查项 | 状态 |
|---|---|
| 后端 TypeScript (`tsc -p tsconfig.json`) | ✅ 通过（仅 2 个预存 logger.ts 错误） |
| 前端 TypeScript (`tsc -p web/tsconfig.json`) | ✅ 通过（仅 2 个预存 logger.ts 错误） |
| 前端 Vite 构建 (`vite build`) | ✅ 构建成功（516KB + 29KB CSS） |
| 后端测试 (`vitest run`) | ✅ 595 个测试中 594 通过（1 个预存 config 测试失败） |
| 前端测试 | ⚠️ 无法运行（jsdom 依赖缺失，非本次引入） |

## 变更文件清单

### 后端（3 文件）
- `src/shared/types.ts` — 扩展 StreamEvent 支持 tool/thinking/context 事件
- `src/web/server/routes/messages.ts` — 修复 adaptStreamEvent 处理全部 AgentRunEvent 类型
- `src/web/server/sse.ts` — listForCid 过滤 closed 条目

### 前端（11 文件）
- `web/src/features/chat/types.ts` — **新增** ContentBlock 类型定义
- `web/src/features/chat/useChatStream.ts` — **重写** 全部 SSE 事件处理 + rAF 节流
- `web/src/lib/sse.ts` — 扩展 KNOWN_EVENTS
- `web/src/components/chat/ThinkingDots.tsx` — **新增** 气泡内思考动画
- `web/src/components/chat/ThinkingBlock.tsx` — **新增** 可折叠思考内容
- `web/src/components/chat/ToolCallBlock.tsx` — **新增** 工具调用展示
- `web/src/components/chat/ToolResultBlock.tsx` — **新增** 工具结果展示
- `web/src/components/chat/ProcessTracker.tsx` — **新增** 过程追踪面板
- `web/src/components/chat/ActivityStrip.tsx` — **新增** 活动状态条
- `web/src/components/chat/MessageBubble.tsx` — **重写** 结构化内容渲染
- `web/src/components/chat/MessageList.tsx` — 适配新数据结构
- `web/src/pages/ChatPage.tsx` — 移除 header StreamIndicator，适配新类型
- `web/src/components/chat/Composer.tsx` — 适配新类型导入路径
- `web/src/styles/globals.css` — 添加 overflow 保护 CSS
- `web/tests/unit/message-copy.test.tsx` — 适配新 MessageBubble API

### 测试（1 文件）
- `src/web/server/routes/messages.test.ts` — 更新并发测试匹配新行为
