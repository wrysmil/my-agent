import { NavLink } from 'react-router-dom';
import {
  MessageSquare,
  History,
  Bot,
  Plug,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export function Sidebar() {
  const { t } = useTranslation();

  const navItems = [
    { to: '/', label: t('nav.dashboard'), icon: MessageSquare },
    { to: '/chat', label: t('nav.chat'), icon: MessageSquare },
    { to: '/sessions', label: t('nav.sessions'), icon: History },
    { to: '/providers', label: t('nav.providers'), icon: Plug },
    { to: '/skills', label: t('nav.skills'), icon: SlidersHorizontal },
    { to: '/agents', label: t('nav.agents'), icon: Bot },
    { to: '/settings', label: t('nav.settings'), icon: Settings2 },
  ];

  return (
    <aside
      data-testid="sidebar"
      className="w-56 shrink-0 border-r border-border bg-surface flex flex-col py-4"
    >
      <div className="px-4 mb-6">
        <span className="text-lg font-bold text-primary">my-agent</span>
      </div>
      <nav className="flex flex-col gap-1 px-2">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-accent text-accent-fg font-medium'
                  : 'text-text-muted hover:bg-surface-hover hover:text-text'
              }`
            }
          >
            <item.icon className="w-4 h-4" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
