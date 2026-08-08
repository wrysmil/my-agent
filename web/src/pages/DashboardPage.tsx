import { useTranslation } from '@/i18n/useTranslation';

export function DashboardPage() {
  const { t } = useTranslation();
  return <div data-testid="page-dashboard">{t('nav.dashboard')}</div>;
}
