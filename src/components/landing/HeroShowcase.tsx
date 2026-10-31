import React, { useId } from 'react';
import { Shield } from 'lucide-react';
import { Orb, Cube, Ring, Coin } from './Shapes';

/**
 * Illustration of the client terminal. It is artwork only: no figures, no labels, no live claims.
 * Your real dashboard shows your own broker data.
 */
export const HeroShowcase: React.FC = () => {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <div className="relative mx-auto max-w-4xl pt-6 pb-2">
      {/* floating 3D-style shapes */}
      <Orb size={96} className="absolute sm:-left-20 -top-1 animate-float-a hidden sm:block drop-shadow-[0_18px_28px_rgba(59,91,219,.45)]" />
      <Orb size={46} from="#ffd0d8" mid="#f43f5e" to="#7f1034" className="absolute left-[12%] -bottom-2 animate-float-c hidden sm:block drop-shadow-[0_12px_18px_rgba(225,29,72,.45)]" />
      <Cube size={104} className="absolute sm:-right-16 -top-4 animate-float-b hidden sm:block drop-shadow-[0_20px_30px_rgba(124,58,237,.45)]" />
      <Ring size={150} className="absolute -right-4 sm:-right-16 bottom-6 animate-float-c hidden md:block opacity-90" />
      <Coin size={58} className="absolute right-[14%] -bottom-4 animate-float-a hidden sm:block drop-shadow-[0_12px_18px_rgba(212,175,55,.45)]" />

      <div className="relative [perspective:1600px]">
        <div className="surface rounded-3xl p-3 sm:p-4 md:[transform:rotateX(5deg)] transition-transform duration-700 hover:[transform:rotateX(0deg)]">
          <div className="hairline-silver absolute inset-x-8 top-0" />

          {/* window bar */}
          <div className="flex items-center gap-2 px-2 pb-3">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="w-2.5 h-2.5 rounded-full bg-teal-400" />
            <span className="ml-3 h-2 w-28 rounded-full bg-slate-400/25" />
            <span className="ml-auto h-2 w-10 rounded-full bg-slate-400/20" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1.7fr_1fr] gap-3 sm:gap-4">
            {/* chart panel */}
            <div className="rounded-2xl p-4 sm:p-5 bg-slate-900/5 dark:bg-white/[0.04] border border-slate-900/5 dark:border-white/[0.06]">
              <div className="flex items-center justify-between mb-3">
                <span className="h-2.5 w-24 rounded-full bg-slate-400/30" />
                <span className="flex gap-1.5">
                  <span className="h-5 w-9 rounded-full bg-gradient-to-r from-sky-400 to-blue-600" />
                  <span className="h-5 w-9 rounded-full bg-slate-400/20" />
                  <span className="h-5 w-9 rounded-full bg-slate-400/20" />
                </span>
              </div>
              <svg viewBox="0 0 480 190" className="w-full h-auto" aria-hidden>
                <defs>
                  <linearGradient id={`${id}line`} x1="0" x2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset=".55" stopColor="#4d6bff" /><stop offset="1" stopColor="#c084fc" /></linearGradient>
                  <linearGradient id={`${id}area`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6366f1" stopOpacity=".35" /><stop offset="1" stopColor="#6366f1" stopOpacity="0" /></linearGradient>
                </defs>
                {[40, 80, 120, 160].map((y) => (
                  <line key={y} x1="0" x2="480" y1={y} y2={y} stroke="currentColor" strokeOpacity=".08" />
                ))}
                <path d="M0 150 C40 140 70 104 112 112 S176 66 214 78 S284 26 334 40 S404 56 480 14 V190 H0 Z" fill={`url(#${id}area)`} />
                <path d="M0 150 C40 140 70 104 112 112 S176 66 214 78 S284 26 334 40 S404 56 480 14" fill="none" stroke={`url(#${id}line)`} strokeWidth="3.5" strokeLinecap="round" pathLength={1} strokeDasharray="1" className="animate-draw" />
                <circle cx="480" cy="14" r="5" fill="#c084fc" />
                <circle cx="480" cy="14" r="11" fill="#c084fc" opacity=".25" className="node-pulse" />
              </svg>
            </div>

            {/* gauge + bars */}
            <div className="grid grid-cols-2 md:grid-cols-1 gap-3 sm:gap-4">
              <div className="rounded-2xl p-4 bg-slate-900/5 dark:bg-white/[0.04] border border-slate-900/5 dark:border-white/[0.06] flex items-center justify-center">
                <div className="relative w-24 h-24 sm:w-28 sm:h-28">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" aria-hidden>
                    <defs>
                      <linearGradient id={`${id}ring`} x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#f43f5e" /><stop offset=".5" stopColor="#a855f7" /><stop offset="1" stopColor="#38bdf8" /></linearGradient>
                    </defs>
                    <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeOpacity=".1" strokeWidth="9" />
                    <circle cx="50" cy="50" r="40" fill="none" stroke={`url(#${id}ring)`} strokeWidth="9" strokeLinecap="round" pathLength={1} strokeDasharray="0.72 1" className="animate-draw" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center text-violet-600 dark:text-violet-300"><Shield className="w-7 h-7" /></div>
                </div>
              </div>
              <div className="rounded-2xl p-4 bg-slate-900/5 dark:bg-white/[0.04] border border-slate-900/5 dark:border-white/[0.06] space-y-3 flex flex-col justify-center">
                {[
                  { w: 'w-[82%]', c: 'from-rose-500 to-fuchsia-500' },
                  { w: 'w-[58%]', c: 'from-violet-500 to-indigo-500' },
                  { w: 'w-[40%]', c: 'from-sky-400 to-cyan-400' },
                ].map((b, i) => (
                  <div key={i} className="h-2.5 rounded-full bg-slate-400/20 overflow-hidden">
                    <div className={`h-full ${b.w} origin-left rounded-full bg-gradient-to-r ${b.c} animate-grow-x`} style={{ animationDelay: `${0.5 + i * 0.15}s` }} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* bottom strip */}
          <div className="grid grid-cols-3 gap-3 sm:gap-4 mt-3 sm:mt-4">
            {['from-sky-400 to-blue-600', 'from-violet-500 to-purple-700', 'from-rose-500 to-red-700'].map((g, i) => (
              <div key={i} className="rounded-xl p-3 bg-slate-900/5 dark:bg-white/[0.04] border border-slate-900/5 dark:border-white/[0.06] flex items-center gap-2.5">
                <span className={`w-7 h-7 rounded-lg bg-gradient-to-br ${g} shadow-md`} />
                <span className="flex-1 space-y-1.5">
                  <span className="block h-2 rounded-full bg-slate-400/30" />
                  <span className="block h-2 w-2/3 rounded-full bg-slate-400/18" />
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-5 text-center text-[11px] text-slate-500 dark:text-slate-400">
        Illustration only. Your dashboard shows your own live broker data.
      </p>
    </div>
  );
};
