/**
 * GeneratingIndicator — final markdown 之后的小转圈。
 *
 * 设计动机：见 spec `.ai-runtime-artifacts/specs/2026-08-11-message-cycle-grouping-spec.md` § 4.2。
 * 替代旧的 `ThinkingDots`（trace 出现后其占位无意义）。
 * 仅保留转圈，文字提示已移除（用户反馈：文字"AI 仍在生成中…"多余）。
 *
 * 调用方约定：仅当 `isStreaming && !hasFinalText` 时渲染；其它场景不挂载，
 * 避免重复显示已完成 run 的「还在生成」。
 */

import { Loader2 } from 'lucide-react';

export function GeneratingIndicator() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center mt-2 pt-2 border-t border-dashed border-border/70"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
    </div>
  );
}