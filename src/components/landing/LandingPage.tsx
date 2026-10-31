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

type Tab = 'client' | 'referrals' | 'admin';

interface LandingPageProps {
  onSelectTab: (tab: Tab) => void;
}

const heading = 'font-display font-extrabold tracking-tight text-slate-900 dark:text-white';
const muted = 'text-slate-600 dark:text-slate-400';

const SectionTitle: React.FC<{ eyebrow: string; title: React.ReactNode; sub?: string }> = ({ eyebrow, title, sub }) => (
  <div className="text-center max-w-2xl mx-auto space-y-3">
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
      <Sparkles className="w-3.5 h-3.5" />
      {eyebrow}
    </span>
    <h2 className={`${heading} text-3xl sm:text-4xl leading-tight`}>{title}</h2>
    {sub && <p className={`${muted} text-sm sm:text-base leading-relaxed`}>{sub}</p>}
  </div>
);

/* ---------- Hero diagram: how a trade travels (structure only, no figures) ---------- */
const FlowNode: React.FC<{ icon: React.ReactNode; title: string; sub: string; pulse?: boolean }> = ({ icon, title, sub, pulse }) => (
  <div className="surface rounded-2xl px-4 py-4 sm:px-5 text-center w-full sm:w-52">
    <div className={`mx-auto mb-2.5 w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-slate-950 flex items-center justify-center ${pulse ? 'node-pulse' : ''}`}>
      {icon}
    </div>
    <div className="font-display font-bold text-sm text-slate-900 dark:text-white">{title}</div>
    <div className={`${muted} text-[11px] mt-0.5 leading-snug`}>{sub}</div>
  </div>
);

const FlowLine: React.FC = () => (
  <>
    {/* horizontal on wide screens */}
    <svg aria-hidden className="hidden sm:block h-6 w-16 lg:w-24 shrink-0 text-teal-500 dark:text-teal-300" viewBox="0 0 100 24" preserveAspectRatio="none">
      <path d="M0 12H100" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="flow-dash" />
    </svg>
    {/* vertical on phones */}
    <svg aria-hidden className="sm:hidden h-9 w-6 text-teal-500 dark:text-teal-300" viewBox="0 0 24 36" preserveAspectRatio="none">
      <path d="M12 0V36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="flow-dash" />
    </svg>
  </>
);

/* ---------- Plans ---------- */
const Bullet: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <li className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
    <span>{children}</span>
  </li>
);

export const LandingPage: React.FC<LandingPageProps> = ({ onSelectTab }) => {
  return (
    <div className="space-y-20 sm:space-y-28 pb-6">
      {/* ================= HERO ================= */}
      <section className="pt-6 sm:pt-12 text-center max-w-4xl mx-auto space-y-6">
        <Reveal>
          <span className="surface inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold text-emerald-800 dark:text-emerald-300">
            <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
            </span>
            Two ways to pay · 3-level referral program
          </span>
        </Reveal>

        <Reveal delay={80}>
          <h1 className={`${heading} text-[2.6rem] leading-[1.05] sm:text-6xl lg:text-7xl`}>
            Institutional MT5 copying,
            <br />
            <span className="text-electric-soft">priced your way.</span>
          </h1>
        </Reveal>

        <Reveal delay={160}>
          <p className={`${muted} text-base sm:text-lg max-w-2xl mx-auto leading-relaxed`}>
            Choose a flat $100 monthly plan, or pay nothing upfront and share 50% of new profit instead. Your money stays in your own broker account the whole time.
          </p>
        </Reveal>

        <Reveal delay={240}>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 pt-2">
            <button
              onClick={() => onSelectTab('client')}
              className="btn-primary px-7 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              <TrendingUp className="w-4 h-4" />
              <span>Access Client Terminal</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => onSelectTab('referrals')}
              className="btn-ghost px-7 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
              <span>Referral Hub (5% · 3% · 2%)</span>
            </button>
          </div>
        </Reveal>

        {/* Trade path */}
        <Reveal delay={320}>
          <div className="pt-8 sm:pt-12 flex flex-col sm:flex-row items-center justify-center gap-0 sm:gap-1">
            <FlowNode icon={<Server className="w-5 h-5" />} title="Master strategy" sub="Trades placed on the master account" />
            <FlowLine />
            <FlowNode icon={<Zap className="w-5 h-5" />} title="CASTIMOFx copier" sub="Lots scaled to your balance" pulse />
            <FlowLine />
            <FlowNode icon={<Wallet className="w-5 h-5" />} title="Your MT5 account" sub="Funds stay with your broker" />
          </div>
        </Reveal>
      </section>

      {/* ================= TRUST STRIP ================= */}
      <section>
        <Reveal>
          <div className="surface rounded-2xl px-5 py-5 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
            {[
              { icon: <Wallet className="w-4 h-4" />, t: 'Your funds, your broker', d: 'We never hold client deposits' },
              { icon: <Lock className="w-4 h-4" />, t: 'USDT on TRON (TRC20)', d: 'Pay from any wallet' },
              { icon: <Clock className="w-4 h-4" />, t: 'No automatic charges', d: 'You choose when to renew' },
              { icon: <Shield className="w-4 h-4" />, t: '$200 minimum equity', d: 'Checked once, at connection' },
            ].map((x) => (
              <div key={x.t} className="flex items-start gap-3">
                <span className="mt-0.5 w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                  {x.icon}
                </span>
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
            title={<>Two plans. <span className="text-electric-soft">Pick what fits you.</span></>}
            sub="Whichever you choose, you will only ever be billed under that plan's terms. You can compare both side by side after you sign up."
          />
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 lg:gap-7 max-w-5xl mx-auto">
          <Reveal>
            <div className="surface surface-hover rounded-3xl p-6 sm:p-8 h-full flex flex-col">
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">Monthly Subscription</div>
              <div className="mt-4 flex items-end gap-2">
                <span className={`${heading} text-5xl sm:text-6xl`}>
                  <CountUp to={100} prefix="$" />
                </span>
                <span className={`${muted} pb-2 text-sm`}>/ 30 days</span>
              </div>
              <p className={`${muted} text-sm mt-3`}>A flat, predictable price. No share of your profit on top.</p>
              <ul className="mt-6 space-y-3 flex-1">
                <Bullet>Paid up front in USDT (TRC20)</Bullet>
                <Bullet>Copying runs while your plan is active</Bullet>
                <Bullet>No profit share, whatever you earn</Bullet>
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
            <div className="surface edge-gradient surface-hover rounded-3xl p-6 sm:p-8 h-full flex flex-col">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">50% Profit Share</div>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30">
                  Nothing upfront
                </span>
              </div>
              <div className="mt-4 flex items-end gap-2">
                <span className="font-display font-extrabold tracking-tight text-5xl sm:text-6xl text-electric-soft">
                  <CountUp to={50} suffix="%" />
                </span>
                <span className={`${muted} pb-2 text-sm`}>of new profit only</span>
              </div>
              <p className={`${muted} text-sm mt-3`}>We earn only when your account makes new profit. No profit, no fee.</p>
              <ul className="mt-6 space-y-3 flex-1">
                <Bullet>Fee applies only to profit above your previous high-water mark</Bullet>
                <Bullet>Losses are recovered before any new fee is charged</Bullet>
                <Bullet>Deposits and withdrawals never count as profit</Bullet>
                <Bullet>Each invoice is payable within 24 hours in USDT (TRC20)</Bullet>
              </ul>
              <button
                onClick={() => onSelectTab('client')}
                className="btn-primary mt-7 w-full px-5 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
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
          <SectionTitle eyebrow="How it works" title={<>Up and copying in <span className="text-electric-soft">four steps</span></>} />
        </Reveal>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
          {[
            { n: '01', icon: <UserPlus className="w-5 h-5" />, t: 'Create your account', d: 'Sign up and confirm your email address.' },
            { n: '02', icon: <Wallet className="w-5 h-5" />, t: 'Choose your plan', d: 'Monthly subscription or 50% profit share.' },
            { n: '03', icon: <Link2 className="w-5 h-5" />, t: 'Connect your MT5', d: 'Use your MT5 login and broker server.' },
            { n: '04', icon: <Zap className="w-5 h-5" />, t: 'Copying runs for you', d: 'Trades are mirrored with lots scaled to your balance.' },
          ].map((s, i) => (
            <Reveal key={s.n} delay={i * 90}>
              <div className="surface surface-hover rounded-2xl p-6 h-full">
                <div className="flex items-center justify-between">
                  <span className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-slate-950 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                    {s.icon}
                  </span>
                  <span className="font-mono text-xs font-bold text-slate-400 dark:text-slate-500">{s.n}</span>
                </div>
                <h3 className="font-display font-bold text-base mt-5 text-slate-900 dark:text-white">{s.t}</h3>
                <p className={`${muted} text-sm mt-1.5 leading-relaxed`}>{s.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ================= REFERRALS ================= */}
      <section className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
        <Reveal>
          <div className="space-y-5 text-center lg:text-left">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-300">
              <Share2 className="w-3.5 h-3.5" />
              Referral program
            </span>
            <h2 className={`${heading} text-3xl sm:text-5xl leading-tight`}>
              <span className="text-electric-soft">3-Tier</span> Commissions
            </h2>
            <p className={`${muted} text-sm sm:text-base leading-relaxed max-w-lg mx-auto lg:mx-0`}>
              Share your link and earn USDT from what your network actually pays us — across three levels. Commissions are credited only from verified payments.
            </p>
            <p className={`${muted} text-xs leading-relaxed max-w-lg mx-auto lg:mx-0`}>
              Withdrawals start at $50 with a 10% processing fee. Requests made before Thursday 23:59 GMT join that week's payout cycle.
            </p>
            <div className="pt-1">
              <button
                onClick={() => onSelectTab('referrals')}
                className="btn-primary px-6 py-3 rounded-xl font-bold text-sm inline-flex items-center gap-2 cursor-pointer"
              >
                <span>Open the Referral Hub</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </Reveal>

        <div className="space-y-3.5">
          {[
            { lvl: 'Level 1', who: 'People you refer directly', pct: 5, w: 'w-full' },
            { lvl: 'Level 2', who: 'People your referrals refer', pct: 3, w: 'w-[92%]' },
            { lvl: 'Level 3', who: 'One level further out', pct: 2, w: 'w-[84%]' },
          ].map((t, i) => (
            <Reveal key={t.lvl} delay={i * 110} className={`${t.w} ${i ? 'ml-auto' : ''}`}>
              <div className="surface surface-hover rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
                <div>
                  <div className="font-display font-bold text-sm text-slate-900 dark:text-white">{t.lvl}</div>
                  <div className={`${muted} text-xs mt-0.5`}>{t.who}</div>
                </div>
                <div className="font-display font-extrabold text-4xl sm:text-5xl text-electric-soft tabular-nums">
                  <CountUp to={t.pct} suffix="%" duration={900} />
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ================= FAQ + closing CTA ================= */}
      <FAQSection onSelectTab={onSelectTab} />
    </div>
  );
};
