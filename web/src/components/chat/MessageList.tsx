import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage, ChatStatus } from '@/features/chat/types';
import { MessageSquare } from 'lucide-react';

/**
 * 距离底部的阈值（像素）。当用户滚到距离底部 < 此值时，认为「在底部」，
 * 新消息到来会自动滚动到底部；否则保持当前滚动位置 —— 让用户能正常翻看历史。
 */
const STICK_TO_BOTTOM_THRESHOLD_PX = 80;

export function MessageList({
  messages,
  status,
}: {
  messages: ChatMessage[];
  status: ChatStatus;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // 用户是否「粘底」：true → 新消息触发自动滚到底；false → 保持位置。
  // 初始 false（切回会话 / 首屏加载时不要立刻强制拉到底部，让用户停在原位置）。
  const stickToBottomRef = useRef(false);
  // 标记「已经做过初次定位」——只有首次 messages 变化后才允许根据用户滚动决定。
  const initializedRef = useRef(false);

  // 监听滚动：用户主动往上滑 → 脱离粘底；回到接近底部 → 恢复粘底
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // 自动滚动到底部：仅当用户当前在底部时。
  // 首屏（initialized=false）时也不强制滚动——避免用户切回会话时被强制拉到底。
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      // 首次挂载：保持当前滚动位置（可能是 0 顶部）。但如果内容短于容器、
      // 用户在顶部等同于「在底部」也合理——把 stick 设为 true 以便后续追加内容跟随。
      const el = containerRef.current;
      if (el) {
        const distFromBottom =
          el.scrollHeight - el.scrollTop - el.clientHeight;
        stickToBottomRef.current = distFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
      }
      return;
    }
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" role="log" aria-live="polite">
        <div className="text-center space-y-4 max-w-md px-6">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/5 flex items-center justify-center">
              <MessageSquare className="w-7 h-7 text-primary/40" />
            </div>
          </div>
          <div>
            <h3 className="text-base font-semibold text-text mb-1">开始对话</h3>
            <p className="text-sm text-text-muted/70 leading-relaxed">
              在下方输入框输入消息，按{' '}
              <kbd className="px-1.5 py-0.5 text-[11px] bg-surface-hover border border-border rounded font-mono">
                Enter
              </kbd>{' '}
              发送。Shift+Enter 换行。
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isStreaming = status === 'streaming' || status === 'submitting' || status === 'reconnecting';

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto overflow-x-hidden px-5 pt-6 pb-4"
      role="log"
    >
      <div className="space-y-5">
        {messages.map((m) => {
          const isCurrentAssistant =
            m.role === 'assistant' && m === messages[messages.length - 1];
          return (
            <div key={m.id} className="message-enter">
              <MessageBubble
                message={m}
                isStreaming={isStreaming && isCurrentAssistant}
                aborted={status === 'aborted' && isCurrentAssistant}
              />
            </div>
          );
        })}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}
