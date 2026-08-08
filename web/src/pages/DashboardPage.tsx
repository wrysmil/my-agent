import { useNavigate } from 'react-router-dom';
import { useSessions, type SessionItem } from '@/features/sessions/useSessions';
import { useAgents } from '@/features/agents/useAgents';
import { useSkills } from '@/features/skills/useSkills';
import { useProviders } from '@/features/providers/useProviders';
import { Bot, Blocks, Plug, MessageSquare, ArrowRight, Loader2 } from 'lucide-react';

function StatCard({ icon: Icon, label, value, loading, color }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  loading: boolean;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 flex items-center gap-4">
      <div className={`rounded-lg p-2.5 ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        {loading ? (
          <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
        ) : (
          <p className="text-2xl font-bold text-text">{value}</p>
        )}
        <p className="text-xs text-text-muted">{label}</p>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();

  const { data: sessionsData, isLoading: sessionsLoading } = useSessions(false);
  const sessions: SessionItem[] = sessionsData?.sessions ?? [];
  const sessionCount = sessionsData?.total ?? sessions.length;

  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: skills, isLoading: skillsLoading } = useSkills();
  const { data: providersData, isLoading: providersLoading } = useProviders();
  const providerCount = providersData?.providers?.length ?? 0;

  const recentSessions = sessions.slice(0, 5);

  return (
    <div className="p-6 space-y-6" data-testid="page-dashboard">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-text">my-agent</h1>
        <p className="text-sm text-text-muted mt-1">AI 辅助开发代理管理平台</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={MessageSquare}
          label="会话总数"
          value={sessionCount}
          loading={sessionsLoading}
          color="bg-primary/10 text-primary"
        />
        <StatCard
          icon={Bot}
          label="可用 Agent"
          value={agents?.length ?? 0}
          loading={agentsLoading}
          color="bg-accent/10 text-accent-fg"
        />
        <StatCard
          icon={Blocks}
          label="可用 Skill"
          value={skills?.length ?? 0}
          loading={skillsLoading}
          color="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
        />
        <StatCard
          icon={Plug}
          label="供应商"
          value={providerCount}
          loading={providersLoading}
          color="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
        />
      </div>

      {/* Quick Actions + Recent Sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Actions */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold text-text mb-4">快捷操作</h3>
          <div className="space-y-2">
            <button
              onClick={() => navigate('/chat')}
              className="w-full flex items-center justify-between rounded-md border border-border bg-bg px-4 py-3 text-sm hover:bg-surface-hover transition-colors"
            >
              <div className="flex items-center gap-3">
                <MessageSquare className="w-4 h-4 text-primary" />
                <span>新建对话</span>
              </div>
              <ArrowRight className="w-4 h-4 text-text-muted" />
            </button>
            <button
              onClick={() => navigate('/providers')}
              className="w-full flex items-center justify-between rounded-md border border-border bg-bg px-4 py-3 text-sm hover:bg-surface-hover transition-colors"
            >
              <div className="flex items-center gap-3">
                <Plug className="w-4 h-4 text-primary" />
                <span>添加模型供应商</span>
              </div>
              <ArrowRight className="w-4 h-4 text-text-muted" />
            </button>
            <button
              onClick={() => navigate('/skills')}
              className="w-full flex items-center justify-between rounded-md border border-border bg-bg px-4 py-3 text-sm hover:bg-surface-hover transition-colors"
            >
              <div className="flex items-center gap-3">
                <Blocks className="w-4 h-4 text-primary" />
                <span>查看技能列表</span>
              </div>
              <ArrowRight className="w-4 h-4 text-text-muted" />
            </button>
            <button
              onClick={() => navigate('/agents')}
              className="w-full flex items-center justify-between rounded-md border border-border bg-bg px-4 py-3 text-sm hover:bg-surface-hover transition-colors"
            >
              <div className="flex items-center gap-3">
                <Bot className="w-4 h-4 text-primary" />
                <span>管理 Agent</span>
              </div>
              <ArrowRight className="w-4 h-4 text-text-muted" />
            </button>
          </div>
        </div>

        {/* Recent Sessions */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-text">最近会话</h3>
            <button
              onClick={() => navigate('/chat')}
              className="text-xs text-primary hover:underline"
            >
              新建
            </button>
          </div>
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
            </div>
          ) : recentSessions.length === 0 ? (
            <p className="text-sm text-text-muted py-4 text-center">
              暂无会话，点击「新建对话」开始
            </p>
          ) : (
            <ul className="space-y-1">
              {recentSessions.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => navigate(`/chat/${s.id}`)}
                    className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-surface-hover transition-colors flex items-center justify-between"
                  >
                    <span className="truncate">{s.name || s.id}</span>
                    <span className="text-xs text-text-muted shrink-0 ml-2">
                      {s.messageCount} 条消息
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
