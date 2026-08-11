/**
 * TraceBubble — 一次 assistant run 的「trace 步骤」独立灰色气泡。
 *
 * 设计动机：见 spec `.ai-runtime-artifacts/specs/2026-08-11-run-trace-dual-layout-spec.md` § 4.2。
 * v4 结构调整：trace 与 final 不再共享同一气泡。
 *   - TraceBubble 仅包 trace 步骤（RunTracePanel 内部自绘紫色侧条与边框）
 *   - final markdown 是 MessageBubble 中的独立裸内容节点（左缘对齐，不嵌套）
 *
 * 视觉（v4）：
 *   - 灰色背景 `#f1f2f4`，与 chat 列表背景形成工具感区分
 *   - max-width 660px（v3.1 560px → v4 放宽 100px 以容纳更宽 trace）
 *   - p-0：内部 RunTracePanel 自带 padding（px-3.5 py-2.5）
 *   - self-start：assistant 消息内多节点时左对齐
 *
 * 不引入依赖；不持有状态；不消费 context。
 */

import type { ReactNode } from 'react';

export interface TraceBubbleProps {
  children: ReactNode;
}

export function TraceBubble({ children }: TraceBubbleProps) {
  return (
    <div
      data-testid="trace-bubble"
      className="relative w-full max-w-[660px] self-start rounded-xl bg-[#f1f2f4]"
    >
      {children}
    </div>
  );
}
