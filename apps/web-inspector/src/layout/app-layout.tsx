import { Outlet } from 'react-router-dom';
import { Sidebar } from './sidebar';

export function AppLayout() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-[32px] overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
