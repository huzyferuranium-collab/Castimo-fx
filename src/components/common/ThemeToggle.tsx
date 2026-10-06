import React from 'react';
import { useTheme } from '../../context/ThemeContext';
import { Sun, Moon } from 'lucide-react';

export const ThemeToggle: React.FC<{ showLabel?: boolean; className?: string }> = ({
  showLabel = false,
  className = '',
}) => {
  const { theme, isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-all cursor-pointer font-medium text-xs select-none border shadow-sm ${
        isDark
          ? 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700/80 shadow-black/20'
          : 'bg-white hover:bg-slate-100 text-slate-700 hover:text-slate-950 border-slate-200 shadow-slate-200/50'
      } ${className}`}
      title={isDark ? 'Switch to White theme' : 'Switch to Dark theme'}
      aria-label="Toggle theme"
    >
      <div className="relative w-4 h-4 flex items-center justify-center">
        {isDark ? (
          <Sun className="w-3.5 h-3.5 text-amber-400 transition-transform duration-300 hover:rotate-45" />
        ) : (
          <Moon className="w-3.5 h-3.5 text-indigo-600 transition-transform duration-300 -rotate-12 hover:rotate-0" />
        )}
      </div>
      {showLabel && (
        <span className="font-semibold">
          {isDark ? 'Light Mode' : 'Dark Mode'}
        </span>
      )}
    </button>
  );
};

export const ThemeSegmentedControl: React.FC = () => {
  const { theme, setTheme } = useTheme();

  return (
    <div className="inline-flex items-center p-1 rounded-xl bg-slate-200/80 dark:bg-slate-900 border border-slate-300/80 dark:border-slate-800 text-xs font-semibold">
      <button
        type="button"
        onClick={() => setTheme('dark')}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
          theme === 'dark'
            ? 'bg-purple-600 text-white shadow-sm'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
        }`}
      >
        <Moon className="w-3.5 h-3.5" />
        <span>Dark</span>
      </button>
      <button
        type="button"
        onClick={() => setTheme('light')}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
          theme === 'light'
            ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
        }`}
      >
        <Sun className="w-3.5 h-3.5 text-amber-500" />
        <span>Light</span>
      </button>
    </div>
  );
};
