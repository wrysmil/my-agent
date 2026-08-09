import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import type { MouseEvent } from 'react';
import {
  MessageSquare,
  Bot,
  Plug,
  Settings2,
  SlidersHorizontal,
  Plus,
  LayoutDashboard,
  Loader2,
  Wrench,
  Trash2,
} from 'lucide-react';
import {
  useSessions,
  useDeleteSession,
  type SessionItem,
} from '@/features/sessions/useSessions';
import { useTranslation } from '@/i18n/useTranslation';

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { data, isLoading } = useSessions(false);
  const deleteSession = useDeleteSession();
  const sessions: SessionItem[] = data?.sessions ?? [];

  const recentSessions = sessions.slice(0, 20);

  const navItems = [
    { to: '/', label: t('nav.dashboard'), icon: LayoutDashboard },
    { to: '/chat', label: t('nav.chat'), icon: MessageSquare },
    { to: '/providers', label: t('nav.providers'), icon: Plug },
    { to: '/skills', label: t('nav.skills'), icon: SlidersHorizontal },
    { to: '/tools', label: t('nav.tools'), icon: Wrench },
    { to: '/agents', label: t('nav.agents'), icon: Bot },
    { to: '/settings', label: t('nav.settings'), icon: Settings2 },
  ];

  /**
   * 删除指定会话：先 confirm，避免误触；删完后：
   * - TanStack-Query 已在 onSuccess 里 invalidate/remove
   * - 若删的就是当前打开的会话，跳回空 /chat（首条消息才创建的入口）
   */
  const handleDeleteSession = (session: SessionItem, e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(t('sessions.confirmDelete'))) return;
    const wasActive = location.pathname === `/chat/${session.id}`;
    deleteSession.mutate(session.id, {
      onSuccess: () => {
        if (wasActive) navigate('/chat', { replace: true });
      },
    });
  };

  return (
    <aside
      data-testid="sidebar"
      className="w-56 shrink-0 border-r border-border bg-surface flex flex-col h-screen"
    >
      {/* Brand */}
      <div className="px-4 py-4 border-b border-border">
        <span className="text-lg font-bold text-primary">my-agent</span>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 px-2 py-3 border-b border-border">
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

      {/* Sessions */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="flex items-center justify-between px-3 py-1 mb-1">
          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
            {t('sessions.title')}
          </span>
          <button
            onClick={() => navigate('/chat')}
            className="p-0.5 rounded hover:bg-surface-hover text-text-muted hover:text-text"
            title={t('chat.newChat')}
            data-testid="new-session-btn"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-3">
            <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
          </div>
        ) : recentSessions.length === 0 ? (
          <p className="px-3 py-2 text-xs text-text-muted">
            {t('sessions.empty')}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {recentSessions.map((s) => (
              <li key={s.id} className="group relative">
                <NavLink
                  to={`/chat/${s.id}`}
                  className={({ isActive }) =>
                    `block pl-3 pr-7 py-1.5 rounded-md text-sm truncate transition-colors ${
                      isActive
                        ? 'bg-accent text-accent-fg font-medium'
                        : 'text-text-muted hover:bg-surface-hover hover:text-text'
                    }`
                  }
                  title={s.name || s.id}
                >
                  {s.name || s.id}
                </NavLink>
                <button
                  type="button"
                  onClick={(e) => handleDeleteSession(s, e)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted/0 group-hover:text-text-muted hover:!text-danger hover:bg-danger/10 opacity-0 group-hover:opacity-100 transition-opacity"
                  title={t('sessions.delete')}
                  aria-label={`${t('sessions.delete')}: ${s.name || s.id}`}
                  data-testid={`delete-session-${s.id}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
