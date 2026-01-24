import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const ThemeContext = createContext(null);

const STORAGE_KEY = 'diffViewer.theme';

function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState('light');
  const [isLoaded, setIsLoaded] = useState(false);

  const setTheme = async (nextTheme) => {
    const normalized = normalizeTheme(nextTheme);
    setThemeState(normalized);
    window.localStorage.setItem(STORAGE_KEY, normalized);
    document.documentElement.dataset.theme = normalized;

    try {
      await axios.put('/settings/diff-viewer-theme', { theme: normalized });
    } catch {
      // Best-effort persistence; keep local override.
    }
  };

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const local = stored ? normalizeTheme(stored) : null;

      try {
        const res = await axios.get('/settings');
        const serverTheme = normalizeTheme(res?.data?.diffViewer?.theme);
        const initial = local || serverTheme || 'light';
        if (!mounted) return;
        setThemeState(initial);
        document.documentElement.dataset.theme = initial;
      } catch {
        const initial = local || 'light';
        if (!mounted) return;
        setThemeState(initial);
        document.documentElement.dataset.theme = initial;
      } finally {
        if (mounted) setIsLoaded(true);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo(() => ({ theme, setTheme, isLoaded }), [theme, isLoaded]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
