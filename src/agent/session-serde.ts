/**
 * Session 序列化类型定义
 *
 * 定义 PersistentSession 在磁盘上的存储格式。
 * 包括消息的 JSONL 行格式和结构化上下文侧车文件格式。
 */

import type {
  Message,
  MessageContent,
  MessageRole,
} from "../shared/types.js";
import type {
  CompletedWorkEntry,
  ExecutionPlanState,
  HistoryResource,
} from "./session.js";

// ============================================================
// 序列化消息格式（JSONL 行）
// ============================================================

/**
 * 写入 JSONL 文件的消息格式。
 *
 * 在 Message 基础上增加 `ts` 时间戳字段，用于审计和排序。
 * 其他字段与 `Message` 类型完全兼容。
 */
export type SerializedMessage = {
  /** 消息角色 */
  role: MessageRole;
  /** 消息内容块数组 */
  content: MessageContent[];
  /** 所属的 UI 轮次 ID */
  turnId?: number;
  /** Unix 毫秒时间戳 */
  ts: number;
  /** 稳定消息 ID（P0+）。新写入必含；旧数据由加载时派生。 */
  id?: string;
  /** 所属 run ID（P0+）。 */
  runId?: string;
};

// ============================================================
// Context 侧车格式（.context.json）
// ============================================================

/**
 * 已完成轮次的边界记录。
 *
 * 追踪每轮对话在消息数组中的起止位置和归档状态。
 */
export type SerializedTurn = {
  /** 轮次 ID */
  id: number;
  /** 用户消息在消息数组中的索引 */
  userMessageIndex: number;
  /** 最终 assistant 消息在消息数组中的索引 */
  finalAssistantMessageIndex: number;
  /** 轮次在消息数组中的起始索引 */
  startIndex: number;
  /** 轮次在消息数组中的结束索引（不含） */
  endIndex: number;
  /** 是否已归档（被压缩为摘要） */
  archived: boolean;
  /** 可选的轮次结果标签 */
  outcome?: string;
};

/**
 * 会话上下文状态的完整序列化格式。
 *
 * 存储在 `<session_id>.context.json` 中，
 * 包含无法从原始消息反推的结构化元数据。
 */
export type SerializedSessionContext = {
  /** 格式版本号 */
  version: 1;
  /** 下一个轮次 ID 分配器 */
  nextTurnId: number;
  /** 已完成（已关闭）的轮次列表 */
  completedTurns: SerializedTurn[];
  /** 持久资源引用列表 */
  resources: HistoryResource[];
  /** 当前活跃的执行计划 */
  executionPlan?: ExecutionPlanState;
  /** 已完成工作账本 */
  completedWork: CompletedWorkEntry[];
  /** 工作条目 ID 分配器 */
  nextWorkLedgerId: number;
};

// ============================================================
// 序列化辅助函数
// ============================================================

/**
 * 将内存中的 Message 转换为 JSONL 行格式。
 */
export function messageToSerialized(msg: Message): SerializedMessage {
  return {
    role: msg.role,
    content: msg.content,
    turnId: msg.turnId,
    ts: Date.now(),
    id: msg.id,
    runId: msg.runId,
  };
}

/**
 * 将 JSONL 行格式还原为 Message。
 *
 * `ts` 字段在反序列化时被丢弃（仅用于审计）。
 */
export function serializedToMessage(sm: SerializedMessage): Message {
  return {
    role: sm.role,
    content: sm.content,
    turnId: sm.turnId,
    id: sm.id,
    runId: sm.runId,
  };
}

/**
 * 验证一个对象是否为合法的 SerializedMessage。
 *
 * 用于加载 JSONL 时的基本合法性检查，防止格式不匹配的数据被加载。
 */
export function isValidSerializedMessage(obj: unknown): obj is SerializedMessage {
  if (!obj || typeof obj !== "object") return false;
  const m = obj as Record<string, unknown>;
  if (typeof m.role !== "string") return false;
  if (!["user", "assistant"].includes(m.role as string)) return false;
  if (!Array.isArray(m.content)) return false;
  return true;
}
