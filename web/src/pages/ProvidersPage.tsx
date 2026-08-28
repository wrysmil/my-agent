import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ProviderForm, useProviders, ProviderTestButton } from '@/features/providers';
import { queryKeys } from '@/lib/query-keys';
import { apiPut, apiPost, apiDelete } from '@/lib/api';
import {
  Pencil,
  Loader2,
  Server,
  Wifi,
  WifiOff,
  Star,
  Plus,
  Sparkles,
  Trash2,
  Power,
  Check,
  Box,
} from 'lucide-react';

interface ProviderTypeMeta {
  id: string;
  label: string;
  short: string;
  baseUrl: string;
  defaultModel: string;
  /** 渐变色（卡片背景） */
  gradient: string;
  /** logo 颜色 */
  logoBg: string;
  /** logo 字符（厂商首字） */
  logoText: string;
}

const PROVIDER_META: ProviderTypeMeta[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    short: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    gradient: 'from-blue-500 to-cyan-400',
    logoBg: 'bg-blue-500',
    logoText: 'DS',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    short: 'Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5',
    gradient: 'from-orange-500 to-amber-400',
    logoBg: 'bg-orange-500',
    logoText: 'A',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    short: 'GPT',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    gradient: 'from-emerald-500 to-teal-400',
    logoBg: 'bg-emerald-500',
    logoText: 'O',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    short: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    gradient: 'from-sky-500 to-blue-400',
    logoBg: 'bg-sky-500',
    logoText: 'G',
  },
  {
    id: 'moonshot',
    label: 'Moonshot',
    short: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    gradient: 'from-purple-500 to-pink-400',
    logoBg: 'bg-purple-500',
    logoText: 'M',
  },
  {
    id: 'qwen',
    label: 'Qwen 通义千问',
    short: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-max',
    gradient: 'from-rose-500 to-orange-400',
    logoBg: 'bg-rose-500',
    logoText: 'Q',
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    short: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    gradient: 'from-amber-500 to-yellow-400',
    logoBg: 'bg-amber-500',
    logoText: 'Mi',
  },
  {
    id: 'xai',
    label: 'Grok (xAI)',
    short: 'Grok',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-2',
    gradient: 'from-slate-700 to-slate-500',
    logoBg: 'bg-slate-700',
    logoText: 'X',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    short: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    defaultModel: 'MiniMax-Text-01',
    gradient: 'from-pink-500 to-rose-400',
    logoBg: 'bg-pink-500',
    logoText: 'MM',
  },
];

const TYPE_LABEL_MAP = Object.fromEntries(
  PROVIDER_META.map((m) => [m.id, m.label])
);

/** 已有 provider 是否使用过该 type */
function findByType<T extends { type: string }>(items: T[], type: string): T | undefined {
  return items.find((p) => p.type === type);
}

export function ProvidersPage() {
  const { data, isLoading, error, refetch } = useProviders();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [createType, setCreateType] = useState<string>('deepseek');
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
      // Invalidate ChatPage's active-provider cache so it refreshes immediately
      queryClient.invalidateQueries({ queryKey: ['active-provider'] });
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

  function startCreate(type: string) {
    setCreateType(type);
    setShowForm(true);
    setEditingId(null);
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
      <div data-testid="page-providers" className="h-full overflow-y-auto p-6 flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="page-providers" className="h-full overflow-y-auto p-6">
        <div className="flex flex-col items-center justify-center rounded-lg border border-danger/30 bg-danger-bg p-8">
          <p className="mb-3 text-sm text-danger">加载失败，请稍后重试</p>
          <button
            onClick={() => refetch()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:opacity-90"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="page-providers" className="h-full overflow-y-auto p-6 space-y-8 max-w-6xl mx-auto">
      {/* ====== Hero Header ====== */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center shadow-lg shadow-primary/20">
            <Box className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">模型供应商</h2>
            <p className="text-sm text-text-muted mt-1">
              已配置 <span className="font-semibold text-text">{providers.length}</span> 个供应商 · 支持 8 种主流厂商一键接入
            </p>
          </div>
        </div>
      </div>

      {/* ====== Provider Catalog Grid ====== */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">
            添加供应商
          </h3>
          <div className="flex-1 h-px bg-border ml-2" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {PROVIDER_META.map((meta) => {
            const existing = findByType(providers, meta.id);
            return (
              <button
                key={meta.id}
                type="button"
                onClick={() => startCreate(meta.id)}
                className="group relative overflow-hidden rounded-xl border border-border bg-surface p-4 text-left transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {/* 背景渐变（hover 时显出） */}
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${meta.gradient} opacity-0 group-hover:opacity-[0.08] transition-opacity duration-300`}
                />

                <div className="relative flex items-start gap-3">
                  {/* Logo */}
                  <div
                    className={`w-10 h-10 rounded-lg bg-gradient-to-br ${meta.gradient} flex items-center justify-center text-white font-bold text-sm shadow-sm flex-shrink-0`}
                  >
                    {meta.logoText}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <h4 className="font-semibold text-sm truncate">
                        {meta.short}
                      </h4>
                      {existing ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/15 text-success font-medium flex items-center gap-0.5">
                          <Check className="w-2.5 h-2.5" />已配置
                        </span>
                      ) : (
                        <Plus className="w-3.5 h-3.5 text-text-muted group-hover:text-primary transition-colors" />
                      )}
                    </div>
                    <p className="text-xs text-text-muted truncate mt-0.5">
                      {meta.defaultModel}
                    </p>
                  </div>
                </div>

                {/* 全名标签 */}
                <p className="relative text-[10px] text-text-muted mt-3 truncate">
                  {meta.label}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* ====== Create Form (Drawer-like) ====== */}
      {showForm && (
        <section className="rounded-xl border-2 border-primary/30 bg-surface shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-primary/5 to-transparent border-b border-border">
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">
                添加
                <span
                  className={`ml-2 px-2 py-0.5 rounded-full text-xs bg-gradient-to-r ${
                    PROVIDER_META.find((m) => m.id === createType)?.gradient
                  } text-white`}
                >
                  {TYPE_LABEL_MAP[createType]}
                </span>
                供应商
              </h3>
            </div>
            <button
              onClick={() => setShowForm(false)}
              className="text-xs text-text-muted hover:text-text px-2 py-1 rounded transition-colors"
            >
              取消
            </button>
          </div>
          <div className="p-5">
            <ProviderForm
              mode="create"
              initialType={createType}
              onSuccess={handleCreateSuccess}
            />
          </div>
        </section>
      )}

      {/* ====== Edit Form ====== */}
      {editingId && (() => {
        const p = providers.find((x: any) => x.id === editingId);
        if (!p) return null;
        const meta = PROVIDER_META.find((m) => m.id === p.type);
        return (
          <section className="rounded-xl border-2 border-accent bg-surface shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-accent to-transparent border-b border-border">
              <div className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-accent-fg" />
                <h3 className="font-semibold">
                  编辑：
                  <span
                    className={`ml-2 px-2 py-0.5 rounded-full text-xs bg-gradient-to-r ${
                      meta?.gradient ?? 'from-gray-500 to-gray-400'
                    } text-white`}
                  >
                    {TYPE_LABEL_MAP[p.type] || p.type}
                  </span>
                  <span className="ml-2 text-text-muted font-normal text-sm">
                    {p.name || p.id}
                  </span>
                </h3>
              </div>
              <button
                onClick={() => setEditingId(null)}
                className="text-xs text-text-muted hover:text-text px-2 py-1 rounded transition-colors"
              >
                取消
              </button>
            </div>
            <div className="p-5">
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
          </section>
        );
      })()}

      {/* ====== Configured Providers List ====== */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Server className="w-4 h-4 text-text-muted" />
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">
            已配置供应商
          </h3>
          <div className="flex-1 h-px bg-border ml-2" />
          <span className="text-xs text-text-muted">{providers.length} 个</span>
        </div>

        {providers.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-surface/50 p-12">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center mb-4">
              <Server className="w-8 h-8 text-primary" />
            </div>
            <p className="text-base font-medium">暂无供应商配置</p>
            <p className="text-sm text-text-muted mt-1">
              从上方厂商卡片中任选一个，点击即可快速添加
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {providers.map((provider: any) => {
              const meta = PROVIDER_META.find((m) => m.id === provider.type);
              const isActive = provider.id === activeId;
              return (
                <li
                  key={provider.id}
                  className={`group relative overflow-hidden rounded-xl border-2 transition-all duration-200 ${
                    isActive
                      ? 'border-primary bg-gradient-to-r from-primary/5 to-transparent shadow-md'
                      : provider.enabled
                        ? 'border-border bg-surface hover:border-accent hover:shadow-sm'
                        : 'border-border bg-surface opacity-60'
                  }`}
                >
                  {/* 左侧彩色装饰条（active 或 hover） */}
                  <div
                    className={`absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b ${
                      meta?.gradient ?? 'from-gray-400 to-gray-300'
                    } ${isActive ? 'opacity-100' : 'opacity-40 group-hover:opacity-80'} transition-opacity`}
                  />

                  <div className="flex items-center gap-4 p-4 pl-5">
                    {/* Logo */}
                    <div
                      className={`w-11 h-11 rounded-lg bg-gradient-to-br ${
                        meta?.gradient ?? 'from-gray-400 to-gray-300'
                      } flex items-center justify-center text-white font-bold shadow-sm flex-shrink-0`}
                    >
                      {meta?.logoText ?? provider.type.slice(0, 2).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isActive && (
                          <Star className="w-4 h-4 text-primary fill-primary flex-shrink-0" />
                        )}
                        <span
                          className={`font-semibold ${isActive ? 'text-primary' : ''}`}
                        >
                          {provider.name || provider.id}
                        </span>
                        <span
                          className={`text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 font-medium bg-gradient-to-r ${
                            meta?.gradient ?? 'from-gray-400 to-gray-300'
                          } text-white`}
                        >
                          {TYPE_LABEL_MAP[provider.type] || provider.type}
                        </span>
                        {provider.enabled ? (
                          <span className="inline-flex items-center gap-1 text-xs text-success">
                            <Wifi className="w-3 h-3" />已启用
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                            <WifiOff className="w-3 h-3" />已禁用
                          </span>
                        )}
                        {isActive && (
                          <span className="text-xs rounded-full bg-primary/15 px-2 py-0.5 text-primary font-medium">
                            当前使用
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 mt-1.5 text-xs text-text-muted">
                        <span
                          className="truncate max-w-[260px]"
                          title={provider.baseUrl}
                        >
                          {provider.baseUrl}
                        </span>
                        <span className="text-text-muted/40">·</span>
                        <span className="font-mono">{provider.defaultModel}</span>
                        <span className="text-text-muted/40">·</span>
                        <span>ID: {provider.id}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <ProviderTestButton providerId={provider.id} />
                      <button
                        title="编辑"
                        className="p-1.5 text-text-muted hover:text-text rounded-md border border-transparent hover:border-border hover:bg-surface-hover transition-all"
                        onClick={() => {
                          setEditingId(editingId === provider.id ? null : provider.id);
                          setShowForm(false);
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        title={provider.enabled ? '禁用' : '启用'}
                        className="p-1.5 text-text-muted hover:text-text rounded-md border border-transparent hover:border-border hover:bg-surface-hover transition-all disabled:opacity-50"
                        onClick={() => handleToggle(provider.id)}
                        disabled={toggling === provider.id}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </button>
                      {!isActive && (
                        <button
                          className="text-xs font-medium text-primary hover:bg-primary/10 px-2.5 py-1.5 rounded-md transition-colors"
                          onClick={() => handleSetActive(provider.id)}
                          disabled={activating === provider.id}
                        >
                          {activating === provider.id ? '激活中...' : '设为激活'}
                        </button>
                      )}
                      <button
                        title="删除"
                        className="p-1.5 text-danger hover:bg-danger/10 rounded-md transition-colors disabled:opacity-50"
                        onClick={() => handleDelete(provider.id)}
                        disabled={deleting === provider.id || isActive}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}