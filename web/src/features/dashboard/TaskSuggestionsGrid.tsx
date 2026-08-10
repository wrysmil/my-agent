/**
 * Dashboard 任务卡片栅格（4 列）。
 *
 * 来源：spec § 4.4 .ai-runtime-artifacts/specs/2026-08-09-chat-composer-redesign-spec.md
 * 落地：plan § Step 3.1
 *
 * 容器：max-w 1200，居中，4 列自适应（<sm 2 列、<lg 3 列）。
 * 子：TaskSuggestionCard。
 *
 * 数据流：通过 useTaskSuggestions hook 拿到 { suggestions, source }；
 * source=fallback 时附底部小字「离线推荐」（让用户知道可能不是最新）。
 */

import { TaskSuggestionCard } from './TaskSuggestionCard';
import { useTaskSuggestions } from './useTaskSuggestions';
import { useTranslation } from '@/i18n/useTranslation';
import type { TaskSuggestion } from './taskSuggestions';

export function TaskSuggestionsGrid({
  onPick,
}: {
  onPick: (task: TaskSuggestion) => void;
}) {
  const { t } = useTranslation();
  const { suggestions, source } = useTaskSuggestions();

  return (
    <section
      aria-label="任务建议"
      data-testid="dashboard-tasks-grid"
      className="w-full"
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {suggestions.map((task) => (
          <TaskSuggestionCard key={task.id} task={task} onPick={onPick} />
        ))}
      </div>
      {source === 'fallback' && (
        <p
          className="mt-2 text-[10px] text-text-muted/60 text-right"
          data-testid="dashboard-tasks-grid-fallback"
        >
          {t('dashboard.tasks.fallback_hint')}
        </p>
      )}
    </section>
  );
}