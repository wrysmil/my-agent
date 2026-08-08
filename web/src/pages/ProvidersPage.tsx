import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ProviderForm, useProviders } from '@/features/providers';
import { queryKeys } from '@/lib/query-keys';

export function ProvidersPage() {
  const { data, isLoading, error } = useProviders();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const providers = data?.providers ?? [];
  const activeId = data?.activeId;

  function handleSuccess() {
    setShowForm(false);
  }

  function handleSetActive(providerId: string) {
    queryClient.setQueryData(queryKeys.providers.all, (old: any) => {
      if (!old) return old;
      return { ...old, activeId: providerId };
    });
  }

  if (isLoading) {
    return (
      <div data-testid="page-providers" className="p-6">
        <p className="text-muted">加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="page-providers" className="p-6">
        <p className="text-danger">加载失败，请稍后重试</p>
      </div>
    );
  }

  return (
    <div data-testid="page-providers" className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">模型供应商</h2>
        <button
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:opacity-90"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? '取消' : '添加供应商'}
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <ProviderForm mode="create" onSuccess={handleSuccess} />
        </div>
      )}

      {providers.length === 0 ? (
        <p className="text-muted">暂无供应商配置</p>
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
                <div>
                  <span className="font-medium">{provider.id}</span>
                  <span className="ml-2 text-sm text-muted">
                    {provider.type}
                  </span>
                </div>
                <button
                  className="text-sm text-primary hover:underline"
                  onClick={() => handleSetActive(provider.id)}
                >
                  {provider.id === activeId ? '当前激活' : '设为激活'}
                </button>
              </div>
              {provider.baseUrl && (
                <p className="mt-1 text-sm text-muted">{provider.baseUrl}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
