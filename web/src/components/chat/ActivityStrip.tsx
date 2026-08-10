import { useEffect, useState } from 'react';

/**
 * ActivityStrip — 流式活动状态条。
 *
 * 参考 Orkas 的 .stream-activity：显示当前动作 + 工具计数 + 运行计时。
 * 始终可见，即使没有文本增量时也让用户知道 AI 仍在工作。
 */
export function ActivityStrip({
  streamState,
  activeToolCount = 0,
  streamStartTime,
}: {
  streamState?: string;
  activeToolCount?: number;
  streamStartTime?: number;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!streamStartTime) return;
    const tick = () => {
      setElapsed(Date.now() - streamStartTime);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [streamStartTime]);

  const stateLabel = streamState === 'thinking'
    ? '思考中'
    : streamState === 'tool_executing'
    ? '执行工具中'
    : streamState === 'generating'
    ? '生成回复中'
    : '工作中';

  const mm = Math.floor(elapsed / 60000);
  const ss = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
  const timeStr = `${mm}:${ss}`;

  const parts: string[] = [];
  if (activeToolCount > 0) parts.push(`${activeToolCount} 个工具`);
  parts.push(timeStr);

  return (
    <div className="flex items-center gap-2 text-xs text-text-muted/60 py-0.5">
      <span className="w-[7px] h-[7px] rounded-full bg-primary shrink-0 animate-pulse" />
      <span className="truncate">{stateLabel}</span>
      <span className="shrink-0 tabular-nums text-text-muted/40">{parts.join(' · ')}</span>
    </div>
  );
}
