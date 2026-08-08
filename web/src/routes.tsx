import { type RouteObject } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { ChatPage } from '@/pages/ChatPage';
import { SessionsPage } from '@/pages/SessionsPage';
import { ProvidersPage } from '@/pages/ProvidersPage';
import { SkillsPage } from '@/pages/SkillsPage';
import { AgentsPage } from '@/pages/AgentsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage />, handle: { label: 'Dashboard' } },
      { path: 'chat', element: <ChatPage /> },
      { path: 'chat/:sessionId', element: <ChatPage /> },
      { path: 'sessions', element: <SessionsPage />, handle: { label: 'Sessions' } },
      { path: 'providers', element: <ProvidersPage />, handle: { label: 'Providers' } },
      { path: 'skills', element: <SkillsPage />, handle: { label: 'Skills' } },
      { path: 'agents', element: <AgentsPage />, handle: { label: 'Agents' } },
      { path: 'settings', element: <SettingsPage />, handle: { label: 'Settings' } },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
