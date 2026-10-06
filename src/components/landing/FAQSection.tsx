import React, { useState } from 'react';
import {
  HelpCircle,
  ChevronDown,
  Award,
  Share2,
  Shield,
  Clock,
  Wallet,
  Zap,
  CheckCircle2,
  Search,
  ArrowRight,
} from 'lucide-react';

interface FAQItem {
  id: string;
  category: 'profit_share' | 'referrals' | 'custody_security';
  question: string;
  answer: string;
  highlight?: string;
}

const FAQ_ITEMS: FAQItem[] = [
  {
    id: 'ps-how-it-works',
    category: 'profit_share',
    question: 'How does the 50% profit share model work?',
    answer:
      'Unlike traditional signal channels that charge expensive monthly packages or subscription fees upfront, Castimofx operates strictly on a 50/50 profit share. We only earn when your connected MT5 makes realized net profits above your previous High-Water Mark. If there are no profits, you owe zero.',
    highlight: 'Zero upfront fees. 50% fee only applies to net profitable gains above High-Water Mark.',
  },
  {
    id: 'ps-24h-window',
    category: 'profit_share',
    question: 'How does the 24-hour profit settlement window operate?',
    answer:
      'When your MT5 terminal closes a profitable trading cycle, an automated invoice is generated for your 50% profit share. You have a full 24-hour grace window from profit realization to remit the payment via TRC20 USDT. Your trade copying continues without interruption during this 24-hour period.',
    highlight: '24-hour grace window to remit payment via TRC20 USDT with uninterrupted trade replication.',
  },
  {
    id: 'ps-24h-watcher',
    category: 'profit_share',
    question: 'What happens if the 50% profit share is not remitted within 24 hours?',
    answer:
      'The Castimofx Autonomous 24h Watcher daemon monitors all pending invoices. If an invoice remains unpaid after 24 hours of profit realization, the system automatically disconnects the MT5 bridge and blocks new trade signals to prevent unremitted replication. Once the 50% share is remitted on TRC20, trade copying re-engages immediately.',
    highlight: 'Automated 24h watcher halts copying if unpaid after 24h, protecting network integrity.',
  },
  {
    id: 'ref-three-phases',
    category: 'referrals',
    question: 'How does the 3-Phase Referral Commission program work?',
    answer:
      'Our affiliate architecture is structured into 3 distinct phases, rewarding you directly from the 50% profit share remitted by traders in your network:\n• Phase 1 (Main Direct Referrer): 5% of the client’s profit share\n• Phase 2 (Secondary Referrer): 3% of the profit share from traders invited by your Phase 1 network\n• Phase 3 (Tertiary Referrer): 2% of the profit share from traders invited by your Phase 2 network',
    highlight: 'Continuous multi-tier recurring commissions: 5% (Phase 1), 3% (Phase 2), and 2% (Phase 3).',
  },
  {
    id: 'ref-math-example',
    category: 'referrals',
    question: 'Can you provide a practical calculation example of referral earnings?',
    answer:
      'Suppose a trader joins directly through your link (Phase 1) and generates $1,000 in net trading profit:\n1. 50% Profit Share Due = $500.00 USDT\n2. Phase 1 Referrer (You, 5% of share) = $25.00 USDT\n3. If your referral invites Trader B (Phase 2 for you) who makes $1,000 profit, you earn 3% ($15.00 USDT).\n4. If Trader B invites Trader C (Phase 3 for you) who makes $1,000 profit, you earn 2% ($10.00 USDT).\nTotal commissions are paid from platform shares with zero deductions from client capital.',
    highlight: '$1,000 client profit = $500 share → Phase 1: $25 USDT, Phase 2: $15 USDT, Phase 3: $10 USDT.',
  },
  {
    id: 'ref-payout-methods',
    category: 'referrals',
    question: 'When and how are referral commissions paid out?',
    answer:
      'Commissions are credited to your Referral Hub in real time the instant a referred client settles their 24h profit share invoice. There are no lockup periods or minimum holding terms. You can withdraw your available commission balance directly to your personal TRC20 USDT wallet at any time.',
    highlight: 'Instant real-time crediting with direct on-chain TRC20 USDT withdrawals anytime.',
  },
  {
    id: 'sec-broker-custody',
    category: 'custody_security',
    question: 'Who has custody of my funds and trading capital?',
    answer:
      'You maintain 100% direct custody of your funds with your own regulated broker (e.g. IC Markets, Pepperstone, Exness, FP Markets). Castimofx never holds, accepts, or processes client deposits or trading balances. All deposits and withdrawals happen exclusively on your broker’s personal client portal.',
    highlight: '100% direct broker custody. Castimofx connects strictly via MT5 bridge replication.',
  },
  {
    id: 'sec-risk-floor',
    category: 'custody_security',
    question: 'What is the mandatory $200 equity safety stop?',
    answer:
      'To prevent account blowout and preserve trader capital, Castimofx enforces a built-in $200.00 USD equity safety floor. If market volatility causes account equity to approach or fall below $200, the system risk engine automatically blocks new trade copying until adequate margin is restored.',
    highlight: 'Automatic trading halt below $200 equity floor prevents severe drawdown.',
  },
];

interface FAQSectionProps {
  onSelectTab?: (tab: 'client' | 'referrals' | 'admin') => void;
}

export const FAQSection: React.FC<FAQSectionProps> = ({ onSelectTab }) => {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>('ps-how-it-works');
  const [searchQuery, setSearchQuery] = useState('');

  const toggleItem = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const filteredItems = FAQ_ITEMS.filter((item) => {
    const matchesCategory =
      activeCategory === 'all' || item.category === activeCategory;
    const matchesSearch =
      item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.answer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.highlight && item.highlight.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-8 max-w-4xl mx-auto pt-6 pb-12 animate-in fade-in duration-300">
      {/* Title Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
          <HelpCircle className="w-3.5 h-3.5" />
          <span>Knowledge Base & Platform Mechanics</span>
        </div>
        <h3 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
          Frequently Asked Questions
        </h3>
        <p className="text-xs sm:text-sm text-slate-400 max-w-xl mx-auto leading-relaxed">
          Everything you need to know about our pure 50% profit share model, 24-hour autonomous watcher, and 3-phase multi-tier referral program.
        </p>
      </div>

      {/* Filter Tabs and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/80 p-2 rounded-2xl border border-slate-800">
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto no-scrollbar">
          {[
            { id: 'all', label: 'All Questions' },
            { id: 'profit_share', label: '50% Profit Share' },
            { id: 'referrals', label: '3-Phase Referrals' },
            { id: 'custody_security', label: 'Custody & Risk' },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                activeCategory === cat.id
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <input
            type="text"
            placeholder="Search questions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
          />
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
        </div>
      </div>

      {/* Accordion FAQ List */}
      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl text-slate-500 text-xs">
            No questions found matching your search. Try another query or clear filters.
          </div>
        ) : (
          filteredItems.map((item) => {
            const isExpanded = expandedId === item.id;
            return (
              <div
                key={item.id}
                className={`rounded-2xl transition border overflow-hidden ${
                  isExpanded
                    ? 'bg-slate-900/90 border-emerald-500/40 shadow-lg shadow-emerald-950/20'
                    : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  className="w-full p-4 sm:p-5 flex items-center justify-between gap-4 text-left cursor-pointer transition"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        item.category === 'profit_share'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : item.category === 'referrals'
                          ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                          : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                      }`}
                    >
                      {item.category === 'profit_share' ? (
                        <Award className="w-4 h-4" />
                      ) : item.category === 'referrals' ? (
                        <Share2 className="w-4 h-4" />
                      ) : (
                        <Shield className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm sm:text-base text-white">
                        {item.question}
                      </h4>
                      <span className="text-[10px] font-mono uppercase text-slate-500 block mt-0.5">
                        {item.category === 'profit_share'
                          ? '50% Profit Share Model'
                          : item.category === 'referrals'
                          ? '3-Phase Affiliate Commission'
                          : 'Custody & Security'}
                      </span>
                    </div>
                  </div>

                  <div
                    className={`w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 shrink-0 transition-transform duration-200 ${
                      isExpanded ? 'rotate-180 text-emerald-400 bg-emerald-500/15' : ''
                    }`}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 sm:px-5 pb-5 pt-1 text-xs text-slate-300 space-y-3 border-t border-slate-800/60 leading-relaxed animate-in fade-in duration-200">
                    <div className="whitespace-pre-line mt-2 text-slate-300">
                      {item.answer}
                    </div>

                    {item.highlight && (
                      <div className="p-3 rounded-xl bg-slate-950 border border-emerald-500/20 text-emerald-300 text-[11px] font-medium flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{item.highlight}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Quick Launch CTA Strip */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-800/40 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h4 className="font-bold text-base text-white">Ready to start copying or referring?</h4>
          <p className="text-xs text-slate-400 mt-0.5">
            Connect your broker account or start sharing your 3-phase referral link today.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {onSelectTab && (
            <>
              <button
                onClick={() => onSelectTab('client')}
                className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 font-bold text-xs text-slate-950 shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Client Terminal</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => onSelectTab('referrals')}
                className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-semibold text-xs text-blue-300 border border-blue-500/30 transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5 text-blue-400" />
                <span>Referral Hub</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
