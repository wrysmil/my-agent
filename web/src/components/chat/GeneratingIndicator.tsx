/**
 * GeneratingIndicator — final markdown 之后的「AI 仍在生成中」提示。
 *
 * 设计动机：见 spec `.ai-runtime-artifacts/specs/2026-08-11-message-cycle-grouping-spec.md` § 4.2。
 * 替代旧的 `ThinkingDots`（trace 出现后其占位无意义），
 * 转圈与提示文本统一放到 final 之后，表达「下面还有内容在生成」。
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
      className="flex items-center gap-2 mt-2 pt-2 border-t border-dashed border-border/70 text-[12px] text-text-muted"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
      <span>AI 仍在生成中…</span>
    </div>
  );
}