import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Zap, Brain, Sun, Moon, Languages, Save, Loader2 } from 'lucide-react';
import { useUiStore } from '@/features/ui/useUiStore';
import { useTranslation } from '@/i18n/useTranslation';
import { apiGet, apiPut } from '@/lib/api';

// ============================================================
// Agent/Memory 新增配置项的翻译回退（不修改 i18n JSON 文件）
// ============================================================
const SETTINGS_FALLBACK: Record<string, Record<string, string>> = {
  zh: {
    'settings.agent': 'Agent 配置',
    'settings.agent.defaultModel': '默认模型',
    'settings.agent.thinkingLevel': '思考级别',
    'settings.agent.maxRetries': '最大重试次数',
    'settings.agent.maxToolLoops': '最大工具循环',
    'settings.memory': '记忆配置',
    'settings.memory.enabled': '启用记忆',
    'settings.memory.maxResults': '最大检索数',
    'settings.save': '保存配置',
    'settings.saving': '保存中…',
    'settings.saved': '已保存',
    'settings.loadError': '加载配置失败',
    'settings.saveError': '保存配置失败',
    'thinking.off': '关闭',
    'thinking.low': '低',
    'thinking.high': '高',
  },
  en: {
    'settings.agent': 'Agent Config',
    'settings.agent.defaultModel': 'Default Model',
    'settings.agent.thinkingLevel': 'Thinking Level',
    'settings.agent.maxRetries': 'Max Retries',
    'settings.agent.maxToolLoops': 'Max Tool Loops',
    'settings.memory': 'Memory Config',
    'settings.memory.enabled': 'Enable Memory',
    'settings.memory.maxResults': 'Max Results',
    'settings.save': 'Save',
    'settings.saving': 'Saving…',
    'settings.saved': 'Saved',
    'settings.loadError': 'Failed to load config',
    'settings.saveError': 'Failed to save config',
    'thinking.off': 'Off',
    'thinking.low': 'Low',
    'thinking.high': 'High',
  },
};

/**
 * 增强的 t()：优先使用模块级 i18n 翻译，缺失时回退到 SETTINGS_FALLBACK。
 */
function useEnhancedTranslation() {
  const { t: baseT, locale } = useTranslation();

  const t = useCallback(
    (key: string): string => {
      const translated = baseT(key);
      // 如果 i18n 返回了 key 本身（未找到翻译），回退到本地回退表
      if (translated === key) {
        return SETTINGS_FALLBACK[locale]?.[key] ?? SETTINGS_FALLBACK['zh']?.[key] ?? key;
      }
      return translated;
    },
    [baseT, locale],
  );

  return { t, locale };
}

// ============================================================
// Config 类型
// ============================================================
interface ConfigData {
  agent: {
    defaultModel: string;
    defaultProvider: string;
    maxRetries: number;
    maxToolLoops: number;
    thinkingLevel: string;
  };
  memory: {
    enabled: boolean;
    maxResults: number;
  };
}

// ============================================================
// SettingsPage
// ============================================================
export function SettingsPage() {
  const { t } = useEnhancedTranslation();
  const theme = useUiStore((s) => s.theme);
  const locale = useUiStore((s) => s.locale);
  const setTheme = useUiStore((s) => s.setTheme);
  const setLocale = useUiStore((s) => s.setLocale);
  const queryClient = useQueryClient();

  const [savedMessage, setSavedMessage] = useState(false);

  // 加载配置
  const {
    data: config,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['config'],
    queryFn: async () => {
      const res = await apiGet<{ ok: boolean; data: ConfigData }>('/api/config');
      return (res as unknown as { ok: boolean; data: ConfigData }).data;
    },
  });

  // 保存配置
  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiPut('/api/config', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 2000);
    },
  });

  const handleSaveAgent = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    saveMutation.mutate({
      agent: {
        defaultModel: form.get('defaultModel'),
        thinkingLevel: form.get('thinkingLevel'),
        maxRetries: Number(form.get('maxRetries')),
        maxToolLoops: Number(form.get('maxToolLoops')),
      },
    });
  };

  const handleSaveMemory = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    saveMutation.mutate({
      memory: {
        enabled: form.get('memoryEnabled') === 'on',
        maxResults: Number(form.get('maxResults')),
      },
    });
  };

  if (isLoading) {
    return (
      <div data-testid="page-settings" className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin h-6 w-6" />
      </div>
    );
  }

  if (isError) {
    return (
      <div data-testid="page-settings" className="p-6">
        <p>{t('settings.loadError')}</p>
      </div>
    );
  }

  return (
    <div data-testid="page-settings" className="max-w-2xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>

      {/* ── 主题 & 语言 ── */}
      <section className="space-y-4 p-4 border rounded-lg">
        <h2 className="text-lg font-semibold">{t('settings.theme')}</h2>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="inline-flex items-center gap-2 px-4 py-2 border rounded-md"
          >
            {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            {theme === 'light' ? t('settings.dark') : t('settings.light')}
          </button>
        </div>

        <h2 className="text-lg font-semibold">{t('settings.language')}</h2>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
            className="inline-flex items-center gap-2 px-4 py-2 border rounded-md"
          >
            <Languages className="h-4 w-4" />
            {locale === 'zh' ? 'English' : '中文'}
          </button>
        </div>
      </section>

      {/* ── Agent 配置组 ── */}
      <section className="space-y-4 p-4 border rounded-lg">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Zap className="h-5 w-5" />
          {t('settings.agent')}
        </h2>
        <form onSubmit={handleSaveAgent} className="space-y-4">
          {/* defaultModel */}
          <div>
            <label
              htmlFor="settings-agent-model"
              className="block text-sm font-medium mb-1"
            >
              {t('settings.agent.defaultModel')}
            </label>
            <input
              id="settings-agent-model"
              name="defaultModel"
              type="text"
              defaultValue={config?.agent?.defaultModel ?? ''}
              className="w-full px-3 py-2 border rounded-md"
              data-testid="settings-agent-model"
            />
          </div>

          {/* thinkingLevel */}
          <div>
            <label
              htmlFor="settings-agent-thinking"
              className="block text-sm font-medium mb-1"
            >
              {t('settings.agent.thinkingLevel')}
            </label>
            <select
              id="settings-agent-thinking"
              name="thinkingLevel"
              defaultValue={config?.agent?.thinkingLevel ?? 'off'}
              className="w-full px-3 py-2 border rounded-md"
              data-testid="settings-agent-thinking"
            >
              <option value="off">{t('thinking.off')}</option>
              <option value="low">{t('thinking.low')}</option>
              <option value="high">{t('thinking.high')}</option>
            </select>
          </div>

          {/* maxRetries */}
          <div>
            <label
              htmlFor="settings-agent-maxretries"
              className="block text-sm font-medium mb-1"
            >
              {t('settings.agent.maxRetries')}
            </label>
            <input
              id="settings-agent-maxretries"
              name="maxRetries"
              type="number"
              min={0}
              defaultValue={config?.agent?.maxRetries ?? 3}
              className="w-full px-3 py-2 border rounded-md"
              data-testid="settings-agent-maxretries"
            />
          </div>

          {/* maxToolLoops */}
          <div>
            <label
              htmlFor="settings-agent-maxloops"
              className="block text-sm font-medium mb-1"
            >
              {t('settings.agent.maxToolLoops')}
            </label>
            <input
              id="settings-agent-maxloops"
              name="maxToolLoops"
              type="number"
              min={1}
              defaultValue={config?.agent?.maxToolLoops ?? 100}
              className="w-full px-3 py-2 border rounded-md"
              data-testid="settings-agent-maxloops"
            />
          </div>

          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 border rounded-md disabled:opacity-50"
            data-testid="settings-agent-save"
          >
            {saveMutation.isPending ? (
              <Loader2 className="animate-spin h-4 w-4" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saveMutation.isPending ? t('settings.saving') : t('settings.save')}
          </button>
        </form>
      </section>

      {/* ── Memory 配置组 ── */}
      <section className="space-y-4 p-4 border rounded-lg">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Brain className="h-5 w-5" />
          {t('settings.memory')}
        </h2>
        <form onSubmit={handleSaveMemory} className="space-y-4">
          {/* enabled toggle */}
          <div className="flex items-center gap-3">
            <label
              htmlFor="settings-memory-enabled"
              className="text-sm font-medium"
            >
              {t('settings.memory.enabled')}
            </label>
            <input
              id="settings-memory-enabled"
              name="memoryEnabled"
              type="checkbox"
              defaultChecked={config?.memory?.enabled ?? true}
              className="h-4 w-4"
              data-testid="settings-memory-enabled"
            />
          </div>

          {/* maxResults */}
          <div>
            <label
              htmlFor="settings-memory-maxresults"
              className="block text-sm font-medium mb-1"
            >
              {t('settings.memory.maxResults')}
            </label>
            <input
              id="settings-memory-maxresults"
              name="maxResults"
              type="number"
              min={1}
              defaultValue={config?.memory?.maxResults ?? 10}
              className="w-full px-3 py-2 border rounded-md"
              data-testid="settings-memory-maxresults"
            />
          </div>

          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 border rounded-md disabled:opacity-50"
            data-testid="settings-memory-save"
          >
            {saveMutation.isPending ? (
              <Loader2 className="animate-spin h-4 w-4" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saveMutation.isPending ? t('settings.saving') : t('settings.save')}
          </button>
        </form>
      </section>

      {/* 成功提示 */}
      {savedMessage && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded-md shadow-lg text-white bg-green-600">
          {t('settings.saved')}
        </div>
      )}

      {/* 错误提示 */}
      {saveMutation.isError && (
        <div className="text-red-600 text-sm">{t('settings.saveError')}</div>
      )}
    </div>
  );
}
