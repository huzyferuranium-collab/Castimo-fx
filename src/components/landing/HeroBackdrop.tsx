export type BackdropVariant = 'landing' | 'client' | 'referrals' | 'admin';

/** Each page gets its own colour mood from the same palette. Soft light only: no grid, no lines. */
const MOODS: Record<BackdropVariant, [string, string, string, string]> = {
  landing: ['rgba(244,63,94,.24)', 'rgba(124,58,237,.26)', 'rgba(47,75,219,.26)', 'rgba(217,70,239,.18)'],
  client: ['rgba(47,75,219,.30)', 'rgba(225,29,72,.18)', 'rgba(34,211,238,.16)', 'rgba(168,85,247,.20)'],
  referrals: ['rgba(244,63,94,.26)', 'rgba(217,70,239,.22)', 'rgba(228,195,94,.14)', 'rgba(47,75,219,.16)'],
  admin: ['rgba(124,58,237,.26)', 'rgba(47,75,219,.24)', 'rgba(195,201,212,.12)', 'rgba(217,70,239,.16)'],
};

/** Slow, drifting colour fields (fixed behind the page). */
export default function HeroBackdrop({ variant = 'landing' }: { variant?: BackdropVariant }) {
  const [a, b, c, d] = MOODS[variant];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-32 -top-40 size-[620px] rounded-full blur-[80px] animate-blob-a opacity-60 dark:opacity-100" style={{ background: `radial-gradient(closest-side, ${a}, transparent)` }} />
      <div className="absolute -right-40 top-40 size-[700px] rounded-full blur-[80px] animate-blob-b opacity-60 dark:opacity-100" style={{ background: `radial-gradient(closest-side, ${b}, transparent)` }} />
      <div className="absolute -bottom-56 left-1/4 size-[620px] rounded-full blur-[80px] animate-blob-a opacity-60 dark:opacity-100 [animation-delay:-16s]" style={{ background: `radial-gradient(closest-side, ${c}, transparent)` }} />
      <div className="absolute right-1/4 -bottom-40 size-[480px] rounded-full blur-[80px] animate-blob-b opacity-50 dark:opacity-100 [animation-delay:-8s]" style={{ background: `radial-gradient(closest-side, ${d}, transparent)` }} />
    </div>
  );
}
