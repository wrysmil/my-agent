import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, apiPut, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';

const PROVIDER_TYPES = ['deepseek', 'anthropic', 'openai', 'google', 'moonshot', 'qwen', 'mistral', 'xai', 'minimax'] as const;

const TYPE_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google Gemini',
  moonshot: 'Moonshot (月之暗面)',
  qwen: 'Qwen (通义千问)',
  mistral: 'Mistral AI',
  xai: 'Grok (xAI)',
  minimax: 'MiniMax',
};

const TYPE_DEFAULTS: Record<string, { baseUrl: string; defaultModel: string; apiKeyEnv: string }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', apiKeyEnv: 'DEEPSEEK_API_KEY' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-5', apiKeyEnv: 'ANTHROPIC_API_KEY' },
  openai: { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o', apiKeyEnv: 'OPENAI_API_KEY' },
  google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.5-flash', apiKeyEnv: 'GOOGLE_API_KEY' },
  moonshot: { baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', apiKeyEnv: 'MOONSHOT_API_KEY' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-max', apiKeyEnv: 'QWEN_API_KEY' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-large-latest', apiKeyEnv: 'MISTRAL_API_KEY' },
  xai: { baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-2', apiKeyEnv: 'XAI_API_KEY' },
  minimax: { baseUrl: 'https://api.minimax.chat/v1', defaultModel: 'MiniMax-Text-01', apiKeyEnv: 'MINIMAX_API_KEY' },
};

/** 视觉元数据 — 与 ProvidersPage 网格一致 */
const TYPE_META: Record<string, { short: string; gradient: string; logoText: string }> = {
  deepseek: { short: 'DeepSeek', gradient: 'from-blue-500 to-cyan-400', logoText: 'DS' },
  anthropic: { short: 'Claude', gradient: 'from-orange-500 to-amber-400', logoText: 'A' },
  openai: { short: 'GPT', gradient: 'from-emerald-500 to-teal-400', logoText: 'O' },
  google: { short: 'Gemini', gradient: 'from-sky-500 to-blue-400', logoText: 'G' },
  moonshot: { short: 'Kimi', gradient: 'from-purple-500 to-pink-400', logoText: 'M' },
  qwen: { short: 'Qwen', gradient: 'from-rose-500 to-orange-400', logoText: 'Q' },
  mistral: { short: 'Mistral', gradient: 'from-amber-500 to-yellow-400', logoText: 'Mi' },
  xai: { short: 'Grok', gradient: 'from-slate-700 to-slate-500', logoText: 'X' },
  minimax: { short: 'MiniMax', gradient: 'from-pink-500 to-rose-400', logoText: 'MM' },
};

const providerSchema = z.object({
  id: z.string().min(1, 'Provider ID is required').max(64),
  name: z.string().min(1, 'Display name is required').max(128),
  type: z.enum(PROVIDER_TYPES),
  baseUrl: z.string().min(1, 'Base URL is required').url('Must be a valid URL'),
  apiKey: z.string(),
  defaultModel: z.string().min(1, 'Default model is required').max(128),
  enabled: z.boolean(),
});

type ProviderFormData = z.infer<typeof providerSchema>;

/** Map backend 422 error codes to form field names */
const FIELD_ERROR_MAP: Record<string, keyof ProviderFormData> = {
  PROVIDER_DUPLICATE_ID: 'id',
  PROVIDER_INVALID_BASE_URL: 'baseUrl',
};

interface ProviderFormProps {
  mode: 'create' | 'edit';
  defaultValues?: Partial<ProviderFormData>;
  /** 创建模式下，指定预填的 type（点击厂商卡片时传入） */
  initialType?: string;
  providerId?: string;
  onSuccess: () => void;
}

export function ProviderForm({
  mode,
  defaultValues,
  initialType,
  providerId,
  onSuccess,
}: ProviderFormProps) {
  const queryClient = useQueryClient();

  const form = useForm<ProviderFormData>({
    resolver: zodResolver(providerSchema),
    defaultValues: {
      id: '',
      name: '',
      type: (initialType as ProviderFormData['type']) ?? 'deepseek',
      baseUrl: initialType ? (TYPE_DEFAULTS[initialType]?.baseUrl ?? 'https://api.deepseek.com/v1') : 'https://api.deepseek.com/v1',
      apiKey: '',
      defaultModel: initialType ? (TYPE_DEFAULTS[initialType]?.defaultModel ?? 'deepseek-chat') : 'deepseek-chat',
      enabled: true,
      ...defaultValues,
    },
  });

  // 切换 type 时自动填充 baseUrl / defaultModel / name（仅 create 模式下且字段为空或为原默认时）
  const selectedType = form.watch('type');
  useEffect(() => {
    if (mode !== 'create') return;
    const defaults = TYPE_DEFAULTS[selectedType];
    if (!defaults) return;
    // 自动填充 name（若未手动填写）
    const currentName = form.getValues('name');
    if (!currentName || TYPE_LABELS[currentName] != null) {
      form.setValue('name', defaults.apiKeyEnv ? '' : TYPE_LABELS[selectedType]);
    }
    form.setValue('baseUrl', defaults.baseUrl);
    form.setValue('defaultModel', defaults.defaultModel);
  }, [selectedType, mode, form]);

  const createMutation = useMutation({
    mutationFn: (data: ProviderFormData) => apiPost('/api/providers', data),
    onSuccess: (newProvider: any, variables) => {
      queryClient.setQueryData(
        queryKeys.providers.all,
        (old: any) => {
          if (!old) return { providers: [newProvider], activeId: null };
          return {
            ...old,
            providers: [...old.providers, newProvider],
          };
        }
      );
      onSuccess();
    },
    onError: (error: Error) => {
      handleFieldError(error);
    },
  });

  const editMutation = useMutation({
    mutationFn: (data: ProviderFormData) =>
      apiPut(`/api/providers/${providerId}`, data),
    onSuccess: (updatedProvider: any) => {
      queryClient.setQueryData(
        queryKeys.providers.all,
        (old: any) => {
          if (!old) return old;
          return {
            ...old,
            providers: old.providers.map((p: any) =>
              p.id === providerId ? updatedProvider : p
            ),
          };
        }
      );
      onSuccess();
    },
    onError: (error: Error) => {
      handleFieldError(error);
    },
  });

  const mutation = mode === 'create' ? createMutation : editMutation;

  function handleFieldError(error: Error) {
    if (!(error instanceof ApiError)) return;
    if (error.status !== 422) return;
    const field = FIELD_ERROR_MAP[error.code];
    if (field) {
      form.setError(field, {
        type: 'server',
        message: error.message,
      });
    }
  }

  const isSubmitting = mutation.isPending;

  return (
    <form
      onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
      className="space-y-4"
    >
      {/* Provider ID */}
      <div>
        <label htmlFor="provider-id" className="block text-sm font-medium mb-1">
          Provider ID
        </label>
        <input
          id="provider-id"
          {...form.register('id')}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm disabled:opacity-50"
          placeholder="例如：my-deepseek"
          disabled={isSubmitting || mode === 'edit'}
        />
        {form.formState.errors.id && (
          <p className="text-sm text-danger mt-1">
            {form.formState.errors.id.message}
          </p>
        )}
      </div>

      {/* Name */}
      <div>
        <label htmlFor="provider-name" className="block text-sm font-medium mb-1">
          Display Name
        </label>
        <input
          id="provider-name"
          {...form.register('name')}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
          placeholder="例如：DeepSeek"
          disabled={isSubmitting}
        />
        {form.formState.errors.name && (
          <p className="text-sm text-danger mt-1">
            {form.formState.errors.name.message}
          </p>
        )}
      </div>

      {/* Type — 厂商卡片选择器（与 ProvidersPage 网格视觉一致） */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium">厂商类型</label>
          <span className="text-xs text-text-muted">
            选中后自动填充 Base URL 与默认模型
          </span>
        </div>
        <input type="hidden" {...form.register('type')} />
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="厂商类型">
          {PROVIDER_TYPES.map((t) => {
            const isSelected = selectedType === t;
            const meta = TYPE_META[t];
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => form.setValue('type', t, { shouldDirty: true })}
                disabled={isSubmitting}
                className={`group relative overflow-hidden rounded-lg border-2 p-2.5 text-left transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${
                  isSelected
                    ? 'border-primary shadow-md ring-2 ring-primary/20'
                    : 'border-border bg-surface hover:border-primary/40 hover:shadow-sm'
                }`}
              >
                {/* hover 渐变背景 */}
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${meta.gradient} opacity-0 ${
                    isSelected ? 'opacity-15' : 'group-hover:opacity-[0.06]'
                  } transition-opacity`}
                />
                {/* 选中标记 */}
                {isSelected && (
                  <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                    <svg className="w-2.5 h-2.5 text-primary-fg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
                <div className="relative flex items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-md bg-gradient-to-br ${meta.gradient} flex items-center justify-center text-white font-bold text-xs flex-shrink-0`}
                  >
                    {meta.logoText}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold truncate ${isSelected ? 'text-primary' : ''}`}>
                      {meta.short}
                    </p>
                    <p className="text-[10px] text-text-muted truncate">
                      {TYPE_DEFAULTS[t]?.defaultModel ?? ''}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {form.formState.errors.type && (
          <p className="text-sm text-danger mt-1">
            {form.formState.errors.type.message}
          </p>
        )}
      </div>

      {/* Base URL */}
      <div>
        <label htmlFor="provider-baseUrl" className="block text-sm font-medium mb-1">
          Base URL
        </label>
        <input
          id="provider-baseUrl"
          {...form.register('baseUrl')}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
          disabled={isSubmitting}
          placeholder="https://api.deepseek.com/v1"
        />
        {form.formState.errors.baseUrl && (
          <p className="text-sm text-danger mt-1">
            {form.formState.errors.baseUrl.message}
          </p>
        )}
      </div>

      {/* API Key */}
      <div>
        <label htmlFor="provider-apiKey" className="block text-sm font-medium mb-1">
          API Key
        </label>
        <input
          id="provider-apiKey"
          type="password"
          {...form.register('apiKey')}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
          disabled={isSubmitting}
          placeholder={mode === 'edit' ? '留空则保持原值' : `留空则使用环境变量 ${TYPE_DEFAULTS[selectedType]?.apiKeyEnv || 'API_KEY'}`}
        />
        {form.formState.errors.apiKey && (
          <p className="text-sm text-danger mt-1">
            {form.formState.errors.apiKey.message}
          </p>
        )}
      </div>

      {/* Default Model */}
      <div>
        <label htmlFor="provider-defaultModel" className="block text-sm font-medium mb-1">
          Default Model
        </label>
        <input
          id="provider-defaultModel"
          {...form.register('defaultModel')}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
          disabled={isSubmitting}
          placeholder="deepseek-chat"
        />
        {form.formState.errors.defaultModel && (
          <p className="text-sm text-danger mt-1">
            {form.formState.errors.defaultModel.message}
          </p>
        )}
      </div>

      {/* Enabled */}
      <div className="flex items-center gap-2">
        <input
          id="provider-enabled"
          type="checkbox"
          {...form.register('enabled')}
          className="h-4 w-4 rounded border-border"
          disabled={isSubmitting}
        />
        <label htmlFor="provider-enabled" className="text-sm font-medium">
          Enable this provider
        </label>
        {form.formState.errors.enabled && (
          <p className="text-sm text-danger mt-1">
            {form.formState.errors.enabled.message}
          </p>
        )}
      </div>

      {/* Server-level error (non-field) */}
      {mutation.error && !(mutation.error instanceof ApiError && mutation.error.status === 422 && FIELD_ERROR_MAP[mutation.error.code]) && (
        <p className="text-sm text-danger">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : '提交失败，请稍后重试'}
        </p>
      )}

      {/* Submit */}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? '保存中...' : '保存'}
      </Button>
    </form>
  );
}
