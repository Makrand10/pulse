'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { fetchJson, TOKEN_KEY, ACTIVE_TEAM_KEY, type AuthSuccess } from './api';

export const ROLE_KEY = 'pulse_role';
export const NAME_KEY = 'pulse_name';
export const EMAIL_KEY = 'pulse_email';

interface AuthState {
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
}

const AuthContext = createContext<AuthState | null>(null);

function read(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(key);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => read(TOKEN_KEY));
  const [name, setName] = useState<string | null>(() => read(NAME_KEY));
  const [email, setEmail] = useState<string | null>(() => read(EMAIL_KEY));
  const [role, setRole] = useState<string | null>(() => read(ROLE_KEY));
  const [activeTeamId, setActiveTeamId] = useState<string | null>(() => read(ACTIVE_TEAM_KEY));

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
    [TOKEN_KEY, ROLE_KEY, NAME_KEY, EMAIL_KEY, ACTIVE_TEAM_KEY].forEach((k) =>
      window.localStorage.removeItem(k),
    );
    setToken(null);
    setName(null);
    setEmail(null);
    setRole(null);
    setActiveTeamId(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
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
