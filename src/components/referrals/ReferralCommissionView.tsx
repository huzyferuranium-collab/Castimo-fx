import React, { useState, useEffect } from 'react';
import { tradingEngine } from '../../services/tradingEngine';
import { ReferralStats, ReferralPhase } from '../../types';
import {
  Share2,
  Copy,
  CheckCircle2,
  Users,
  Award,
  Wallet,
  ArrowRight,
  TrendingUp,
  Clock,
  Sparkles,
  Zap,
  ShieldCheck,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';

export const ReferralCommissionView: React.FC = () => {
  const [stats, setStats] = useState<ReferralStats>(tradingEngine.getReferralStats());
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [claimAddress, setClaimAddress] = useState('');
  const [claimAmount, setClaimAmount] = useState('');
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [simMessage, setSimMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsub = tradingEngine.subscribe(() => {
      setStats({ ...tradingEngine.getReferralStats() });
    });
    return () => unsub();
  }, []);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(stats.referralLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(stats.referralCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleSimulate = (phase: ReferralPhase) => {
    const ev = tradingEngine.simulateReferralSettlement(phase, 500.0);
    setSimMessage(
      `Simulated 24h settlement for Phase ${phase} referral! Credited $${ev.commissionEarnedUsdt.toFixed(2)} USDT (${ev.phasePct}% of $${ev.profitShareAmount.toFixed(2)} profit share).`
    );
    setTimeout(() => setSimMessage(null), 4500);
  };

  const handleClaimPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    setClaimError(null);
    setClaimSuccess(null);

    const amount = parseFloat(claimAmount);
    if (isNaN(amount) || amount <= 0) {
      setClaimError('Enter a valid payout amount.');
      return;
    }

    if (amount > stats.availableBalanceUsdt) {
      setClaimError(`Amount exceeds available balance ($${stats.availableBalanceUsdt.toFixed(2)} USDT).`);
      return;
    }

    if (!claimAddress.trim() || claimAddress.trim().length < 15) {
      setClaimError('Enter a valid TRC20 USDT payout address.');
      return;
    }

    setIsClaiming(true);
    const result = await tradingEngine.claimReferralCommission(amount, claimAddress.trim());
    setIsClaiming(false);

    if (result.success) {
      setClaimSuccess(
        `Successfully dispatched $${amount.toFixed(2)} USDT to ${claimAddress.slice(0, 10)}... (TX: ${result.txHash?.slice(0, 14)}...)`
      );
      setClaimAmount('');
      setTimeout(() => setClaimSuccess(null), 5000);
    } else {
      setClaimError(result.error || 'Failed to dispatch payout.');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 animate-in fade-in duration-200">
      {/* Referral Header Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-emerald-900/40 via-slate-900 to-slate-900 border border-emerald-800/50 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
              Multi-Tier Partner Network
            </span>
            <span className="text-xs text-slate-400">3-Phase Profit Share Commission</span>
          </div>
          <h2 className="text-2xl font-black text-white mt-1">Referral Commission Hub</h2>
          <p className="text-xs text-slate-400 mt-0.5 max-w-2xl leading-relaxed">
            Earn continuous recurring commissions paid directly from the 24-hour profit settlements of traders you introduce across 3 distinct phases.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-950/80 px-4 py-2.5 rounded-xl border border-slate-800 text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Available Commission</span>
            <span className="text-xl font-black font-mono text-emerald-400">
              ${stats.availableBalanceUsdt.toFixed(2)} <span className="text-xs text-slate-400">USDT</span>
            </span>
          </div>
        </div>
      </div>

      {simMessage && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{simMessage}</span>
        </div>
      )}

      {/* Referral Link & Code Box */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Your Personal Referral Link & Invitation Code</h3>
          </div>
          <span className="text-xs text-slate-400">Earn 5% • 3% • 2% on 24h settlements</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2 flex flex-col sm:flex-row items-center gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
            <div className="text-xs font-mono text-emerald-300 px-2 break-all select-all flex-1 font-semibold">
              {stats.referralLink}
            </div>
            <button
              onClick={handleCopyLink}
              className="w-full sm:w-auto px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 shrink-0 cursor-pointer shadow-sm"
            >
              {copiedLink ? <CheckCircle2 className="w-4 h-4 text-slate-950" /> : <Copy className="w-4 h-4" />}
              <span>{copiedLink ? 'Link Copied!' : 'Copy Link'}</span>
            </button>
          </div>

          <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800">
            <div>
              <span className="text-[10px] text-slate-500 block uppercase font-bold">Referral Code</span>
              <span className="text-xs font-mono font-bold text-white">{stats.referralCode}</span>
            </div>
            <button
              onClick={handleCopyCode}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition flex items-center gap-1 cursor-pointer"
            >
              {copiedCode ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCode ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3 Phases Tier Breakdown Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Phase 1 Card */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-emerald-500/30 shadow-lg relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 px-3 py-1 bg-emerald-500 text-slate-950 text-[10px] font-black rounded-bl-xl uppercase tracking-wider">
            Phase 1 • 5%
          </div>

          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">
                1
              </div>
              <div>
                <h4 className="font-bold text-sm text-white">Main Direct Referrer</h4>
                <p className="text-[11px] text-slate-400">Direct clients using your link</p>
              </div>
            </div>

            <div className="mt-4 p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1">
              <div className="text-xs text-slate-400 flex justify-between">
                <span>Commission Rate:</span>
                <span className="font-mono font-bold text-emerald-400 text-sm">5% of Profit Share</span>
              </div>
              <div className="text-xs text-slate-400 flex justify-between">
                <span>Active Referrals:</span>
                <span className="font-mono font-bold text-white">{stats.phase1Count} Traders</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
              When your direct referral settles their 24h profit (e.g. $1,000 profit = $500 share), <strong>you earn $25.00 USDT (5%)</strong> instantly.
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80">
            <button
              onClick={() => handleSimulate(1)}
              className="w-full py-2 px-3 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 font-semibold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Simulate Phase 1 Settlement (+$12.50)</span>
            </button>
          </div>
        </div>

        {/* Phase 2 Card */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-blue-500/30 shadow-lg relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 px-3 py-1 bg-blue-500 text-slate-950 text-[10px] font-black rounded-bl-xl uppercase tracking-wider">
            Phase 2 • 3%
          </div>

          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold">
                2
              </div>
              <div>
                <h4 className="font-bold text-sm text-white">Secondary Referrer</h4>
                <p className="text-[11px] text-slate-400">Referred by your direct clients</p>
              </div>
            </div>

            <div className="mt-4 p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1">
              <div className="text-xs text-slate-400 flex justify-between">
                <span>Commission Rate:</span>
                <span className="font-mono font-bold text-blue-400 text-sm">3% of Profit Share</span>
              </div>
              <div className="text-xs text-slate-400 flex justify-between">
                <span>Active Referrals:</span>
                <span className="font-mono font-bold text-white">{stats.phase2Count} Traders</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
              When traders invited by your Phase 1 network settle profit (e.g. $1,000 profit = $500 share), <strong>you earn $15.00 USDT (3%)</strong>.
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80">
            <button
              onClick={() => handleSimulate(2)}
              className="w-full py-2 px-3 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-300 font-semibold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Simulate Phase 2 Settlement (+$7.50)</span>
            </button>
          </div>
        </div>

        {/* Phase 3 Card */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-purple-500/30 shadow-lg relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 px-3 py-1 bg-purple-500 text-slate-950 text-[10px] font-black rounded-bl-xl uppercase tracking-wider">
            Phase 3 • 2%
          </div>

          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 font-bold">
                3
              </div>
              <div>
                <h4 className="font-bold text-sm text-white">Tertiary Referrer</h4>
                <p className="text-[11px] text-slate-400">Referred by your secondary network</p>
              </div>
            </div>

            <div className="mt-4 p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1">
              <div className="text-xs text-slate-400 flex justify-between">
                <span>Commission Rate:</span>
                <span className="font-mono font-bold text-purple-400 text-sm">2% of Profit Share</span>
              </div>
              <div className="text-xs text-slate-400 flex justify-between">
                <span>Active Referrals:</span>
                <span className="font-mono font-bold text-white">{stats.phase3Count} Traders</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
              When traders invited by your Phase 2 network settle profit (e.g. $1,000 profit = $500 share), <strong>you earn $10.00 USDT (2%)</strong>.
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80">
            <button
              onClick={() => handleSimulate(3)}
              className="w-full py-2 px-3 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 font-semibold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Simulate Phase 3 Settlement (+$5.00)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Payout Claim & Referral Balance Drawer */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-400" />
              <span>Claim Referral Commission Payout (TRC20 USDT)</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Withdraw accrued multi-phase referral earnings directly to your personal TRON wallet.
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <div>
              <span className="text-slate-500 block text-[10px]">Total Lifetime Earned:</span>
              <span className="font-bold text-white">${stats.totalEarnedUsdt.toFixed(2)} USDT</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">Available To Claim:</span>
              <span className="font-bold text-emerald-400">${stats.availableBalanceUsdt.toFixed(2)} USDT</span>
            </div>
          </div>
        </div>

        {claimSuccess && (
          <div className="p-3 text-xs rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{claimSuccess}</span>
          </div>
        )}

        {claimError && (
          <div className="p-3 text-xs rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-2 animate-in fade-in">
            <span className="font-bold">Error:</span>
            <span>{claimError}</span>
          </div>
        )}

        <form onSubmit={handleClaimPayout} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Payout Amount (USDT)
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.01"
                min="1"
                max={stats.availableBalanceUsdt}
                value={claimAmount}
                onChange={(e) => setClaimAmount(e.target.value)}
                placeholder={`Max: ${stats.availableBalanceUsdt.toFixed(2)}`}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => setClaimAmount(stats.availableBalanceUsdt.toString())}
                className="absolute right-2 top-1.5 text-[10px] font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 rounded cursor-pointer"
              >
                MAX
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Destination TRC20 Wallet Address
            </label>
            <input
              type="text"
              value={claimAddress}
              onChange={(e) => setClaimAddress(e.target.value)}
              placeholder="e.g. TXg8A2k9YvLmNpQrStUvWxYz..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={isClaiming || stats.availableBalanceUsdt <= 0}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 font-bold text-xs text-slate-950 shadow-md shadow-emerald-500/20 transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Wallet className="w-4 h-4" />
              <span>{isClaiming ? 'Processing Payout...' : 'Claim Commission Payout'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Network of Referred Clients Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-400" />
            <span>Referred MT5 Clients Across 3 Phases</span>
          </h3>
          <span className="text-xs text-slate-400">Total Referrals: {stats.referrals.length}</span>
        </div>

        <div className="border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 border-b border-slate-800 text-[10px] uppercase font-semibold text-slate-400">
              <tr>
                <th className="py-2.5 px-3">Client Name</th>
                <th className="py-2.5 px-3">MT5 Account #</th>
                <th className="py-2.5 px-3">Referral Phase</th>
                <th className="py-2.5 px-3">Introduced By</th>
                <th className="py-2.5 px-3">Total Settled Profit</th>
                <th className="py-2.5 px-3 text-right">Commission Credited</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {stats.referrals.map((r) => (
                <tr key={r.id} className="hover:bg-slate-800/30 transition">
                  <td className="py-3 px-3 font-bold text-white font-sans">{r.name}</td>
                  <td className="py-3 px-3 text-slate-300 font-mono">#{r.accountNumber}</td>
                  <td className="py-3 px-3">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        r.phase === 1
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : r.phase === 2
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                          : 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                      }`}
                    >
                      Phase {r.phase} ({r.phase === 1 ? '5%' : r.phase === 2 ? '3%' : '2%'})
                    </span>
                  </td>
                  <td className="py-3 px-3 text-slate-400 font-sans">{r.referrerName}</td>
                  <td className="py-3 px-3 text-emerald-400 font-bold">
                    +${r.totalSettledProfit.toFixed(2)}
                  </td>
                  <td className="py-3 px-3 text-right font-bold text-white">
                    ${r.totalCommissionPaid.toFixed(2)} USDT
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Commission Settlement History */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-400" />
          <span>Real-Time Commission Credit Ledger</span>
        </h3>

        <div className="border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800/70 bg-slate-950/40">
          {stats.history.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No referral commissions credited yet.
            </div>
          ) : (
            stats.history.map((ev) => (
              <div key={ev.id} className="p-3.5 hover:bg-slate-800/30 transition flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${
                      ev.phase === 1
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : ev.phase === 2
                        ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                        : 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                    }`}
                  >
                    P{ev.phase}
                  </div>
                  <div>
                    <div className="font-semibold text-white">
                      {ev.fromClientName} (#{ev.fromAccountNumber})
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Settled Profit: ${ev.settledProfit.toFixed(2)} • 50% Profit Share: ${ev.profitShareAmount.toFixed(2)} USDT
                    </div>
                  </div>
                </div>

                <div className="text-right font-mono">
                  <div className="text-emerald-400 font-bold text-sm">
                    +${ev.commissionEarnedUsdt.toFixed(2)} USDT
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Phase {ev.phase} ({ev.phasePct}%) • {new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
