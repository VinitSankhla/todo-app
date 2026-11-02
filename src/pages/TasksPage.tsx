import { useState } from 'react';
import { useAuth } from '../auth/auth-context';
import { Button } from '../components/ui';

export default function TasksPage() {
  const { state, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const name = state.status === 'signedIn' ? state.user.name : '';

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <p className="truncate text-sm text-slate-700">
            Signed in as <span className="font-medium text-slate-900">{name}</span>
          </p>
          <Button variant="secondary" loading={loggingOut} onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-slate-900">My tasks</h1>
        <p className="mt-2 text-slate-600">Task management is coming in the next phase.</p>
      </main>
    </div>
  );
}
