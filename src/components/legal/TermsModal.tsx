import React, { useRef, useState } from 'react';
import { ShieldAlert, CheckCircle2 } from 'lucide-react';
import { TERMS_SECTIONS, TERMS_CHECKBOXES, TERMS_VERSION } from '../../legal/terms';

interface TermsModalProps {
  isOpen: boolean;
  onAccept: () => Promise<{ success: boolean; error?: string }>;
  /** Present only when the terms are being viewed again (not required to accept). */
  onClose?: () => void;
}

/** Blocks the screen until the client has read to the end and ticked both boxes. */
export const TermsModal: React.FC<TermsModalProps> = ({ isOpen, onAccept, onClose }) => {
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [checks, setChecks] = useState<boolean[]>(TERMS_CHECKBOXES.map(() => false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const onScroll = () => {
    const el = boxRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setScrolledToEnd(true);
  };

  const allChecked = checks.every(Boolean);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await onAccept();
    setBusy(false);
    if (!res.success) setError(res.error || 'Could not save your acceptance.');
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[92vh] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl text-slate-100 shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex items-start gap-3">
          <ShieldAlert className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h2 className="text-base font-bold text-white">Terms, Profit-Share Agreement &amp; Risk Warning</h2>
            <p className="text-xs text-slate-400 mt-0.5">Please read all of this before using CASTIMOFx. Version {TERMS_VERSION}.</p>
          </div>
          {onClose && (
            <button onClick={onClose} className="text-slate-400 hover:text-white px-2" aria-label="Close">
              ✕
            </button>
          )}
        </div>

        <div ref={boxRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-5 space-y-5 text-sm leading-relaxed">
          {TERMS_SECTIONS.map((s) => (
            <section key={s.title} className="space-y-2">
              <h3 className="font-bold text-emerald-300">{s.title}</h3>
              {s.body.map((p, i) => (
                <p key={i} className="text-slate-300">
                  {p}
                </p>
              ))}
            </section>
          ))}
          <p className="text-xs text-slate-500 pt-2">End of document.</p>
        </div>

        <div className="p-5 border-t border-slate-800 space-y-3">
          {!scrolledToEnd && <p className="text-[11px] text-amber-300">Scroll to the end of the document to continue.</p>}
          {TERMS_CHECKBOXES.map((label, i) => (
            <label key={i} className={`flex items-start gap-2 text-xs ${scrolledToEnd ? 'text-slate-200' : 'text-slate-500'}`}>
              <input
                type="checkbox"
                disabled={!scrolledToEnd}
                checked={checks[i]}
                onChange={(e) => setChecks((c) => c.map((v, j) => (j === i ? e.target.checked : v)))}
                className="mt-0.5"
              />
              <span>{label}</span>
            </label>
          ))}
          {error && <p className="text-xs text-rose-300">{error}</p>}
          <button
            type="button"
            disabled={!scrolledToEnd || !allChecked || busy}
            onClick={submit}
            className="w-full py-2.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 disabled:opacity-40 flex items-center justify-center gap-2 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{busy ? 'Saving...' : 'I Agree'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
