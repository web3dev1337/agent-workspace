import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);
const DEFAULT_THEME = 'light';

function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(DEFAULT_THEME);
  const [isLoaded, setIsLoaded] = useState(false);

  const setTheme = (nextTheme) => {
    const normalized = normalizeTheme(nextTheme);
    setThemeState(normalized);
    document.documentElement.dataset.theme = normalized;
  };

  useEffect(() => {
    document.documentElement.dataset.theme = DEFAULT_THEME;
    setThemeState(DEFAULT_THEME);
    setIsLoaded(true);
  }, []);

  const value = useMemo(() => ({ theme, setTheme, isLoaded }), [theme, isLoaded]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
