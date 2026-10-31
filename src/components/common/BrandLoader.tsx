import React from 'react';

/** Branded loading screen: a gradient ring around the logo tile. */
export const BrandLoader: React.FC<{ message?: string }> = ({ message = 'Loading your terminal…' }) => (
  <div className="min-h-screen flex flex-col items-center justify-center gap-5 text-slate-700 dark:text-slate-300">
    <div className="relative w-24 h-24">
      <div className="loader-ring absolute inset-0" />
      <div className="absolute inset-3 rounded-2xl bg-gradient-to-br from-blue-500 via-violet-600 to-rose-500 shadow-2xl shadow-violet-500/40 flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="w-9 h-9 text-white" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 17l6-6 4 4 8-8" />
          <path d="M14 7h7v7" />
        </svg>
      </div>
    </div>
    <div className="text-center space-y-2">
      <p className="font-display font-bold text-lg text-slate-900 dark:text-white">CASTIMOFx</p>
      <p className="text-xs font-mono text-slate-500 dark:text-slate-400">{message}</p>
    </div>
    <div className="w-40 h-1.5 rounded-full shimmer" />
  </div>
);
