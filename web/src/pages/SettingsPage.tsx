import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUiStore } from '@/features/ui/useUiStore';
import { useTranslation } from '@/i18n/useTranslation';
import { apiGet, apiPut } from '@/lib/api';
import { logger } from '@/lib/logger';
import { Sun, Moon, Languages, Monitor, Cpu, Info, Zap, Brain } from 'lucide-react';

function SettingGroup({ title, icon: Icon, children }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-text-muted" />
        <h3 className="text-sm font-semibold text-text">{title}</h3>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-text">{label}</p>
        {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${checked ? 'bg-primary' : 'bg-border'}`}
        role="switch"
        aria-checked={checked}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

function SelectRow({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-text">{label}</p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs text-text focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function NumberInput({ label, value, min, max, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-text">{label}</p>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 rounded-md border border-border bg-bg px-2 py-1 text-xs text-text text-right"
      />
    </div>
  );
}

export function SettingsPage() {
  const { theme, toggleTheme, locale, setLocale } = useUiStore();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Fetch active provider info
  const { data: activeProvider } = useQuery({
    queryKey: ['settings-active-provider'],
    queryFn: () => apiGet<any>('/api/providers/active').catch(() => null),
    staleTime: 30_000,
  });

  // Fetch config for Agent/Memory sections
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn: () => apiGet<any>('/api/config').catch(() => null),
    staleTime: 30_000,
  });

  // Fetch available models from API
  const { data: modelsData } = useQuery({
    queryKey: ['settings-models'],
    queryFn: () => apiGet<{ models: Array<{ id: string; model: string; provider: string }> }>('/api/models').catch(() => ({ models: [] })),
    staleTime: 60_000,
  });
  const apiModels = (modelsData?.models ?? []).map((m) => ({
    value: m.id,
    label: `${m.model} (${m.provider})`,
  }));
  // 兜底：如果 API 返回空，至少保留当前值可选
  const modelOptions = apiModels.length > 0
    ? apiModels
    : (config?.agent?.defaultModel
        ? [{ value: config.agent.defaultModel, label: config.agent.defaultModel }]
        : []);

  // Update config mutation
  const updateConfig = useMutation({
    mutationFn: (partial: Record<string, unknown>) => apiPut('/api/config', partial),
    onSuccess: (_data, variables) => {
      logger.debug("⚙️ 配置已更新", variables);
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });

  return (
    <div className="p-6 space-y-6" data-testid="page-settings">
      <div>
        <h1 className="text-xl font-bold text-text">{t('settings.title')}</h1>
        <p className="text-sm text-text-muted mt-1">管理应用偏好和配置</p>
      </div>

      {/* Appearance */}
      <SettingGroup title="外观" icon={Monitor}>
        <ToggleRow
          label="深色模式"
          description="切换浅色/深色主题"
          checked={theme === 'dark'}
          onChange={() => toggleTheme()}
        />
        <SelectRow
          label={t('settings.language')}
          value={locale}
          options={[
            { value: 'zh', label: '中文' },
            { value: 'en', label: 'English' },
          ]}
          onChange={(v) => setLocale(v as 'zh' | 'en')}
        />
      </SettingGroup>

      {/* Agent Config (from config API) */}
      {config?.agent && (
        <SettingGroup title="Agent 配置" icon={Zap}>
          <SelectRow
            label="默认模型"
            value={config.agent.defaultModel || ''}
            options={modelOptions}
            onChange={(v) => updateConfig.mutate({ agent: { defaultModel: v } })}
          />
          <SelectRow
            label="思考级别"
            value={config.agent.thinkingLevel || 'medium'}
            options={[
              { value: 'off', label: '关闭' },
              { value: 'low', label: '低' },
              { value: 'medium', label: '中' },
              { value: 'high', label: '高' },
            ]}
            onChange={(v) => updateConfig.mutate({ agent: { thinkingLevel: v } })}
          />
          <NumberInput
            label="最大重试次数"
            value={config.agent.maxRetries ?? 3}
            min={0}
            max={10}
            onChange={(v) => updateConfig.mutate({ agent: { maxRetries: v } })}
          />
          <NumberInput
            label="最大工具循环"
            value={config.agent.maxToolLoops ?? 100}
            min={1}
            max={500}
            onChange={(v) => updateConfig.mutate({ agent: { maxToolLoops: v } })}
          />
        </SettingGroup>
      )}

      {/* Memory Config (from config API) */}
      {config?.memory && (
        <SettingGroup title="记忆配置" icon={Brain}>
          <ToggleRow
            label="启用记忆"
            description="开启后 Agent 会记录上下文信息"
            checked={config.memory.enabled !== false}
            onChange={(v) => updateConfig.mutate({ memory: { enabled: v } })}
          />
          <NumberInput
            label="最大检索数"
            value={config.memory.maxResults ?? 10}
            min={1}
            max={50}
            onChange={(v) => updateConfig.mutate({ memory: { maxResults: v } })}
          />
        </SettingGroup>
      )}

      {/* Model Provider */}
      <SettingGroup title="模型供应商" icon={Cpu}>
        {activeProvider ? (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">当前供应商</span>
              <span className="text-text font-medium">{activeProvider.name || activeProvider.id}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">类型</span>
              <span className="text-text">{activeProvider.type}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">默认模型</span>
              <span className="text-text">{activeProvider.defaultModel}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">状态</span>
              <span className={activeProvider.enabled !== false ? 'text-emerald-600' : 'text-danger'}>
                {activeProvider.enabled !== false ? '已启用' : '已禁用'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">API 地址</span>
              <span className="text-xs text-text-muted font-mono truncate max-w-[200px]">{activeProvider.baseUrl}</span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-text-muted py-2">
            未配置供应商 —
            <a href="#/providers" className="text-primary hover:underline ml-1">前往配置</a>
          </div>
        )}
      </SettingGroup>

      {/* About */}
      <SettingGroup title="关于" icon={Info}>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">应用</span>
            <span className="text-text font-medium">my-agent</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">版本</span>
            <span className="text-text">1.0.0</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">前端框架</span>
            <span className="text-text">React 19 + Vite 6 + Tailwind v4</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">状态管理</span>
            <span className="text-text">TanStack Query v5 + Zustand 5</span>
          </div>
        </div>
      </SettingGroup>
    </div>
  );
}
