import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, apiPut, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';

const providerSchema = z.object({
  id: z.string().min(1, 'Provider ID is required').max(64),
  name: z.string().min(1, 'Display name is required').max(128),
  type: z.enum(['deepseek']),
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
  providerId?: string;
  onSuccess: () => void;
}

export function ProviderForm({
  mode,
  defaultValues,
  providerId,
  onSuccess,
}: ProviderFormProps) {
  const queryClient = useQueryClient();

  const form = useForm<ProviderFormData>({
    resolver: zodResolver(providerSchema),
    defaultValues: {
      id: '',
      name: '',
      type: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      defaultModel: 'deepseek-chat',
      enabled: true,
      ...defaultValues,
    },
  });

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

      {/* Type (当前仅支持 deepseek) */}
      <div>
        <label htmlFor="provider-type" className="block text-sm font-medium mb-1">
          Type
        </label>
        <select
          id="provider-type"
          {...form.register('type')}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
          disabled={isSubmitting}
        >
          <option value="deepseek">DeepSeek</option>
        </select>
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
          placeholder={mode === 'edit' ? '留空则保持原值' : '留空则使用环境变量 DEEPSEEK_API_KEY'}
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
