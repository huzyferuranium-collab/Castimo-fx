/** Slow, decorative background for the landing hero (dark theme only). */
export default function HeroBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 hidden overflow-hidden dark:block">
      <div className="absolute -left-32 -top-40 size-[560px] rounded-full blur-[60px] animate-blob-a bg-[radial-gradient(closest-side,rgba(45,212,191,.24),transparent)]" />
      <div className="absolute -right-40 top-64 size-[620px] rounded-full blur-[60px] animate-blob-b bg-[radial-gradient(closest-side,rgba(56,189,248,.17),transparent)]" />
      <div className="absolute -bottom-56 left-1/3 size-[520px] rounded-full blur-[60px] animate-blob-a [animation-delay:-16s] bg-[radial-gradient(closest-side,rgba(74,222,128,.15),transparent)]" />

      <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_35%,#000_30%,transparent_80%)]">
        <svg className="absolute -inset-12 h-[calc(100%+96px)] w-[calc(100%+96px)] animate-grid-drift">
          <defs>
            <pattern id="hero-grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M48 0H0V48" fill="none" stroke="rgba(148,163,184,.11)" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#hero-grid)" />
        </svg>
      </div>

      <svg className="absolute bottom-0 left-0 h-[340px] w-full" viewBox="0 0 1440 340" preserveAspectRatio="none">
        <defs>
          <linearGradient id="hero-line" x1="0" x2="1">
            <stop offset="0" stopColor="#2dd4bf" stopOpacity="0" />
            <stop offset=".5" stopColor="#67e8f9" stopOpacity=".7" />
            <stop offset="1" stopColor="#4ade80" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0 260 C240 150 420 330 720 220 S1200 120 1440 200" fill="none" stroke="url(#hero-line)" strokeWidth="1.4" strokeDasharray="2 14" className="animate-line-flow" />
        <path d="M0 300 C300 210 520 340 800 270 S1220 190 1440 250" fill="none" stroke="url(#hero-line)" strokeWidth="1.1" strokeDasharray="2 18" className="animate-line-flow [animation-duration:20s]" />
      </svg>
    </div>
  );
}
