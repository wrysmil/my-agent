import { useState } from 'react';
import { useAgents, type Agent } from '@/features/agents/useAgents';
import { apiGet } from '@/lib/api';
import { X } from 'lucide-react';

type AgentDetail = Agent & { systemPrompt: string; description_zh: string; description_en: string };

function LoadingSkeleton() {
  return (
    <div className="space-y-3" data-testid="agents-loading">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-lg border border-border bg-surface p-4">
          <div className="mb-2 h-5 w-1/3 rounded bg-border" />
          <div className="h-4 w-2/3 rounded bg-border" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-danger/30 bg-danger-bg p-8" data-testid="agents-error">
      <p className="mb-3 text-sm text-danger">{message}</p>
      <button onClick={onRetry} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:opacity-90">
        重试
      </button>
    </div>
  );
}

function DetailPanel({ agent, onClose }: { agent: AgentDetail; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40" onClick={onClose}>
      <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[70vh] flex flex-col m-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">{agent.name}</h2>
            <p className="text-xs text-text-muted mt-0.5">
              ID: {agent.id} · 来源: {agent.source} · Scope: {agent.scope}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-hover">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">描述</h4>
            <p className="text-sm text-text-muted">
              {agent.description_zh || agent.description || '无描述'}
            </p>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">可用工具</h4>
            <div className="flex flex-wrap gap-1">
              {agent.tools.length > 0 ? agent.tools.map(t => (
                <span key={t} className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent-fg">{t}</span>
              )) : (
                <span className="text-xs text-text-muted">无</span>
              )}
            </div>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">System Prompt</h4>
            <pre className="text-sm whitespace-pre-wrap font-mono bg-bg rounded-md p-4 border border-border max-h-60 overflow-y-auto">
              {agent.systemPrompt || '（无）'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgentsPage() {
  const { data: agents, isLoading, isError, error, refetch } = useAgents();
  const [selected, setSelected] = useState<AgentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  async function openDetail(agent: Agent) {
    setLoadingDetail(true);
    try {
      const data = await apiGet<{ agent: AgentDetail }>(`/api/agents/${agent.id}`);
      setSelected(data.agent);
    } catch {
      // 404 — silently close
    } finally {
      setLoadingDetail(false);
    }
  }

  return (
    <div className="p-6" data-testid="page-agents">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-text">Agent</h1>
        <p className="mt-1 text-sm text-text-muted">
          {agents ? `共 ${agents.length} 个 Agent` : '管理可用 Agent'}
        </p>
      </div>

      {loadingDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {isLoading && <LoadingSkeleton />}
      {isError && (
        <ErrorState
          message={error instanceof Error ? error.message : '加载 Agent 列表失败'}
          onRetry={() => refetch()}
        />
      )}
      {!isLoading && !isError && agents && agents.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12" data-testid="agents-empty">
          <p className="text-sm text-text-muted">暂无 Agent</p>
        </div>
      )}
      {!isLoading && !isError && agents && agents.length > 0 && (
        <div className="space-y-3">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="cursor-pointer rounded-lg border border-border bg-surface p-4 transition-shadow hover:shadow-md"
              onClick={() => openDetail(agent)}
              data-testid="agent-item"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-text">{agent.name}</h3>
                    <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-fg">
                      {agent.scope === 'both' ? 'builtin+user' : agent.source}
                    </span>
                    {!agent.enabled && (
                      <span className="text-xs text-danger">已禁用</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-text-muted line-clamp-1">
                    {agent.description || '无描述'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1 shrink-0">
                  {agent.tools.slice(0, 3).map(t => (
                    <span key={t} className="rounded bg-surface-hover px-1.5 py-0.5 text-xs text-text-muted">{t}</span>
                  ))}
                  {agent.tools.length > 3 && (
                    <span className="text-xs text-text-muted">+{agent.tools.length - 3}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <DetailPanel agent={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
