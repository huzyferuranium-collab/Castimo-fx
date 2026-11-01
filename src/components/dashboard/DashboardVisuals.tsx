import React, { useId } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Orb, Cube, Ring, Coin } from '../landing/Shapes';
import { AnimatedNumber } from '../common/AnimatedNumber';
import { ART, ArtName } from './Illustrations';

/** Colour roles from the brand palette (#F52236 crimson, #1746D2 royal, #176BFF electric, #38BDF8 sky,
 *  #06D6E9 cyan, #853BFF violet, #E83EFF magenta, #08C9B5 turquoise, #E9BE62 gold). */
export const TONES = {
  royal: 'from-brand-sky via-brand-electric to-brand-royal',
  violet: 'from-brand-magenta via-brand-violet to-brand-royal',
  ruby: 'from-[#ff7a86] via-brand-crimson to-[#b5122c]',
  magenta: 'from-[#ff8ee8] via-brand-magenta to-brand-violet',
  aqua: 'from-brand-cyan via-brand-sky to-brand-electric',
  mint: 'from-[#6cf0dd] via-brand-turquoise to-brand-cyan',
  gold: 'from-[#f6dfa6] via-brand-gold to-[#b98e2c]',
} as const;
export type Tone = keyof typeof TONES;

/** Accent colour (r,g,b) that tints a card's glow. */
const GLOW: Record<Tone, string> = {
  royal: '23,107,255',
  violet: '133,59,255',
  ruby: '245,34,54',
  magenta: '232,62,255',
  aqua: '6,214,233',
  mint: '8,201,181',
  gold: '233,190,98',
};

export const IconTile: React.FC<{ tone: Tone; children: React.ReactNode; size?: string }> = ({ tone, children, size = 'w-11 h-11' }) => (
  <span className={`${size} shrink-0 rounded-2xl bg-gradient-to-br ${TONES[tone]} text-white flex items-center justify-center shadow-lg ring-1 ring-white/30 relative overflow-hidden`}>
    <span className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/35 to-transparent" />
    <span className="relative [&_*]:!text-white">{children}</span>
  </span>
);

/* ------------------------------------------------------------------ welcome banner */
export interface WelcomeHeroProps {
  name: string;
  state: 'connected' | 'connecting' | 'failed' | 'disconnected';
  headline: string;
  detail: string;
  chips: Array<{ label: string; pulse?: boolean }>;
  primary?: { label: string; onClick: () => void; icon?: React.ReactNode };
  secondary?: { label: string; onClick: () => void };
  /** Bell / notification control, rendered top-right. */
  topRight?: React.ReactNode;
}

export const WelcomeHero: React.FC<WelcomeHeroProps> = ({ name, headline, detail, chips, primary, secondary, topRight }) => (
  <section className="aurora on-aurora relative overflow-hidden rounded-[24px] sm:rounded-[34px] p-4 sm:p-9">
    {/* floating 3D-style shapes: a full scene from sm up, a small cluster beside the bell on phones */}
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden sm:block">
      <Orb size={118} from="#ffe1e7" mid="#ff5a6b" to="#a00a1f" className="absolute right-[34%] -top-5 animate-float-a" />
      <Cube size={112} top="#f5d0fe" left="#853bff" right="#3a1590" className="absolute right-[19%] top-[72px] animate-float-b" />
      <Ring size={176} a="#06d6e9" b="#e83eff" className="absolute right-[3%] bottom-0 animate-float-c opacity-95" />
      <Coin size={60} className="absolute right-[44%] bottom-5 animate-float-a" />
      <Orb size={42} from="#e0f2fe" mid="#38bdf8" to="#1746d2" className="absolute right-[2%] top-[42%] animate-float-c" />
    </div>
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 sm:hidden">
      <Orb size={44} from="#ffe1e7" mid="#ff5a6b" to="#a00a1f" className="absolute right-[80px] top-3 animate-float-a" />
      <Cube size={38} top="#f5d0fe" left="#853bff" right="#3a1590" className="absolute right-[126px] top-9 animate-float-b" />
      <Coin size={30} className="hidden min-[360px]:block absolute right-[166px] top-4 animate-float-c" />
    </div>

    <div className="relative flex items-start justify-between gap-4">
      <p className="text-xs sm:text-sm font-semibold tracking-wide on-aurora-soft inline-flex items-center gap-1.5">
        <Sparkles className="w-4 h-4" /> Welcome back
      </p>
      {topRight && <div className="shrink-0 rounded-2xl bg-white/15 px-1 py-0.5 [&_button]:!bg-white/15 [&_button]:!shadow-none">{topRight}</div>}
    </div>

    <div className="relative mt-2 max-w-xl sm:max-w-[56%] lg:max-w-xl">
      <h1 className="font-display font-extrabold tracking-tight text-2xl sm:text-4xl leading-[1.1] break-words">{name}</h1>
      <p className="mt-2 sm:mt-3 text-[15px] sm:text-lg font-bold leading-snug">{headline}</p>
      <p className="mt-1 sm:mt-1.5 text-[13px] sm:text-sm on-aurora-soft leading-relaxed">{detail}</p>

      <div className="mt-3 sm:mt-4 flex flex-wrap gap-1.5 sm:gap-2">
        {chips.map((c) => (
          <span key={c.label} className="inline-flex items-center gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full bg-white/15 text-[11px] sm:text-xs font-bold">
            {c.pulse && (
              <span className="relative flex w-2 h-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-70 animate-ping" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-white" />
              </span>
            )}
            {c.label}
          </span>
        ))}
      </div>

      {(primary || secondary) && (
        <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row gap-2 sm:gap-3">
          {primary && (
            <button
              type="button"
              onClick={primary.onClick}
              className="keep-ink btn-gold group px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl font-extrabold text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              <span className="flex items-center gap-2">
                {primary.icon}
                {primary.label}
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </span>
            </button>
          )}
          {secondary && (
            <button
              type="button"
              onClick={secondary.onClick}
              className="px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl bg-white/15 hover:bg-white/25 font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer"
            >
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  </section>
);

/* ------------------------------------------------------------------ stat card */
export const StatCard: React.FC<{
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  value: number;
  prefix?: string;
  signed?: boolean;
  valueClass?: string;
  footer?: React.ReactNode;
  /** 0..1 share shown as a slim gradient bar (only when it is computed from real numbers). */
  share?: number | null;
  /** Decorative illustration (no data), shown from the sm breakpoint up. */
  art?: ArtName;
  decimals?: number;
  /** On phones, lay the card out as one wide row (picture left, label over value). Use it when a card is full width. */
  rowOnPhone?: boolean;
}> = ({ tone, icon, label, value, prefix = '$', signed, valueClass = '', footer, share, art, decimals, rowOnPhone }) => {
  const Art = art ? ART[art] : null;
  const row = !!rowOnPhone;
  return (
  <div
    className={`group relative overflow-hidden rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-900 p-3.5 sm:p-5 border border-transparent surface-hover flex flex-col ${
      row ? 'max-sm:grid max-sm:grid-cols-[2.75rem_minmax(0,1fr)] max-sm:items-center max-sm:gap-x-3 max-sm:py-3' : ''
    }`}
    style={{ ['--rim-accent' as string]: GLOW[tone] }}
  >
    <div aria-hidden className={`absolute -right-8 -top-8 w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-gradient-to-br ${TONES[tone]} opacity-40 bloom`} />
    <div className={`relative flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-3 ${row ? 'max-sm:contents' : ''}`}>
      {Art ? (
        <Art
          size={60}
          className={`shrink-0 -ml-1 -my-0.5 w-10 h-10 sm:w-[60px] sm:h-[60px] sm:-ml-1.5 group-hover:animate-float-c ${row ? 'max-sm:w-11 max-sm:h-11 max-sm:col-start-1 max-sm:row-start-1 max-sm:row-span-3' : ''}`}
        />
      ) : (
        <IconTile tone={tone} size={`w-8 h-8 sm:w-10 sm:h-10 ${row ? 'max-sm:col-start-1 max-sm:row-start-1 max-sm:row-span-3' : ''}`}>{icon}</IconTile>
      )}
      <span className={`text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.1em] sm:tracking-[0.14em] text-slate-500 dark:text-slate-400 ${row ? 'max-sm:col-start-2 max-sm:row-start-1' : ''}`}>{label}</span>
    </div>
    <div
      className={`relative mt-auto pt-2 sm:pt-0 sm:mt-4 font-display font-extrabold tracking-tight text-xl sm:text-3xl text-slate-900 dark:text-white ${
        row ? 'max-sm:col-start-2 max-sm:row-start-2 max-sm:mt-0 max-sm:pt-0' : ''
      } ${valueClass}`}
    >
      <AnimatedNumber value={value} prefix={prefix} signed={signed} decimals={decimals} />
    </div>
    {share != null && (
      <div className={`relative mt-2 sm:mt-3 h-1.5 rounded-full bg-slate-400/15 overflow-hidden ${row ? 'max-sm:col-start-2' : ''}`}>
        <div className={`h-full rounded-full bg-gradient-to-r ${TONES[tone]} transition-[width] duration-1000`} style={{ width: `${Math.max(2, Math.min(100, share * 100))}%` }} />
      </div>
    )}
    {footer && <div className={`relative mt-1.5 sm:mt-3 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 ${row ? 'max-sm:col-start-2' : ''}`}>{footer}</div>}
  </div>
  );
};

/* ------------------------------------------------------------------ progress ring */
export const ProgressRing: React.FC<{ value: number; size?: number; children?: React.ReactNode }> = ({ value, size = 112, children }) => {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" aria-hidden>
        <defs>
          <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f52236" />
            <stop offset=".5" stopColor="#853bff" />
            <stop offset="1" stopColor="#06d6e9" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(148,163,184,.2)" strokeWidth="10" />
        <circle cx="50" cy="50" r="40" fill="none" stroke={`url(#${id}g)`} strokeWidth="10" strokeLinecap="round" pathLength={1} strokeDasharray={`${v} 1`} className="transition-[stroke-dasharray] duration-1000" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
};

/* ------------------------------------------------------------------ action card */
export const ActionCard: React.FC<{ tone: Tone; icon: React.ReactNode; title: string; hint: string; onClick: () => void; art?: ArtName; className?: string }> = ({ tone, icon, title, hint, onClick, art, className = '' }) => {
  const Art = art ? ART[art] : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-900 p-3 sm:p-5 sm:min-h-[96px] text-left cursor-pointer surface-hover border border-transparent ${className}`}
      style={{ ['--rim-accent' as string]: GLOW[tone] }}
    >
      <div aria-hidden className={`absolute -right-6 -bottom-8 w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-gradient-to-br ${TONES[tone]} opacity-35 bloom group-hover:opacity-60 transition-opacity`} />
      {Art && <Art size={84} className="hidden sm:block absolute -right-2 -bottom-3 group-hover:animate-float-c pointer-events-none transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3" />}
      {Art && <Art size={46} className="sm:hidden absolute right-1.5 top-1.5 pointer-events-none" />}
      {/* phones: icon above the words, so two cards fit side by side; sm and up: icon beside the words */}
      <div className="relative flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3 sm:pr-20">
        <IconTile tone={tone} size="w-9 h-9 sm:w-11 sm:h-11">{icon}</IconTile>
        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-[13px] sm:text-sm text-slate-900 dark:text-white">{title}</div>
          <div className="text-[10.5px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{hint}</div>
        </div>
        {!Art && <ArrowRight className="hidden sm:block w-4 h-4 text-slate-400 transition-transform group-hover:translate-x-1" />}
      </div>
    </button>
  );
};

/* ------------------------------------------------------------------ section banner (every page after the overview) */
export const SectionBanner: React.FC<{
  tone: Tone;
  art?: ArtName;
  title: string;
  subtitle?: string;
  chip?: string;
  right?: React.ReactNode;
}> = ({ tone, art, title, subtitle, chip, right }) => {
  const Art = art ? ART[art] : null;
  return (
    <div
      className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-900 p-4 sm:p-6 flex items-center justify-between gap-3 sm:gap-4"
      style={{ ['--rim-accent' as string]: GLOW[tone] }}
    >
      <div aria-hidden className={`absolute -right-12 -top-16 w-64 h-64 rounded-full bg-gradient-to-br ${TONES[tone]} opacity-[0.38] bloom`} />
      <div aria-hidden className={`absolute -left-10 -bottom-20 w-52 h-52 rounded-full bg-gradient-to-tr ${TONES[tone]} opacity-[0.20] bloom`} />
      <div className="relative min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="font-display font-extrabold tracking-tight text-xl sm:text-2xl text-slate-900 dark:text-white">{title}</h1>
          {chip && (
            <span className="text-[10px] font-mono font-bold px-2.5 py-1 rounded-full bg-slate-500/10 text-slate-700 dark:text-slate-300 shrink-0">{chip}</span>
          )}
        </div>
        {subtitle && <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">{subtitle}</p>}
      </div>
      <div className="relative flex items-center gap-2 sm:gap-4 shrink-0">
        {Art && (
          <>
            <Art size={52} className="min-[440px]:hidden animate-float-a" />
            <Art size={80} className="hidden min-[440px]:block animate-float-a" />
          </>
        )}
        {right}
      </div>
    </div>
  );
};
