import { Navigate, Outlet, useLocation } from 'react-router';
import { Spinner } from '../components/ui';
import { useAuth } from './auth-context';

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-600">
      <Spinner label="Loading…" />
    </div>
  );
}

/** Only for logged-in users; everyone else is sent to /login (and returned here afterwards). */
export function ProtectedRoute() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <FullPageSpinner />;
  if (state.status === 'signedOut') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/** Login/signup pages: logged-in users go to the page they wanted, or to their tasks. */
export function PublicOnlyRoute() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <FullPageSpinner />;
  if (state.status === 'signedIn') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from?.startsWith('/') ? from : '/tasks'} replace />;
  }
  return <Outlet />;
}
