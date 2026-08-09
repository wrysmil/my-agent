/**
 * Dashboard 任务卡片。
 *
 * 来源：spec § 4.6 .ai-runtime-artifacts/specs/2026-08-09-chat-composer-redesign-spec.md
 * 落地：plan § Step 3.1
 *
 * 设计要点（参考 Orkas 风格）：
 *   - 顶部：圆形渐变 icon 容器 + 任务标题
 *   - 中部：1-2 行描述
 *   - 底部：「交付物：xxx」tag + arrow
 *   - hover：边框 / 阴影变化 + 右下角箭头变深
 *   - 整卡可点 → 调用 onPick(task)
 *
 * 分类色：每类一个柔和底色（primary/8 / accent/8 / emerald/8 / violet/8）
 */

import { ArrowUpRight } from 'lucide-react';
import * as Icons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TaskSuggestion } from './taskSuggestions';

const CATEGORY_BG: Record<TaskSuggestion['category'], string> = {
  research: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  video: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
  image: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  design: 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
  office: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  writing: 'bg-pink-50 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400',
  development: 'bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-400',
  growth: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
};

const CATEGORY_GLOW: Record<TaskSuggestion['category'], string> = {
  research: 'hover:shadow-blue-100 dark:hover:shadow-blue-900/20',
  video: 'hover:shadow-rose-100 dark:hover:shadow-rose-900/20',
  image: 'hover:shadow-amber-100 dark:hover:shadow-amber-900/20',
  design: 'hover:shadow-purple-100 dark:hover:shadow-purple-900/20',
  office: 'hover:shadow-emerald-100 dark:hover:shadow-emerald-900/20',
  writing: 'hover:shadow-pink-100 dark:hover:shadow-pink-900/20',
  development: 'hover:shadow-slate-100 dark:hover:shadow-slate-900/20',
  growth: 'hover:shadow-violet-100 dark:hover:shadow-violet-900/20',
};

export function TaskSuggestionCard({
  task,
  onPick,
}: {
  task: TaskSuggestion;
  onPick: (task: TaskSuggestion) => void;
}) {
  const { t } = useTranslation();
  const Icon = Icons[task.iconName] as LucideIcon | undefined;
  const title = t(task.titleKey as any);
  const description = t(task.descriptionKey as any);
  const deliverable = t(task.deliverableKey as any);

  return (
    <button
      type="button"
      onClick={() => onPick(task)}
      data-testid={`task-card-${task.id}`}
      className={`task-card group relative flex flex-col items-start text-left rounded-2xl border border-border/80 bg-surface p-5 transition-all duration-200 hover:border-primary/30 hover:shadow-lg hover:-translate-y-1 ${CATEGORY_GLOW[task.category]} focus:outline-none focus:ring-2 focus:ring-primary/30`}
    >
      {/* Header: icon + title */}
      <div className="flex items-center gap-3 mb-2.5 w-full">
        <span
          className={`flex items-center justify-center w-9 h-9 rounded-xl shrink-0 ${CATEGORY_BG[task.category]}`}
        >
          {Icon ? <Icon className="w-[18px] h-[18px]" /> : null}
        </span>
        <span className="text-sm font-semibold text-text truncate flex-1">{title}</span>
      </div>

      {/* Description */}
      <p className="text-xs text-text-muted/80 line-clamp-2 mb-4 leading-relaxed min-h-[2lh]">
        {description}
      </p>

      {/* Footer: deliverable tag + arrow */}
      <div className="flex items-center justify-between w-full mt-auto">
        <span className="inline-flex items-center text-[10px] uppercase tracking-wider text-text-muted/50 font-semibold">
          {deliverable}
        </span>
        <ArrowUpRight className="w-4 h-4 text-text-muted/30 group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200" />
      </div>
    </button>
  );
}