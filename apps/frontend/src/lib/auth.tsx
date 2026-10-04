'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import {
  clearStoredAuth,
  fetchJson,
  TOKEN_KEY,
  ACTIVE_TEAM_KEY,
  ROLE_KEY,
  NAME_KEY,
  EMAIL_KEY,
  SESSION_EXPIRED_EVENT,
  type AuthSuccess,
} from './api';

interface AuthState {
  initialized: boolean;
  token: string | null;
  name: string | null;
  email: string | null;
  role: string | null;
  activeTeamId: string | null;
  login: (email: string, password: string) => Promise<string>;
  signupAdmin: (name: string, email: string, password: string, teamName: string) => Promise<void>;
  signupMember: (
    name: string,
    email: string,
    password: string,
    role: 'user' | 'manager',
  ) => Promise<void>;
  acceptAuth: (data: AuthSuccess) => void;
  setActiveTeam: (teamId: string | null) => void;
  logout: () => void;
  clearSession: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initialized, setInitialized] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);

  const syncFromStorage = useCallback(() => {
    setToken(window.localStorage.getItem(TOKEN_KEY));
    setName(window.localStorage.getItem(NAME_KEY));
    setEmail(window.localStorage.getItem(EMAIL_KEY));
    setRole(window.localStorage.getItem(ROLE_KEY));
    setActiveTeamId(window.localStorage.getItem(ACTIVE_TEAM_KEY));
    setInitialized(true);
  }, []);

  const clearSession = useCallback(() => {
    clearStoredAuth();
    setToken(null);
    setName(null);
    setEmail(null);
    setRole(null);
    setActiveTeamId(null);
    setInitialized(true);
  }, []);

  useEffect(() => {
    syncFromStorage();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === TOKEN_KEY) syncFromStorage();
    };
    const onSessionExpired = () => clearSession();
    window.addEventListener('storage', onStorage);
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    };
  }, [clearSession, syncFromStorage]);

  const applyAuth = useCallback((data: AuthSuccess) => {
    const teamId = data.user.teamId ?? data.team?.id ?? null;
    window.localStorage.setItem(TOKEN_KEY, data.token);
    window.localStorage.setItem(ROLE_KEY, data.user.role);
    window.localStorage.setItem(NAME_KEY, data.user.name);
    window.localStorage.setItem(EMAIL_KEY, data.user.email);
    if (teamId) window.localStorage.setItem(ACTIVE_TEAM_KEY, teamId);
    else window.localStorage.removeItem(ACTIVE_TEAM_KEY);
    setToken(data.token);
    setName(data.user.name);
    setEmail(data.user.email);
    setRole(data.user.role);
    setActiveTeamId(teamId);
    setInitialized(true);
  }, []);

  const login = useCallback(
    async (emailInput: string, password: string) => {
      const data = await fetchJson<AuthSuccess>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: emailInput, password }),
      });
      applyAuth(data);
      return data.user.role;
    },
    [applyAuth],
  );

  const signupAdmin = useCallback(
    async (nameInput: string, emailInput: string, password: string, teamName: string) => {
      const data = await fetchJson<AuthSuccess>('/api/v1/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: nameInput, email: emailInput, password, teamName }),
      });
      applyAuth(data);
    },
    [applyAuth],
  );

  const signupMember = useCallback(
    async (nameInput: string, emailInput: string, password: string, memberRole: 'user' | 'manager') => {
      const data = await fetchJson<AuthSuccess>('/api/v1/auth/signup/user', {
        method: 'POST',
        body: JSON.stringify({ name: nameInput, email: emailInput, password, role: memberRole }),
      });
      applyAuth(data);
    },
    [applyAuth],
  );

  const setActiveTeam = useCallback((teamId: string | null) => {
    if (teamId) window.localStorage.setItem(ACTIVE_TEAM_KEY, teamId);
    else window.localStorage.removeItem(ACTIVE_TEAM_KEY);
    setActiveTeamId(teamId);
  }, []);

  const logout = useCallback(() => {
    clearSession();
  }, [clearSession]);

  return (
    <AuthContext.Provider
      value={{
        initialized,
        token,
        name,
        email,
        role,
        activeTeamId,
        login,
        signupAdmin,
        signupMember,
        acceptAuth: applyAuth,
        setActiveTeam,
        logout,
        clearSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
