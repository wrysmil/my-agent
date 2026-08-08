import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ProviderForm, useProviders, ProviderTestButton } from '@/features/providers';
import { queryKeys } from '@/lib/query-keys';
import { apiPut, apiPost, apiDelete } from '@/lib/api';
import { Pencil, Loader2 } from 'lucide-react';

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
            当前仅支持 DeepSeek 类型
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
          <p className="text-text-muted">暂无供应商配置</p>
          <p className="text-sm text-text-muted mt-1">
            点击「添加供应商」创建第一个
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {providers.map((provider: any) => (
            <li
              key={provider.id}
              className={`rounded-lg border p-4 ${
                provider.id === activeId
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-surface'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{provider.name || provider.id}</span>
                    <span className="text-xs rounded-full bg-accent px-2 py-0.5 text-accent-fg">
                      {provider.type}
                    </span>
                    {!provider.enabled && (
                      <span className="text-xs rounded-full bg-danger/20 px-2 py-0.5 text-danger">
                        已禁用
                      </span>
                    )}
                    {provider.id === activeId && (
                      <span className="text-xs rounded-full bg-primary/20 px-2 py-0.5 text-primary">
                        激活中
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted mt-1 truncate">
                    {provider.baseUrl} · {provider.defaultModel}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    ID: {provider.id}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {/* Test connectivity button */}
                  <ProviderTestButton providerId={provider.id} />
                  {/* Edit button */}
                  <button
                    className="text-xs text-text-muted hover:text-text px-2 py-1 rounded border border-border hover:bg-surface-hover flex items-center gap-1"
                    onClick={() => { setEditingId(editingId === provider.id ? null : provider.id); setShowForm(false); }}
                  >
                    <Pencil className="w-3 h-3" />
                    编辑
                  </button>
                  <button
                    className="text-xs text-text-muted hover:text-text px-2 py-1 rounded border border-border hover:bg-surface-hover"
                    onClick={() => handleToggle(provider.id)}
                    disabled={toggling === provider.id}
                  >
                    {toggling === provider.id ? '...' : provider.enabled ? '禁用' : '启用'}
                  </button>
                  {provider.id !== activeId && (
                    <button
                      className="text-xs text-primary hover:underline px-2 py-1"
                      onClick={() => handleSetActive(provider.id)}
                      disabled={activating === provider.id}
                    >
                      {activating === provider.id ? '激活中...' : '设为激活'}
                    </button>
                  )}
                  {provider.id === activeId && (
                    <span className="text-xs text-text-muted px-2 py-1">
                      当前激活
                    </span>
                  )}
                  <button
                    className="text-xs text-danger hover:underline px-2 py-1"
                    onClick={() => handleDelete(provider.id)}
                    disabled={deleting === provider.id || provider.id === activeId}
                  >
                    {deleting === provider.id ? '删除中...' : '删除'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
