/**
 * Chat Components — 统一导出
 *
 * 气泡系列：
 * - Bubble: 统一容器（wrapper）
 * - UserBubble: 用户消息气泡
 * - AssistantBubble: AI 消息气泡
 * - AgentBubble: 子 Agent 气泡
 *
 * 辅助组件：
 * - TraceBubble: trace 容器
 * - GeneratingIndicator: 生成指示器
 * - ProgressIndicator: 流式进度反馈
 * - ApprovalDialog: 审批弹窗
 *
 * 业务组件：
 * - MessageBubble: 主消息气泡（组合上述组件）
 * - RunTracePanel: Run Trace 详情面板
 * - Composer: 消息输入框
 * - MessageList: 消息列表
 * - Markdown: Markdown 渲染
 */

export { Bubble, type BubbleProps, type BubbleRole } from './Bubble';
export { UserBubble, type UserBubbleProps } from './UserBubble';
export { AssistantBubble, type AssistantBubbleProps } from './AssistantBubble';
export { AgentBubble, type AgentBubbleProps } from './AgentBubble';
export { TraceBubble, type TraceBubbleProps } from './TraceBubble';
export { GeneratingIndicator } from './GeneratingIndicator';
export { ProgressIndicator, type ProgressIndicatorProps, type ProgressType } from './ProgressIndicator';
export { ApprovalDialog, type ApprovalDialogProps } from './ApprovalDialog';

export { MessageBubble } from './MessageBubble';
export { RunTracePanel, type RunTracePanelProps } from './RunTracePanel';
export { Composer } from './Composer';
export { MessageList } from './MessageList';
export { Markdown } from './Markdown';
export { ThinkingDots } from './ThinkingDots';
export { AttachmentList } from './AttachmentList';
export { ContextDropdown } from './ContextDropdown';
export { ComposerAttachmentButton } from './ComposerAttachmentButton';
export { QuestionComposer, type QuestionComposerProps, type QuestionOption } from './QuestionComposer';
