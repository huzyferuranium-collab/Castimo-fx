export type BackdropVariant = 'landing' | 'client' | 'referrals' | 'admin';

/** Each page gets its own colour mood from the same palette. */
const MOODS: Record<BackdropVariant, [string, string, string, string]> = {
  landing: ['rgba(244,63,94,.20)', 'rgba(124,58,237,.22)', 'rgba(47,75,219,.22)', 'rgba(56,189,248,.16)'],
  client: ['rgba(47,75,219,.24)', 'rgba(56,189,248,.16)', 'rgba(34,211,238,.12)', 'rgba(124,58,237,.12)'],
  referrals: ['rgba(244,63,94,.20)', 'rgba(168,85,247,.18)', 'rgba(228,195,94,.12)', 'rgba(47,75,219,.12)'],
  admin: ['rgba(124,58,237,.22)', 'rgba(47,75,219,.20)', 'rgba(195,201,212,.10)', 'rgba(168,85,247,.12)'],
};

/** Slow, decorative background (fixed behind the page). */
export default function HeroBackdrop({ variant = 'landing' }: { variant?: BackdropVariant }) {
  const [a, b, c, d] = MOODS[variant];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-32 -top-40 size-[560px] rounded-full blur-[70px] animate-blob-a opacity-60 dark:opacity-100" style={{ background: `radial-gradient(closest-side, ${a}, transparent)` }} />
      <div className="absolute -right-40 top-48 size-[640px] rounded-full blur-[70px] animate-blob-b opacity-60 dark:opacity-100" style={{ background: `radial-gradient(closest-side, ${b}, transparent)` }} />
      <div className="absolute -bottom-56 left-1/4 size-[560px] rounded-full blur-[70px] animate-blob-a opacity-60 dark:opacity-100 [animation-delay:-16s]" style={{ background: `radial-gradient(closest-side, ${c}, transparent)` }} />
      <div className="absolute right-1/4 -bottom-40 size-[420px] rounded-full blur-[70px] animate-blob-b opacity-50 dark:opacity-100 [animation-delay:-8s]" style={{ background: `radial-gradient(closest-side, ${d}, transparent)` }} />

      <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_35%,#000_30%,transparent_80%)]">
        <svg className="absolute -inset-12 h-[calc(100%+96px)] w-[calc(100%+96px)] animate-grid-drift">
          <defs>
            <pattern id="hero-grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M48 0H0V48" fill="none" style={{ stroke: 'var(--grid-line)' }} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#hero-grid)" />
        </svg>
      </div>

      {variant === 'landing' && (
        <svg className="absolute bottom-0 left-0 h-[340px] w-full" viewBox="0 0 1440 340" preserveAspectRatio="none">
          <defs>
            <linearGradient id="hero-line" x1="0" x2="1">
              <stop offset="0" stopColor="#38bdf8" stopOpacity="0" />
              <stop offset=".35" stopColor="#6b86ff" stopOpacity=".7" />
              <stop offset=".7" stopColor="#c084fc" stopOpacity=".7" />
              <stop offset="1" stopColor="#fb7185" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M0 260 C240 150 420 330 720 220 S1200 120 1440 200" fill="none" stroke="url(#hero-line)" strokeWidth="1.4" strokeDasharray="2 14" className="animate-line-flow" />
          <path d="M0 300 C300 210 520 340 800 270 S1220 190 1440 250" fill="none" stroke="url(#hero-line)" strokeWidth="1.1" strokeDasharray="2 18" className="animate-line-flow [animation-duration:20s]" />
        </svg>
      )}
    </div>
  );
}
