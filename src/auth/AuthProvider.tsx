import { fetchUserAttributes, getCurrentUser, signOut } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthContext, type AuthState } from './auth-context';

/** Reads the current Cognito session; any failure means "signed out". */
async function loadAuthState(): Promise<AuthState> {
  try {
    const { userId } = await getCurrentUser();
    const attributes = await fetchUserAttributes();
    return {
      status: 'signedIn',
      user: { userId, email: attributes.email ?? '', name: attributes.name ?? '' },
    };
  } catch {
    return { status: 'signedOut' };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    setState(await loadAuthState());
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOut();
    } finally {
      setState({ status: 'signedOut' });
    }
  }, []);

  useEffect(() => {
    let active = true;
    loadAuthState().then((next) => {
      if (active) setState(next);
    });
    // Keep state in sync if the session changes (e.g. expired refresh token).
    const stopListening = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn') void loadAuthState().then(setState);
      if (payload.event === 'signedOut' || payload.event === 'tokenRefresh_failure') {
        setState({ status: 'signedOut' });
      }
    });
    return () => {
      active = false;
      stopListening();
    };
  }, []);

  const value = useMemo(() => ({ state, refresh, logout }), [state, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
