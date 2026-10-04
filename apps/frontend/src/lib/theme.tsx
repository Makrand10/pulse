'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';

const THEME_KEY = 'pulse_theme';

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_KEY);
    const initialTheme: Theme = stored === 'light' ? 'light' : 'dark';
    setTheme(initialTheme);
    applyTheme(initialTheme);

    function onStorage(event: StorageEvent) {
      if (event.key !== THEME_KEY) return;
      const nextTheme: Theme = event.newValue === 'light' ? 'light' : 'dark';
      setTheme(nextTheme);
      applyTheme(nextTheme);
    }

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const nextTheme: Theme = current === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem(THEME_KEY, nextTheme);
      applyTheme(nextTheme);
      return nextTheme;
    });
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
