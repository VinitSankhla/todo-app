import { createContext, useContext } from 'react';

export interface AuthUser {
  userId: string;
  /** Value stored in each task's `owner` field by the backend: "<sub>::<username>". */
  ownerKey: string;
  email: string;
  name: string;
}

export type AuthState =
  { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; user: AuthUser };

export interface AuthContextValue {
  state: AuthState;
  /** Re-reads the current Cognito session (call after a successful sign-in). */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
