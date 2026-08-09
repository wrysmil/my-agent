/**
 * 跨 ChatPage 实例传递「首条消息」文本的极简 store。
 *
 * 背景：会话只在用户真正发送首条消息时才创建。
 * 旧实现：访问 /chat → 立即 POST /api/sessions → 即使不发消息也留空记录。
 * 新实现：
 *   1. 访问 /chat → 渲染空 Composer（不创建会话）
 *   2. 用户敲完按 Enter → handleSend 先 POST /api/sessions 拿到新 id
 *   3. setPendingMessage(newId, text) + navigate(/chat/:newId, { replace: true })
 *   4. 新的 ChatPage 实例 mount → historyLoaded 后 takePendingMessage(newId) 触发 send
 *
 * 用模块级 Map 而非 React state 是因为 setPendingMessage 调用方是 handleSend 的
 * 闭包，而消费方是另一个 React 实例的 effect —— 走 React state 反而绕路。
 * SPA 单客户端场景下，模块级 Map 足够安全，无需 Context / 全局 store。
 */

const pendingBySession = new Map<string, string>();

export function setPendingMessage(sessionId: string, text: string): void {
  pendingBySession.set(sessionId, text);
}

/** 取出并清除——避免重复发送。 */
export function takePendingMessage(sessionId: string): string | undefined {
  const t = pendingBySession.get(sessionId);
  if (t !== undefined) pendingBySession.delete(sessionId);
  return t;
}
