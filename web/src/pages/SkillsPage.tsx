import { useState } from 'react';
import { useSkills, type Skill } from '@/features/skills/useSkills';

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="skills-loading">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-lg border border-border bg-surface p-5"
        >
          <div className="mb-3 h-5 w-2/3 rounded bg-border" />
          <div className="h-4 w-full rounded bg-border" />
          <div className="mt-2 h-4 w-4/5 rounded bg-border" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-danger/30 bg-danger-bg p-8"
      data-testid="skills-error"
    >
      <p className="mb-3 text-sm text-danger">{message}</p>
      <button
        onClick={onRetry}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:opacity-90"
      >
        重试
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12"
      data-testid="skills-empty"
    >
      <p className="text-sm text-text-muted">暂无技能</p>
    </div>
  );
}

function SkillCard({ skill }: { skill: Skill }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="cursor-pointer rounded-lg border border-border bg-surface p-5 transition-shadow hover:shadow-md"
      onClick={() => setExpanded((v) => !v)}
      data-testid="skill-card"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-text">{skill.name}</h3>
        {skill.category && (
          <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-fg">
            {skill.category}
          </span>
        )}
      </div>
      <p className={`mt-2 text-sm text-text-muted ${expanded ? '' : 'line-clamp-2'}`}>
        {skill.description}
      </p>
      {expanded && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs text-text-muted">
            名称：{skill.name}
            {skill.category && <> / 分类：{skill.category}</>}
          </p>
        </div>
      )}
    </div>
  );
}

export function SkillsPage() {
  const { data: skills, isLoading, isError, error, refetch } = useSkills();

  return (
    <div className="p-6" data-testid="page-skills">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text">技能</h1>
          <p className="mt-1 text-sm text-text-muted">
            {skills ? `共 ${skills.length} 个技能` : '管理可用技能'}
          </p>
        </div>
      </div>

      {isLoading && <LoadingSkeleton />}
      {isError && (
        <ErrorState
          message={error instanceof Error ? error.message : '加载技能列表失败'}
          onRetry={() => refetch()}
        />
      )}
      {!isLoading && !isError && skills && skills.length === 0 && <EmptyState />}
      {!isLoading && !isError && skills && skills.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((skill) => (
            <SkillCard key={skill.name} skill={skill} />
          ))}
        </div>
      )}
    </div>
  );
}
