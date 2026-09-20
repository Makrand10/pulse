'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { fetchJson, TOKEN_KEY, type AuthSuccess } from './api';

export const ROLE_KEY = 'pulse_role';

interface AuthState {
  token: string | null;
  name: string | null;
  email: string | null;
  role: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string, teamName: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function initialToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [name, setName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  const applyAuth = useCallback((data: AuthSuccess) => {
    window.localStorage.setItem(TOKEN_KEY, data.token);
    window.localStorage.setItem(ROLE_KEY, data.user.role);
    setToken(data.token);
    setName(data.user.name);
    setEmail(data.user.email);
    setRole(data.user.role);
  }, []);

  const login = useCallback(
    async (emailInput: string, password: string) => {
      const data = await fetchJson<AuthSuccess>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: emailInput, password }),
      });
      applyAuth(data);
    },
    [applyAuth],
  );

  const signup = useCallback(
    async (nameInput: string, emailInput: string, password: string, teamName: string) => {
      const data = await fetchJson<AuthSuccess>('/api/v1/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: nameInput, email: emailInput, password, teamName }),
      });
      applyAuth(data);
    },
    [applyAuth],
  );

  const logout = useCallback(() => {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(ROLE_KEY);
    setToken(null);
    setName(null);
    setEmail(null);
    setRole(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, name, email, role, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}