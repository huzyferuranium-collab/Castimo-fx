import React from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Link2,
  Lock,
  Server,
  Share2,
  Shield,
  Sparkles,
  TrendingUp,
  UserPlus,
  Wallet,
  Zap,
} from 'lucide-react';
import { Reveal, CountUp } from './Reveal';
import { FAQSection } from './FAQSection';
import { HeroShowcase } from './HeroShowcase';
import { SilkBand } from './SilkBand';
import { ReferralTree } from './ReferralTree';
import { Orb } from './Shapes';

type Tab = 'client' | 'referrals' | 'admin';

interface LandingPageProps {
  onSelectTab: (tab: Tab) => void;
}

const heading = 'font-display font-extrabold tracking-tight text-slate-900 dark:text-white';
const muted = 'text-slate-600 dark:text-slate-400';

/** Brand colour tiles: each one gets a role in the palette, never a random colour. */
const TILE = {
  royal: 'from-sky-400 via-blue-500 to-blue-700 shadow-blue-500/30',
  violet: 'from-fuchsia-400 via-violet-500 to-purple-700 shadow-violet-500/30',
  ruby: 'from-rose-400 via-rose-500 to-red-700 shadow-rose-500/30',
  aqua: 'from-cyan-300 via-teal-400 to-sky-600 shadow-teal-500/30',
  gold: 'from-amber-200 via-yellow-400 to-amber-600 shadow-amber-500/30',
};

const Tile: React.FC<{ tone: keyof typeof TILE; children: React.ReactNode; size?: string }> = ({ tone, children, size = 'w-11 h-11' }) => (
  <span className={`${size} shrink-0 rounded-xl bg-gradient-to-br ${TILE[tone]} text-white flex items-center justify-center shadow-lg ring-1 ring-white/30 relative overflow-hidden`}>
    <span className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent" />
    <span className="relative">{children}</span>
  </span>
);

const SectionTitle: React.FC<{ eyebrow: string; title: React.ReactNode; sub?: string }> = ({ eyebrow, title, sub }) => (
  <div className="text-center max-w-2xl mx-auto space-y-2.5">
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
      <Sparkles className="w-3.5 h-3.5 text-rose-500 dark:text-rose-300" />
      {eyebrow}
    </span>
    <h2 className={`${heading} text-2xl sm:text-3xl leading-tight`}>{title}</h2>
    {sub && <p className={`${muted} text-sm leading-relaxed`}>{sub}</p>}
  </div>
);

/* ---------- trade path ---------- */
const FlowNode: React.FC<{ tone: keyof typeof TILE; icon: React.ReactNode; title: string; sub: string; pulse?: boolean }> = ({ tone, icon, title, sub, pulse }) => (
  <div className="surface rounded-2xl px-4 py-4 sm:px-5 text-center w-full sm:w-52">
    <div className={`mx-auto mb-2.5 w-fit ${pulse ? 'node-pulse rounded-xl' : ''}`}>
      <Tile tone={tone}>{icon}</Tile>
    </div>
    <div className="font-display font-bold text-sm text-slate-900 dark:text-white">{title}</div>
    <div className={`${muted} text-[11px] mt-0.5 leading-snug`}>{sub}</div>
  </div>
);

const FlowLine: React.FC = () => (
  <>
    <svg aria-hidden className="hidden sm:block h-6 w-16 lg:w-24 shrink-0 text-violet-500 dark:text-violet-300" viewBox="0 0 100 24" preserveAspectRatio="none">
      <path d="M0 12H100" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="flow-dash" />
    </svg>
    <svg aria-hidden className="sm:hidden h-9 w-6 text-violet-500 dark:text-violet-300" viewBox="0 0 24 36" preserveAspectRatio="none">
      <path d="M12 0V36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="flow-dash" />
    </svg>
  </>
);

const Bullet: React.FC<{ children: React.ReactNode; tone?: 'blue' | 'rose' }> = ({ children, tone = 'blue' }) => (
  <li className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
    <CheckCircle2 className={`w-4 h-4 mt-0.5 shrink-0 ${tone === 'rose' ? 'text-rose-500 dark:text-rose-300' : 'text-blue-600 dark:text-sky-300'}`} />
    <span>{children}</span>
  </li>
);

export const LandingPage: React.FC<LandingPageProps> = ({ onSelectTab }) => {
  return (
    <div className="space-y-16 sm:space-y-24 pb-6 overflow-x-clip">
      {/* ================= HERO ================= */}
      <section className="pt-6 sm:pt-12 space-y-8">
        <div className="text-center max-w-4xl mx-auto space-y-6">
          <Reveal>
            <span className="surface inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold text-slate-700 dark:text-slate-200">
              <span className="relative flex w-2 h-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-60 animate-ping" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-teal-500" />
              </span>
              Two ways to pay · 3-level referral program
            </span>
          </Reveal>

          <Reveal delay={80}>
            <h1 className={`${heading} text-[2.3rem] leading-[1.08] sm:text-5xl lg:text-6xl`}>
              Institutional MT5 copying,
              <br />
              <span className="text-grad-flame">priced your way.</span>
            </h1>
          </Reveal>

          <Reveal delay={160}>
            <p className={`${muted} text-base sm:text-lg max-w-2xl mx-auto leading-relaxed`}>
              A flat $100 a month, or nothing upfront and 50% of new profit. Your funds stay with your own broker.
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 pt-2">
              <button
                onClick={() => onSelectTab('client')}
                className="btn-gold px-7 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <TrendingUp className="w-4 h-4" />
                <span>Access Client Terminal</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => onSelectTab('referrals')}
                className="btn-ghost px-7 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <Share2 className="w-4 h-4 text-rose-500" />
                <span>Referral Hub (5% · 3% · 2%)</span>
              </button>
            </div>
          </Reveal>
        </div>

        <Reveal delay={300}>
          <HeroShowcase />
        </Reveal>

        <Reveal delay={120}>
          <div className="pt-6 flex flex-col sm:flex-row items-center justify-center gap-0 sm:gap-1">
            <FlowNode tone="royal" icon={<Server className="w-5 h-5" />} title="Master strategy" sub="Trades placed on the master account" />
            <FlowLine />
            <FlowNode tone="violet" icon={<Zap className="w-5 h-5" />} title="CASTIMOFx copier" sub="Lots scaled to your balance" pulse />
            <FlowLine />
            <FlowNode tone="aqua" icon={<Wallet className="w-5 h-5" />} title="Your MT5 account" sub="Funds stay with your broker" />
          </div>
        </Reveal>
      </section>

      {/* ================= TRUST STRIP ================= */}
      <section>
        <Reveal>
          <div className="surface rounded-2xl px-5 py-5 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
            {[
              { tone: 'royal' as const, icon: <Wallet className="w-4 h-4" />, t: 'Your funds, your broker', d: 'We never hold client deposits' },
              { tone: 'violet' as const, icon: <Lock className="w-4 h-4" />, t: 'USDT on TRON (TRC20)', d: 'Pay from any wallet' },
              { tone: 'aqua' as const, icon: <Clock className="w-4 h-4" />, t: 'No automatic charges', d: 'You choose when to renew' },
              { tone: 'gold' as const, icon: <Shield className="w-4 h-4" />, t: '$200 minimum equity', d: 'Checked once, at connection' },
            ].map((x) => (
              <div key={x.t} className="flex items-start gap-3">
                <Tile tone={x.tone} size="w-9 h-9">{x.icon}</Tile>
                <div>
                  <div className="text-[13px] font-bold text-slate-900 dark:text-white leading-tight">{x.t}</div>
                  <div className={`${muted} text-[11px] mt-0.5 leading-snug`}>{x.d}</div>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ================= PLANS ================= */}
      <section className="space-y-10">
        <Reveal>
          <SectionTitle
            eyebrow="Pricing"
            title={<>Two plans. <span className="text-grad-aqua">Pick what fits you.</span></>}
            sub="You are billed only under the plan you choose."
          />
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 lg:gap-7 max-w-5xl mx-auto">
          <Reveal>
            <div className="surface surface-hover rounded-3xl p-6 sm:p-8 h-full flex flex-col" style={{ ['--rim-accent' as string]: '56,189,248' }}>
              <div className="flex items-center gap-3">
                <Tile tone="royal" size="w-9 h-9"><Wallet className="w-4 h-4" /></Tile>
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700 dark:text-sky-300">Monthly Subscription</div>
              </div>
              <div className="mt-5 flex items-end gap-2">
                <span className={`${heading} text-5xl sm:text-6xl text-grad-aqua`}>
                  <CountUp to={100} prefix="$" />
                </span>
                <span className={`${muted} pb-2 text-sm`}>/ 30 days</span>
              </div>
              <p className={`${muted} text-sm mt-3`}>A flat price. No profit share on top.</p>
              <ul className="mt-6 space-y-3 flex-1">
                <Bullet>Paid up front in USDT (TRC20)</Bullet>
                <Bullet>Copying runs while your plan is active</Bullet>
                <Bullet>No automatic renewals — you renew when you wish</Bullet>
              </ul>
              <button
                onClick={() => onSelectTab('client')}
                className="btn-ghost mt-7 w-full px-5 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Start with Monthly</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="surface edge-gradient surface-hover rounded-3xl p-6 sm:p-8 h-full flex flex-col" style={{ ['--rim-accent' as string]: '244,63,94' }}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Tile tone="ruby" size="w-9 h-9"><Sparkles className="w-4 h-4" /></Tile>
                  <div className="text-xs font-bold uppercase tracking-[0.16em] text-rose-700 dark:text-rose-300">50% Profit Share</div>
                </div>
                <span className="badge-gold px-2.5 py-1 rounded-full text-[10px] font-extrabold">Nothing upfront</span>
              </div>
              <div className="mt-5 flex items-end gap-2">
                <span className="font-display font-extrabold tracking-tight text-5xl sm:text-6xl text-grad-flame">
                  <CountUp to={50} suffix="%" />
                </span>
                <span className={`${muted} pb-2 text-sm`}>of new profit only</span>
              </div>
              <p className={`${muted} text-sm mt-3`}>No new profit, no fee.</p>
              <ul className="mt-6 space-y-3 flex-1">
                <Bullet tone="rose">Fee applies only to profit above your previous high-water mark</Bullet>
                <Bullet tone="rose">Losses are recovered before any new fee is charged</Bullet>
                <Bullet tone="rose">Deposits and withdrawals never count as profit</Bullet>
                <Bullet tone="rose">Each invoice is payable within 24 hours in USDT (TRC20)</Bullet>
              </ul>
              <button
                onClick={() => onSelectTab('client')}
                className="btn-gold mt-7 w-full px-5 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Start with Profit Share</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ================= HOW IT WORKS ================= */}
      <section className="space-y-10">
        <Reveal>
          <SectionTitle eyebrow="How it works" title={<>Up and copying in <span className="text-grad-flame">four steps</span></>} />
        </Reveal>
        <div className="relative max-w-6xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { n: '01', tone: 'royal' as const, icon: <UserPlus className="w-5 h-5" />, t: 'Create your account', d: 'Sign up and confirm your email address.' },
              { n: '02', tone: 'violet' as const, icon: <Wallet className="w-5 h-5" />, t: 'Choose your plan', d: 'Monthly subscription or 50% profit share.' },
              { n: '03', tone: 'ruby' as const, icon: <Link2 className="w-5 h-5" />, t: 'Connect your MT5', d: 'Use your MT5 login and broker server.' },
              { n: '04', tone: 'aqua' as const, icon: <Zap className="w-5 h-5" />, t: 'Copying runs for you', d: 'Trades are mirrored with lots scaled to your balance.' },
            ].map((s, i) => (
              <Reveal key={s.n} delay={i * 90}>
                <div className="surface surface-hover rounded-2xl p-6 h-full">
                  <div className="flex items-center justify-between">
                    <Tile tone={s.tone} size="w-12 h-12">{s.icon}</Tile>
                    <span className="font-mono text-xs font-bold text-slate-400 dark:text-slate-500">{s.n}</span>
                  </div>
                  <h3 className="font-display font-bold text-base mt-5 text-slate-900 dark:text-white">{s.t}</h3>
                  <p className={`${muted} text-sm mt-1.5 leading-relaxed`}>{s.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= REFERRALS ================= */}
      <section className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
        <Reveal>
          <div className="space-y-5 text-center lg:text-left">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-rose-700 dark:text-rose-300">
              <Share2 className="w-3.5 h-3.5" />
              Referral program
            </span>
            <h2 className={`${heading} text-2xl sm:text-4xl leading-tight`}>
              <span className="text-grad-flame">3-Tier</span> Commissions
            </h2>
            <p className={`${muted} text-sm sm:text-base leading-relaxed max-w-lg mx-auto lg:mx-0`}>
              Share your link and earn USDT on what your network pays, across three levels. Only verified payments count.
            </p>
            <div className="flex flex-wrap justify-center lg:justify-start gap-3 pt-1">
              {[
                { l: 'Level 1', p: 5, c: 'from-rose-500 to-red-600' },
                { l: 'Level 2', p: 3, c: 'from-fuchsia-500 to-violet-600' },
                { l: 'Level 3', p: 2, c: 'from-sky-500 to-blue-700' },
              ].map((t) => (
                <span key={t.l} className={`inline-flex items-center gap-2 pl-1 pr-3.5 py-1 rounded-full text-xs font-bold text-slate-800 dark:text-slate-100 surface`}>
                  <span className={`px-2 py-0.5 rounded-full bg-gradient-to-r ${t.c} text-white font-mono`}>
                    <CountUp to={t.p} suffix="%" duration={900} />
                  </span>
                  {t.l}
                </span>
              ))}
            </div>
            <p className={`${muted} text-xs leading-relaxed max-w-lg mx-auto lg:mx-0`}>
              Withdrawals from $50, 10% fee. Requests before Thursday 23:59 GMT join that week's cycle.
            </p>
            <div className="pt-1">
              <button
                onClick={() => onSelectTab('referrals')}
                className="btn-red px-6 py-3 rounded-xl font-bold text-sm inline-flex items-center gap-2 cursor-pointer"
              >
                <span>Open the Referral Hub</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="surface rounded-3xl p-5 sm:p-7" style={{ ['--rim-accent' as string]: '244,63,94' }}>
            <ReferralTree className="w-full h-auto text-slate-500 dark:text-slate-300" />
            <p className={`${muted} text-[11px] text-center mt-2`}>You at the top; each level pays on verified payments.</p>
          </div>
        </Reveal>
      </section>

      {/* ================= FAQ ================= */}
      <FAQSection onSelectTab={onSelectTab} hideCta />

      {/* ================= CLOSING CALL TO ACTION ================= */}
      <section>
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl surface px-6 py-10 sm:px-12 sm:py-12" style={{ ['--rim-accent' as string]: '168,85,247' }}>
            <SilkBand className="absolute inset-0 w-full h-full opacity-70 dark:opacity-90" />
            <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-white via-white/80 to-transparent dark:from-black dark:via-black/70 dark:to-transparent" />
            <Orb size={70} from="#ffd0d8" mid="#f43f5e" to="#7f1034" className="absolute right-8 top-6 animate-float-a hidden sm:block drop-shadow-[0_14px_22px_rgba(225,29,72,.45)]" />
            <div className="relative max-w-xl space-y-4">
              <h2 className={`${heading} text-2xl sm:text-3xl leading-tight`}>
                Ready when <span className="text-grad-flame">you are.</span>
              </h2>
              <p className={`${muted} text-sm sm:text-base leading-relaxed`}>
                Connect your broker account, or share your referral link.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button onClick={() => onSelectTab('client')} className="btn-gold px-7 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer">
                  <TrendingUp className="w-4 h-4" />
                  <span>Client Terminal</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button onClick={() => onSelectTab('referrals')} className="btn-ghost px-7 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer">
                  <Share2 className="w-4 h-4 text-rose-500" />
                  <span>Referral Hub</span>
                </button>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
};
