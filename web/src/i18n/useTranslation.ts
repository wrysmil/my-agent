import { useCallback } from 'react';
import { useUiStore } from '@/features/ui/useUiStore';
import { t } from '@/lib/i18n';

/**
 * React hook：获取翻译函数 t() 和当前 locale。
 * 订阅 Zustand locale 状态，locale 变化时自动触发组件重渲染。
 *
 * Source: .ai-runtime-artifacts/specs/2026-08-08-six-issues-fix-spec.md §3.3.2
 */
export function useTranslation() {
  const locale = useUiStore((s) => s.locale);

  const translate = useCallback(
    (key: string, params?: Record<string, string>) => t(key, params),
    // locale 变化时重建 t 引用，保证消费组件更新
    [locale],
  );

  return { t: translate, locale };
}
