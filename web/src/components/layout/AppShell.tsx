import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ThunderFighterPet } from '@/features/plugins/ThunderFighterPet';

export function AppShell() {
  return (
    <div className="flex h-screen bg-bg text-text overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <Topbar />
        <main className="flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </main>
      </div>
      <ThunderFighterPet />
    </div>
  );
}
