import { useState } from 'react';
import { useAgents, type Agent } from '@/features/agents/useAgents';

function LoadingSkeleton() {
  return (
    <div className="space-y-3" data-testid="agents-loading">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-lg border border-border bg-surface p-4"
        >
          <div className="mb-2 h-5 w-1/3 rounded bg-border" />
          <div className="h-4 w-2/3 rounded bg-border" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-danger/30 bg-danger-bg p-8"
      data-testid="agents-error"
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
      data-testid="agents-empty"
    >
      <p className="text-sm text-text-muted">暂无 Agent</p>
    </div>
  );
}

function AgentListItem({ agent }: { agent: Agent }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="cursor-pointer rounded-lg border border-border bg-surface p-4 transition-shadow hover:shadow-md"
      onClick={() => setExpanded((v) => !v)}
      data-testid="agent-item"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-text">{agent.name}</h3>
          {agent.description && (
            <p className={`mt-1 text-sm text-text-muted ${expanded ? '' : 'line-clamp-1'}`}>
              {agent.description}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-fg">
          {agent.type}
        </span>
      </div>
      {expanded && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs text-text-muted">
            ID：{agent.id} / 类型：{agent.type}
            {agent.description && <> / 描述：{agent.description}</>}
          </p>
        </div>
      )}
    </div>
  );
}

export function AgentsPage() {
  const { data: agents, isLoading, isError, error, refetch } = useAgents();

  return (
    <div className="p-6" data-testid="page-agents">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text">Agent</h1>
          <p className="mt-1 text-sm text-text-muted">
            {agents ? `共 ${agents.length} 个 Agent` : '管理可用 Agent'}
          </p>
        </div>
      </div>

      {isLoading && <LoadingSkeleton />}
      {isError && (
        <ErrorState
          message={error instanceof Error ? error.message : '加载 Agent 列表失败'}
          onRetry={() => refetch()}
        />
      )}
      {!isLoading && !isError && agents && agents.length === 0 && <EmptyState />}
      {!isLoading && !isError && agents && agents.length > 0 && (
        <div className="space-y-3">
          {agents.map((agent) => (
            <AgentListItem key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
