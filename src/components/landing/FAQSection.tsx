import React, { useState } from 'react';
import {
  ChevronDown,
  Award,
  Share2,
  Shield,
  Search,
  ArrowRight,
} from 'lucide-react';

interface FAQItem {
  id: string;
  category: 'profit_share' | 'referrals' | 'custody_security';
  question: string;
  answer: string;
}

const FAQ_ITEMS: FAQItem[] = [
  {
    id: 'ps-how-it-works',
    category: 'profit_share',
    question: 'How does the 50% profit share work?',
    answer:
      'Choose a flat $100 monthly plan or the 50% Profit Share. With Profit Share nothing is paid upfront: we earn only on the new net profit of trades that have closed, above your previous high-water mark. Losses are recovered before anything is charged, and if there is no new profit you owe nothing. Open trades are not charged until they close, and deposits and withdrawals never count as profit.',
  },
  {
    id: 'ps-daily-update',
    category: 'profit_share',
    question: 'Will I be told how my profit share is building up?',
    answer:
      'Yes. Every day after midnight GMT, a Profit Share update appears in your notifications: the trades that closed the day before, the net result for the period so far, and your 50% share so far. Invoices are made at the end of each period, and you have 24 hours to pay.',
  },
  {
    id: 'ps-24h-window',
    category: 'profit_share',
    question: 'When do I pay my profit share?',
    answer:
      'When profit is realised, an invoice for your 50% share is created. Pay it in TRC20 USDT before midnight GMT (23:59) on the day it is created, and copying continues while you do. We send reminders in your notifications every hour during the last 6 hours.',
  },
  {
    id: 'ps-24h-watcher',
    category: 'profit_share',
    question: 'What if an invoice is not paid before midnight GMT?',
    answer:
      'Copying pauses until it is paid: no new trades are copied, and trades that are already open still close with the master. Once your payment is confirmed, copying resumes shortly.',
  },
  {
    id: 'ref-three-phases',
    category: 'referrals',
    question: 'How do the 3-phase referral commissions work?',
    answer:
      'Monthly Plan clients: commission is paid once, on the client\u2019s first $100 Monthly Plan payment (renewals earn nothing):\n• Phase 1 (your direct referrals): 10%\n• Phase 2 (their referrals): 5%\n• Phase 3 (the next level): 5%\nOnly verified payments earn commission.\n\nWeekly commission (every client with a real account, on either plan): once a week you earn 3% (Phase 1), 2% (Phase 2) or 1% (Phase 3) of that client\u2019s equity. The week is the trading week, Monday to Friday, and the equity used is the figure at the close of the week. The client\u2019s account must be connected and copying then, and must have been connected for at least 24 hours. It is paid on top of the one-time Monthly Plan commission.',
  },
  {
    id: 'ref-math-example',
    category: 'referrals',
    question: 'Can you give an example?',
    answer:
      'Monthly Plan (paid once, on the first payment): a trader you invited pays the $100 plan fee.\n• Phase 1 (you): 10% = $10.00 USDT\n• Phase 2: 5% = $5.00 USDT\n• Phase 3: 5% = $5.00 USDT\n\nWeekly commission: a trader you invited has $1,000 equity and is connected and copying at the close of the week.\n• Phase 1 (you): 3% = $30.00 a week\n• Phase 2: 2% = $20.00 a week\n• Phase 3: 1% = $10.00 a week\nPaid once a week on the equity at the close of the trading week (Friday).\n\nCommissions come from the platform’s share, never from client capital.',
  },
  {
    id: 'ref-payout-methods',
    category: 'referrals',
    question: 'How are referral commissions paid out?',
    answer:
      'Commissions are credited to your Referral Hub once a referred client’s first $100 Monthly Plan payment is verified, and the weekly commission for every connected client is credited once a week, at the close of the trading week. You can withdraw from $50 to your own TRC20 USDT wallet, with a 10% processing fee. Requests made before Friday 23:59 GMT join that week’s cycle and are processed within 24 hours after it.',
  },
  {
    id: 'sec-broker-custody',
    category: 'custody_security',
    question: 'Who holds my funds?',
    answer:
      'You do, at your own regulated broker. Castimofx never holds, accepts or processes client deposits or trading balances. All deposits and withdrawals happen on your broker’s own client portal.',
  },
  {
    id: 'sec-risk-floor',
    category: 'custody_security',
    question: 'Can I connect with less than $200?',
    answer:
      'Yes. You can connect any USD MT5 account at any time. Trades are copied once the account has at least $200.00 USD of equity. Until then your account shows as connected but not copying, and copying starts by itself when you add funds, with nothing to press. Once copying has started, it is not stopped because your equity later falls.',
  },
];

interface FAQSectionProps {
  onSelectTab?: (tab: 'client' | 'referrals' | 'admin') => void;
  /** Hide the built-in call-to-action strip (the landing page has its own). */
  hideCta?: boolean;
}

export const FAQSection: React.FC<FAQSectionProps> = ({ onSelectTab, hideCta }) => {
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
      item.answer.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-8 max-w-4xl mx-auto pt-6 pb-12 animate-in fade-in duration-300">
      {/* Title */}
      <div className="text-center space-y-1">
        <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Questions and answers</h3>
        <p className="text-xs sm:text-sm text-slate-400">The plans, billing and referrals in brief.</p>
      </div>

      {/* Filter Tabs and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/80 p-2 rounded-2xl border border-slate-800">
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto no-scrollbar">
          {[
            { id: 'all', label: 'All' },
            { id: 'profit_share', label: '50% Profit Share' },
            { id: 'referrals', label: 'Referrals' },
            { id: 'custody_security', label: 'Custody' },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                activeCategory === cat.id
                  ? 'is-selected bg-sky-500 text-slate-950 font-bold shadow-md shadow-sky-500/20'
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
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
          />
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
        </div>
      </div>

      {/* Accordion FAQ List */}
      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl text-slate-500 text-xs">
            No matching questions.
          </div>
        ) : (
          filteredItems.map((item) => {
            const isExpanded = expandedId === item.id;
            return (
              <div
                key={item.id}
                className={`rounded-2xl transition border overflow-hidden ${
                  isExpanded
                    ? 'bg-slate-900/90 border-sky-500/40 shadow-lg shadow-sky-950/20'
                    : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-4 text-left cursor-pointer transition"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        item.category === 'profit_share'
                          ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
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
                    <h4 className="font-semibold text-sm text-white">{item.question}</h4>
                  </div>

                  <div
                    className={`w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 shrink-0 transition-transform duration-200 ${
                      isExpanded ? 'rotate-180 text-sky-400 bg-sky-500/15' : ''
                    }`}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 text-xs text-slate-300 border-t border-slate-800/60 leading-relaxed animate-in fade-in duration-200">
                    <div className="whitespace-pre-line mt-2 text-slate-300">
                      {item.answer}
                    </div>

                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Quick Launch CTA Strip */}
      {!hideCta && <div className="p-5 rounded-2xl bg-gradient-to-r from-sky-950/40 via-slate-900 to-slate-900 border border-sky-800/40 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h4 className="font-semibold text-sm text-white">Ready to start?</h4>
          <p className="text-xs text-slate-400 mt-0.5">Connect your broker account or share your referral link.</p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {onSelectTab && (
            <>
              <button
                onClick={() => onSelectTab('client')}
                className="btn-gold flex-1 sm:flex-none px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
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
      </div>}
    </div>
  );
};
