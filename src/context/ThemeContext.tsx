import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { flushSync } from 'react-dom';

export type Theme = 'dark' | 'light';

interface ThemeContextType {
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

// v2: the premium dark look is the default for everyone; the toggle still switches to light.
const THEME_STORAGE_KEY = 'castimo_theme_v2';

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') {
        return saved;
      }
    } catch {
      // Fallback
    }
    return 'dark';
  });

  useEffect(() => {
    applyRootClass(theme);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore
    }
  }, [theme]);

  /**
   * Switches theme with one cross-fade of the whole screen (the browser's View Transitions: it fades a snapshot, so it costs
   * the same however busy the page is). Browsers without it, and people who ask for reduced motion, get an instant switch.
   * (The previous approach animated the colours of every element on the page at once, which was slow on full dashboards.)
   */
  const switchTo = (next: Theme) => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const apply = () => {
      applyRootClass(next);
      flushSync(() => setThemeState(next));
    };
    if (!reduceMotion && typeof doc.startViewTransition === 'function') {
      try {
        doc.startViewTransition(apply);
        return;
      } catch {
        // fall through to an instant switch
      }
    }
    apply();
  };

  const toggleTheme = () => switchTo(theme === 'dark' ? 'light' : 'dark');

  const setTheme = (newTheme: Theme) => switchTo(newTheme);

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === 'dark', toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

function applyRootClass(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
}

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
