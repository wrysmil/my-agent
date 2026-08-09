import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ProviderForm, useProviders, ProviderTestButton } from '@/features/providers';
import { queryKeys } from '@/lib/query-keys';
import { apiPut, apiPost, apiDelete } from '@/lib/api';
import { Pencil, Loader2, Server, Wifi, WifiOff, Star } from 'lucide-react';

const TYPE_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Gemini',
  moonshot: 'Moonshot',
  qwen: 'Qwen',
  mistral: 'Mistral',
  xai: 'Grok',
};

export function ProvidersPage() {
  const { data, isLoading, error, refetch } = useProviders();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activating, setActivating] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const providers = data?.providers ?? [];
  const activeId = data?.activeId;

  async function handleSetActive(providerId: string) {
    setActivating(providerId);
    try {
      await apiPut('/api/providers/active', { id: providerId });
      await refetch();
    } catch {
      // error shown via query state
    } finally {
      setActivating(null);
    }
  }

  async function handleToggle(providerId: string) {
    setToggling(providerId);
    try {
      await apiPost(`/api/providers/${providerId}/toggle`);
      await refetch();
    } catch {
      // error shown via query state
    } finally {
      setToggling(null);
    }
  }

  async function handleDelete(providerId: string) {
    if (!confirm(`确定删除供应商 "${providerId}"？`)) return;
    setDeleting(providerId);
    try {
      await apiDelete(`/api/providers/${providerId}`);
      await refetch();
    } catch {
      // error shown via query state
    } finally {
      setDeleting(null);
    }
  }

  function handleCreateSuccess() {
    setShowForm(false);
    refetch();
  }

  function handleEditSuccess() {
    setEditingId(null);
    refetch();
  }

  if (isLoading) {
    return (
      <div data-testid="page-providers" className="p-6 flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="page-providers" className="p-6">
        <div className="flex flex-col items-center justify-center rounded-lg border border-danger/30 bg-danger-bg p-8">
          <p className="mb-3 text-sm text-danger">加载失败，请稍后重试</p>
          <button onClick={() => refetch()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:opacity-90">
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="page-providers" className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">模型供应商</h2>
          <p className="text-sm text-text-muted mt-1">
            支持 DeepSeek · Anthropic · OpenAI · Gemini · Moonshot · Qwen · Mistral · Grok
          </p>
        </div>
        <button
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:opacity-90"
          onClick={() => { setShowForm(!showForm); setEditingId(null); }}
        >
          {showForm ? '取消' : '添加供应商'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <ProviderForm mode="create" onSuccess={handleCreateSuccess} />
        </div>
      )}

      {/* Edit form */}
      {editingId && (() => {
        const p = providers.find((x: any) => x.id === editingId);
        if (!p) return null;
        return (
          <div className="rounded-lg border border-accent bg-surface p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-text">编辑: {p.name || p.id}</h3>
              <button
                onClick={() => setEditingId(null)}
                className="text-xs text-text-muted hover:text-text"
              >
                取消
              </button>
            </div>
            <ProviderForm
              mode="edit"
              providerId={editingId}
              defaultValues={{
                id: p.id,
                name: p.name || p.id,
                type: p.type || 'deepseek',
                baseUrl: p.baseUrl || 'https://api.deepseek.com/v1',
                apiKey: '',
                defaultModel: p.defaultModel || 'deepseek-chat',
                enabled: p.enabled !== false,
              }}
              onSuccess={handleEditSuccess}
            />
          </div>
        );
      })()}

      {providers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12">
          <Server className="w-10 h-10 text-text-muted mb-3 opacity-40" />
          <p className="text-text-muted">暂无供应商配置</p>
          <p className="text-sm text-text-muted mt-1">
            点击「添加供应商」创建第一个
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {providers.map((provider: any) => {
            const typeLabel = TYPE_LABELS[provider.type] || provider.type;
            const isActive = provider.id === activeId;
            return (
            <li
              key={provider.id}
              className={`rounded-lg border-2 transition-colors ${
                isActive
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : provider.enabled
                    ? 'border-border bg-surface hover:border-accent'
                    : 'border-border bg-surface opacity-60'
              }`}
            >
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isActive && <Star className="w-4 h-4 text-primary flex-shrink-0" />}
                      <span className={`font-semibold ${isActive ? 'text-primary' : ''}`}>
                        {provider.name || provider.id}
                      </span>
                      <span className="text-xs rounded-full bg-accent px-2 py-0.5 text-accent-fg font-medium">
                        {typeLabel}
                      </span>
                      {provider.enabled ? (
                        <span className="flex items-center gap-1 text-xs text-success">
                          <Wifi className="w-3 h-3" /> 已启用
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-danger">
                          <WifiOff className="w-3 h-3" /> 已禁用
                        </span>
                      )}
                      {isActive && (
                        <span className="text-xs rounded-full bg-primary/15 px-2 py-0.5 text-primary font-medium">
                          当前使用
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
                      <span className="truncate max-w-[280px]" title={provider.baseUrl}>
                        {provider.baseUrl}
                      </span>
                      <span className="text-text-muted/50">·</span>
                      <span className="font-mono text-xs">{provider.defaultModel}</span>
                    </div>
                    <p className="text-xs text-text-muted/60 mt-1">
                      ID: {provider.id}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 ml-3 flex-shrink-0">
                    <ProviderTestButton providerId={provider.id} />
                    <button
                      className="text-xs text-text-muted hover:text-text px-2 py-1 rounded border border-border hover:bg-surface-hover flex items-center gap-1 transition-colors"
                      onClick={() => { setEditingId(editingId === provider.id ? null : provider.id); setShowForm(false); }}
                    >
                      <Pencil className="w-3 h-3" />
                      编辑
                    </button>
                    <button
                      className="text-xs text-text-muted hover:text-text px-2 py-1 rounded border border-border hover:bg-surface-hover transition-colors"
                      onClick={() => handleToggle(provider.id)}
                      disabled={toggling === provider.id}
                    >
                      {toggling === provider.id ? '...' : provider.enabled ? '禁用' : '启用'}
                    </button>
                    {!isActive && (
                      <button
                        className="text-xs text-primary hover:bg-primary/10 px-2 py-1 rounded font-medium transition-colors"
                        onClick={() => handleSetActive(provider.id)}
                        disabled={activating === provider.id}
                      >
                        {activating === provider.id ? '激活中...' : '设为激活'}
                      </button>
                    )}
                    <button
                      className="text-xs text-danger hover:bg-danger/10 px-2 py-1 rounded transition-colors"
                      onClick={() => handleDelete(provider.id)}
                      disabled={deleting === provider.id || isActive}
                    >
                      {deleting === provider.id ? '删除中...' : '删除'}
                    </button>
                  </div>
                </div>
              </div>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
