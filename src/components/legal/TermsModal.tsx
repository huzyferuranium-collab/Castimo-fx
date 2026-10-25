import React, { useState } from 'react';
import { ShieldAlert, CheckCircle2, ChevronDown } from 'lucide-react';
import { TERMS_SECTIONS, TERMS_SUMMARY, TERMS_VERSION } from '../../legal/terms';

interface TermsModalProps {
  isOpen: boolean;
  onAccept: () => Promise<{ success: boolean; error?: string }>;
  /** Present only when the terms are being viewed again (not required to accept). */
  onClose?: () => void;
}

/** Short "do you agree?" screen. The full agreement is one tap away in a collapsible section. */
export const TermsModal: React.FC<TermsModalProps> = ({ isOpen, onAccept, onClose }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await onAccept();
    setBusy(false);
    if (!res.success) setError(res.error || 'Could not save your acceptance.');
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-sm">
      <div className="w-full max-w-lg max-h-[92vh] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl text-slate-100 shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex items-start gap-3">
          <ShieldAlert className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h2 className="text-base font-bold text-white">Do you agree to our Terms?</h2>
            <p className="text-xs text-slate-400 mt-0.5">Terms, Profit-Share Agreement &amp; Risk Warning · Version {TERMS_VERSION}</p>
          </div>
          {onClose && (
            <button onClick={onClose} className="text-slate-400 hover:text-white px-2" aria-label="Close">
              ✕
            </button>
          )}
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <ul className="space-y-2 text-sm text-slate-200">
            {TERMS_SUMMARY.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="text-emerald-400">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-slate-700 bg-slate-950/60 text-xs font-semibold text-slate-200 cursor-pointer"
          >
            <span>Read the full agreement</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          {open && (
            <div className="max-h-64 overflow-y-auto space-y-4 p-3 rounded-xl border border-slate-800 bg-slate-950/40 text-xs leading-relaxed">
              {TERMS_SECTIONS.map((s) => (
                <section key={s.title} className="space-y-1.5">
                  <h3 className="font-bold text-emerald-300">{s.title}</h3>
                  {s.body.map((p, i) => (
                    <p key={i} className="text-slate-300">
                      {p}
                    </p>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-slate-800 space-y-3">
          {error && <p className="text-xs text-rose-300">{error}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="w-full py-3 rounded-xl text-sm font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{busy ? 'Saving...' : 'I Agree'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
