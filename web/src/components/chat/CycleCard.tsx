/**
 * CycleCard — 单次 assistant run 的视觉分组容器。
 *
 * 设计动机：见 spec `.ai-runtime-artifacts/specs/2026-08-11-message-cycle-grouping-spec.md` § 4.2。
 * 一次 send → 一次 assistant message 的语义边界保留不变，本组件仅做视觉绑定，
 * 把 trace + final markdown +（可选）生成指示器圈在同一张卡内。
 *
 * 视觉：
 *   - 浅色容器 + 圆角边框 + 轻阴影
 *   - 左侧 3px 主色渐变竖条（aria-hidden，纯装饰）
 *   - 不在 tab 流、不参与 a11y 标签
 *
 * 不引入依赖；不持有状态；不消费 context。
 */

import type { ReactNode } from 'react';

export interface CycleCardProps {
  children: ReactNode;
}

export function CycleCard({ children }: CycleCardProps) {
  return (
    <div className="relative mt-3 first:mt-0 rounded-xl border border-border/80 bg-surface shadow-sm">
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-gradient-to-b from-primary to-primary/50"
      />
      <div className="px-3.5 py-3 space-y-2">{children}</div>
    </div>
  );
}