import React from 'react';
import { REFERRAL_RATES_PCT } from '../../backend/referrals';

/**
 * "3D layered glass stack" for the 3-tier referral programme: three frosted glass cards stacked
 * diagonally in perspective (Level 1 on top, Level 3 at the bottom).
 *
 *  - Self-contained: the styles live in the <style> tag below, under the `rgs-` prefix, so the file
 *    can be dropped into any React + Tailwind project (no extra CSS file, no libraries).
 *  - The percentages come from the real referral settings (REFERRAL_RATES_PCT). Nothing here is live
 *    data: it explains the structure only.
 *  - Hover (or keyboard focus on a card's area) lifts a card and brightens its glow.
 *  - Below 640px the 3D scene becomes a flat stack of cards; reduced-motion visitors get no transitions.
 *  - Dark is the default look; `html.light` gets a clean, bright variant.
 *  - The only blurred layers are the three cards themselves (backdrop-filter), over a static backdrop.
 *    Nothing animates on its own.
 */

const TIERS = [
  { level: 1, tone: 'coral', title: 'Level 1 Commission', sub: 'Direct Referrals' },
  { level: 2, tone: 'violet', title: 'Level 2 Commission', sub: 'Tier 2 Referrals' },
  { level: 3, tone: 'cyan', title: 'Level 3 Commission', sub: 'Tier 3 Referrals' },
] as const;

const CSS = `
.rgs { width: 100%; }
.rgs-stage {
  position: relative; height: 340px; overflow: hidden; border-radius: 1.25rem; isolation: isolate;
}
/* backdrop: a faint grid that fades out towards the edges, plus three soft colour glows */
.rgs-grid {
  position: absolute; inset: 0; z-index: 0;
  background-image:
    linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px);
  background-size: 30px 30px;
  -webkit-mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, #000 25%, transparent 78%);
          mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, #000 25%, transparent 78%);
}
.rgs-glow { position: absolute; z-index: 0; border-radius: 9999px; pointer-events: none; }
.rgs-glow-a { width: 55%; height: 62%; left: 6%;  top: -6%;  background: radial-gradient(closest-side, rgba(255,92,80,.30),  transparent); }
.rgs-glow-b { width: 55%; height: 62%; left: 24%; top: 22%;  background: radial-gradient(closest-side, rgba(168,85,247,.30), transparent); }
.rgs-glow-c { width: 55%; height: 62%; right: 2%; bottom: -8%; background: radial-gradient(closest-side, rgba(34,211,238,.28), transparent); }

.rgs-stack { position: absolute; inset: 0; z-index: 1; margin: 0; padding: 0; list-style: none; }

.rgs-card {
  --lift: 0px;
  position: absolute; left: 50%; top: 58%; width: 280px; height: 148px; margin: -74px 0 0 -140px;
  padding: 16px 22px 0; border-radius: 20px;
  display: flex; flex-direction: column; justify-content: flex-start; gap: 2px;
  color: #fff; cursor: default; overflow: hidden;
  background:
    linear-gradient(135deg, rgba(var(--c), .20), rgba(var(--c), .04) 55%, rgba(255,255,255,.03)),
    rgba(14, 14, 20, .42);
  border: 1px solid rgba(var(--c), .55);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.22),
    inset 0 0 0 1px rgba(var(--c), .12),
    0 0 30px rgba(var(--c), .24),
    0 34px 46px -22px rgba(0,0,0,.7);
  -webkit-backdrop-filter: blur(14px) saturate(1.3);
          backdrop-filter: blur(14px) saturate(1.3);
  transform: perspective(1500px) rotateX(56deg) rotateZ(-34deg) translate3d(var(--x), var(--y), calc(var(--z) + var(--lift)));
  transition: transform .45s cubic-bezier(.2,.8,.2,1), box-shadow .45s ease, border-color .45s ease;
}
/* a bright edge and a soft sheen across the glass */
.rgs-card::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background: linear-gradient(115deg, rgba(255,255,255,.16) 0%, rgba(255,255,255,0) 38%);
}
.rgs-card::after {
  content: ''; position: absolute; left: 14px; right: 14px; top: 0; height: 1px; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(var(--c), .95), transparent);
}
.rgs-card:hover {
  --lift: 30px; z-index: 5;
  border-color: rgba(var(--c), .95);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.32),
    inset 0 0 0 1px rgba(var(--c), .25),
    0 0 52px rgba(var(--c), .5),
    0 44px 56px -24px rgba(0,0,0,.75);
}
.rgs-coral  { --c: 255, 92, 80;  --x: -40px; --y: -44px; --z: 130px; z-index: 3; }
.rgs-violet { --c: 168, 85, 247; --x: 0px;   --y: 4px;   --z: 65px;  z-index: 2; }
.rgs-cyan   { --c: 34, 211, 238; --x: 44px;  --y: 52px;  --z: 0px;   z-index: 1; }

.rgs-pct {
  position: relative; font-size: 46px; line-height: 1; font-weight: 800; letter-spacing: -.02em;
  background: linear-gradient(180deg, #fff 30%, rgba(var(--c), 1) 135%);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
}
.rgs-title { position: relative; margin-top: 6px; font-size: 14px; font-weight: 700; color: #fff; }
.rgs-sub   { position: relative; font-size: 11.5px; font-weight: 600; letter-spacing: .02em; color: rgba(var(--c), 1); }

/* browsers without backdrop-filter get a slightly denser glass instead of a blur */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .rgs-card { background: linear-gradient(135deg, rgba(var(--c), .22), rgba(var(--c), .06) 55%), rgba(14, 14, 20, .82); }
}

/* ---- light theme: bright frosted glass ---- */
html.light .rgs-grid {
  background-image:
    linear-gradient(rgba(76,29,149,.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(76,29,149,.07) 1px, transparent 1px);
}
html.light .rgs-glow-a { background: radial-gradient(closest-side, rgba(255,92,80,.22),  transparent); }
html.light .rgs-glow-b { background: radial-gradient(closest-side, rgba(168,85,247,.22), transparent); }
html.light .rgs-glow-c { background: radial-gradient(closest-side, rgba(34,211,238,.22), transparent); }
html.light .rgs-card {
  color: #0f172a;
  background:
    linear-gradient(135deg, rgba(var(--c), .16), rgba(var(--c), .04) 55%, rgba(255,255,255,.4)),
    rgba(255, 255, 255, .62);
  border-color: rgba(var(--c), .5);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.9),
    0 0 26px rgba(var(--c), .2),
    0 26px 38px -20px rgba(var(--c), .5);
}
html.light .rgs-card:hover {
  border-color: rgba(var(--c), .9);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.95), 0 0 44px rgba(var(--c), .4), 0 36px 48px -22px rgba(var(--c), .6);
}
html.light .rgs-pct { background: linear-gradient(180deg, #0f172a 25%, rgb(var(--c)) 150%); -webkit-background-clip: text; background-clip: text; }
html.light .rgs-title { color: #0f172a; }
html.light .rgs-sub { color: rgb(var(--c)); filter: saturate(1.1) brightness(.78); }

/* ---- small screens: a flat stack of cards, no 3D ---- */
@media (max-width: 639px) {
  .rgs-stage { height: auto; padding: 18px 12px; }
  .rgs-stack { position: relative; inset: auto; display: flex; flex-direction: column; gap: 12px; }
  .rgs-card {
    position: relative; left: auto; top: auto; width: auto; height: auto; margin: 0; padding: 16px 20px;
    transform: none; display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto;
    column-gap: 14px; row-gap: 0; align-content: center; align-items: center;
  }
  .rgs-card:hover { --lift: 0px; transform: translateY(-3px); z-index: auto; }
  .rgs-card:nth-child(2) { margin-left: 10px; }
  .rgs-card:nth-child(3) { margin-left: 20px; }
  .rgs-pct { font-size: 36px; grid-row: 1 / span 2; min-width: 1.9em; }
  .rgs-title { margin-top: 0; align-self: end; }
  .rgs-sub { align-self: start; }
}
@media (prefers-reduced-motion: reduce) {
  .rgs-card { transition: none; }
}
`;

export const ReferralGlassStack: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`rgs ${className}`}>
    <style>{CSS}</style>
    <div className="rgs-stage" role="group" aria-label="The three referral commission levels">
      <div className="rgs-grid" aria-hidden="true" />
      <div className="rgs-glow rgs-glow-a" aria-hidden="true" />
      <div className="rgs-glow rgs-glow-b" aria-hidden="true" />
      <div className="rgs-glow rgs-glow-c" aria-hidden="true" />
      <ul className="rgs-stack">
        {TIERS.map((t) => (
          <li key={t.level} className={`rgs-card rgs-${t.tone}`}>
            <div className="rgs-pct">{REFERRAL_RATES_PCT[t.level - 1]}%</div>
            <div className="rgs-title">{t.title}</div>
            <div className="rgs-sub">{t.sub}</div>
          </li>
        ))}
      </ul>
    </div>
  </div>
);
