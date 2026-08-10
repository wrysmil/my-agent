/**
 * ThinkingDots — 气泡内思考动画（三个跳动点）。
 *
 * 替代原 ChatPage header 中的 StreamIndicator，
 * 放在聊天气泡内部，流开始时显示，内容到达后隐藏。
 */
export function ThinkingDots() {
  return (
    <span
      className="inline-flex items-center gap-[5px] text-[12.5px] text-text-muted py-0.5"
      aria-label="AI 正在思考"
    >
      <span
        className="w-[5px] h-[5px] rounded-full bg-text-muted animate-bounce"
        style={{ animationDelay: '0ms', animationDuration: '1.3s' }}
      />
      <span
        className="w-[5px] h-[5px] rounded-full bg-text-muted animate-bounce"
        style={{ animationDelay: '180ms', animationDuration: '1.3s' }}
      />
      <span
        className="w-[5px] h-[5px] rounded-full bg-text-muted animate-bounce"
        style={{ animationDelay: '360ms', animationDuration: '1.3s' }}
      />
    </span>
  );
}
