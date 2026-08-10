/**
 * 跨 ChatPage 实例传递「首条消息」文本的极简 store。
 *
 * 背景：会话只在用户真正发送首条消息时才创建。
 * 旧实现：访问 /chat → 立即 POST /api/sessions → 即使不发消息也留空记录。
 * 新实现：
 *   1. 访问 /chat → 渲染空 Composer（不创建会话）
 *   2. 用户敲完按 Enter → handleSend 先 POST /api/sessions 拿到新 id
 *   3. setPendingMessage(newId, text, { autoSend: true, options })
 *      + navigate(/chat/:newId, { replace: true })
 *   4. 新的 ChatPage 实例 mount → historyLoaded 后 takePendingMessage(newId)
 *      → autoSend=true 时自动调用 send()，无需用户再点一次发送
 *
 * 用模块级 Map 而非 React state 是因为 setPendingMessage 调用方是 handleSend 的
 * 闭包，而消费方是另一个 React 实例的 effect —— 走 React state 反而绕路。
 * SPA 单客户端场景下，模块级 Map 足够安全，无需 Context / 全局 store。
 */

import type { ChatOptions } from './types';

interface PendingEntry {
  text: string;
  /** 消费时是否自动调用 send()（懒创建会话场景） */
  autoSend: boolean;
  /** 发送时使用的选项（模型、思考级别等） */
  options?: ChatOptions;
}

const pendingBySession = new Map<string, PendingEntry>();

export function setPendingMessage(
  sessionId: string,
  text: string,
  opts?: { autoSend?: boolean; options?: ChatOptions },
): void {
  pendingBySession.set(sessionId, {
    text,
    autoSend: opts?.autoSend ?? false,
    options: opts?.options,
  });
}

/** 取出并清除——避免重复发送。 */
export function takePendingMessage(sessionId: string): PendingEntry | undefined {
  const entry = pendingBySession.get(sessionId);
  if (entry !== undefined) pendingBySession.delete(sessionId);
  return entry;
}
