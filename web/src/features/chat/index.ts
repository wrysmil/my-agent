/**
 * Chat Features — 统一导出
 *
 * 状态与 Store：
 * - chatRuntimeStore: 会话运行时 Store
 *
 * Hooks：
 * - useChatStream: SSE 流处理
 * - useApprovalInteraction: 审批交互
 *
 * 审批系统：
 * - ApprovalContext: 全局审批上下文
 * - approvalManager: 审批状态管理器
 *
 * 类型：
 * - types: ChatMessage, TextBlock, ToolCallBlock 等
 */

export { useChatStream } from './useChatStream';
export type { UseApprovalReturn } from './useApproval';
export { useApprovalInteraction } from './useApproval';

export {
  ApprovalProvider,
  useApproval,
  createApprovalHandler,
  type ApiClientLike,
} from './ApprovalContext';
export type {
  ApprovalItem,
  ApprovalContextValue,
  ApprovalProviderProps,
} from './ApprovalContext';

export { ApprovalManager } from './approvalManager';
export type { ApprovalRequest, ApprovalManagerOptions } from './approvalManager';

export {
  useChatRuntimeStore,
  MAX_PENDING_PERSISTENCE_PER_SESSION,
  PENDING_PERSISTENCE_TTL_MS,
} from './chatRuntimeStore';
export type { ChatRuntimeState, SessionRuntime, RunRuntime } from './chatRuntimeStore';

export * from './types';
export * from './pending-message';
export * from './runTrace';
