import { NavLink, useNavigate } from 'react-router-dom';
import {
  MessageSquare,
  Bot,
  Plug,
  Settings2,
  SlidersHorizontal,
  Plus,
  LayoutDashboard,
  Loader2,
} from 'lucide-react';
import { useSessions, type SessionItem } from '@/features/sessions/useSessions';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/providers', label: 'Providers', icon: Plug },
  { to: '/skills', label: 'Skills', icon: SlidersHorizontal },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/settings', label: 'Settings', icon: Settings2 },
];

export function Sidebar() {
  const navigate = useNavigate();
  const { data, isLoading } = useSessions(false);
  const sessions: SessionItem[] = data?.sessions ?? [];

  const recentSessions = sessions.slice(0, 20);

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
            Sessions
          </span>
          <button
            onClick={() => navigate('/chat')}
            className="p-0.5 rounded hover:bg-surface-hover text-text-muted hover:text-text"
            title="新建会话"
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
            暂无会话
          </p>
        ) : (
          <ul className="space-y-0.5">
            {recentSessions.map((s) => (
              <li key={s.id}>
                <NavLink
                  to={`/chat/${s.id}`}
                  className={({ isActive }) =>
                    `block px-3 py-1.5 rounded-md text-sm truncate transition-colors ${
                      isActive
                        ? 'bg-accent text-accent-fg font-medium'
                        : 'text-text-muted hover:bg-surface-hover hover:text-text'
                    }`
                  }
                  title={s.name || s.id}
                >
                  {s.name || s.id}
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
